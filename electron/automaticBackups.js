// Opt-in daily/weekly backups. The main process schedules, validates and
// reports failures; the worker owns expensive SQLite reads and serialization.
const fs = require('node:fs/promises')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const INTERVALS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 }
const PREFIX = 'lokal-auto-backup-'
const KEEP = 10
const RETRY_MS = 60 * 60 * 1000
const MAX_PREFS_LENGTH = 32 * 1024 * 1024
const NAME = /^lokal-auto-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/
const TMP_NAME = /^lokal-auto-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json\.tmp$/

/** Export through a worker, including its own read-only database snapshot. */
function defaultWorkerRun(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'automaticBackupWorker.js'), { workerData })
    let finished = false
    worker.once('message', msg => {
      if (finished) return
      finished = true
      msg?.ok ? resolve(msg) : reject(new Error(msg?.error || 'Backup worker failed.'))
    })
    worker.once('error', error => { if (!finished) { finished = true; reject(error) } })
    worker.once('exit', code => {
      if (!finished) { finished = true; reject(new Error(`Backup worker exited (${code})`)) }
    })
  })
}

/** Validate the complete preference snapshot rather than quietly reusing an
 * old copy when collection or serialization exceeds a safety limit. */
function validatePrefs(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Could not read current interface preferences for backup.')
  }
  const serialized = JSON.stringify(value)
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_PREFS_LENGTH) {
    throw new Error('Interface preferences are too large to back up.')
  }
  return JSON.parse(serialized)
}

/** Create a persistent opt-in scheduler; test mode accepts an injected
 * exporter and filesystem, production passes dbPath + fresh preference reader. */
function createAutomaticBackups({
  db, dbPath, exportData, getPreferences, documentsPath,
  now = Date.now, files = fs, workerRun = defaultWorkerRun,
} = {}) {
  if (!db || (!dbPath && typeof exportData !== 'function')) {
    throw new Error('Automatic backup needs a database and exporter')
  }
  const read = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''
  const save = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
  const defaultDirectory = path.resolve(documentsPath, 'Lokal Backups')
  let pending = null
  let pendingForced = false
  let lastAttempt = 0
  let localPrefs = null
  let cachedPrefsInvalid = false

  /** Return the persisted destination-specific success and failure state. */
  function status() {
    const rawFrequency = read('automatic_backup_frequency')
    const frequency = INTERVALS[rawFrequency] ? rawFrequency : 'off'
    const raw = read('automatic_backup_directory')
    const directory = raw && path.isAbsolute(raw) ? path.resolve(raw) : defaultDirectory
    const lastSuccess = read('automatic_backup_last_directory') === directory
      ? Number(read('automatic_backup_last_success')) || 0 : 0
    return {
      frequency, directory, lastSuccess, busy: !!pending,
      lastError: read('automatic_backup_last_error'),
      lastErrorAt: Number(read('automatic_backup_last_error_at')) || 0,
      nextDue: frequency === 'off' ? null : lastSuccess + INTERVALS[frequency],
    }
  }

  /** Set cadence or selected backup folder without carrying success from
   * the previous folder into the new location. */
  function configure({ frequency, directory, directoryIdentity } = {}) {
    if (frequency !== undefined) {
      if (frequency !== 'off' && !INTERVALS[frequency]) throw new Error('Invalid backup frequency')
      save('automatic_backup_frequency', frequency)
    }
    if (directory !== undefined) {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
        throw new Error('Choose an absolute backup directory')
      }
      const dest = path.resolve(directory)
      if (dest !== status().directory) {
        save('automatic_backup_directory', dest)
        save('automatic_backup_directory_identity', directoryIdentity || '')
        lastAttempt = 0
        save('automatic_backup_last_error', '')
        save('automatic_backup_last_error_at', 0)
      }
    }
    return status()
  }

  /** Cache only explicitly validated UI preferences for injected/test exporters.
   * Production always requests a fresh snapshot for every backup. */
  function capturePrefs(value) {
    localPrefs = null
    cachedPrefsInvalid = true
    localPrefs = validatePrefs(value)
    cachedPrefsInvalid = false
  }

  /** Clean up only old, abandoned temporary automatic-backup files. */
  async function cleanupTemporary(directory) {
    const names = await files.readdir(directory)
    for (const name of names.filter(name => TMP_NAME.test(name))) {
      try {
        const target = path.join(directory, name)
        const stat = await files.stat(target)
        if (now() - stat.mtimeMs > RETRY_MS) await files.rm(target, { force: true })
      } catch {}
    }
  }

  /** Write an export and rotate copies without ever deleting manual files. */
  async function writeBackup() {
    const initial = status()
    const { directory } = initial
    if (!getPreferences && cachedPrefsInvalid) {
      throw new Error('The last interface preference snapshot was rejected.')
    }
    const prefs = validatePrefs(getPreferences ? await getPreferences() : localPrefs || {})
    const timestamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const destination = path.join(directory, `${PREFIX}${timestamp}.json`)
    const customDirectory = directory !== defaultDirectory
    if (customDirectory) {
      // The selected path must remain present: never recreate an unplugged
      // removable-volume mount point on a local disk.
      const st = await files.stat(directory)
      if (!st.isDirectory()) throw new Error('Selected backup folder is unavailable.')
      const expected = read('automatic_backup_directory_identity')
      if (expected && expected !== `${st.dev}:${st.ino}`) {
        throw new Error('Selected backup volume changed or disconnected. Choose the folder again.')
      }
    } else {
      await files.mkdir(directory, { recursive: true, mode: 0o700 })
    }
    await cleanupTemporary(directory)
    if (dbPath) {
      await workerRun({
        dbPath, directory, destination, prefs,
        requireExistingDirectory: customDirectory,
      })
    } else {
      // Tests and explicitly injected exporters exercise the same retention
      // and failure rules; production never exports on the main thread.
      const temporary = `${destination}.tmp`
      try {
        const data = await exportData()
        if (!data || data.version !== 1) throw new Error('Backup exporter returned an invalid payload')
        data.localPrefs = prefs
        await files.writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        await files.rename(temporary, destination)
      } catch (error) {
        await files.rm(temporary, { force: true }).catch(() => {})
        throw error
      }
    }
    save('automatic_backup_last_directory', directory)
    save('automatic_backup_last_success', now())
    save('automatic_backup_last_error', '')
    save('automatic_backup_last_error_at', 0)
    try {
      const entries = (await files.readdir(directory)).filter(name => NAME.test(name)).sort().reverse()
      for (const extra of entries.slice(KEEP)) await files.rm(path.join(directory, extra), { force: true })
    } catch (error) {
      console.warn('[backups] Could not rotate old backups:', error.message)
    }
    return { ...status(), filePath: destination }
  }

  /** Serialize runs, with a forced click guaranteed to create a new backup
   * after a running due check has completed. Persist scheduled failures. */
  function run({ force = false } = {}) {
    if (pending) {
      if (!force || pendingForced) return pending
      return pending.catch(() => {}).then(() => run({ force: true }))
    }
    const state = status()
    if (!force && (
      state.frequency === 'off' ||
      now() < state.nextDue ||
      (lastAttempt && now() - lastAttempt < RETRY_MS)
    )) return Promise.resolve(state)
    lastAttempt = now()
    pendingForced = force
    pending = writeBackup().catch(error => {
      save('automatic_backup_last_error', error.message || 'Backup failed')
      save('automatic_backup_last_error_at', now())
      throw error
    }).finally(() => { pending = null; pendingForced = false })
    return pending
  }
  return { status, configure, capturePrefs, run }
}

module.exports = { createAutomaticBackups, INTERVALS, KEEP, validatePrefs }
