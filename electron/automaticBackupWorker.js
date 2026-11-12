// Run SQLite export and JSON serialization off Electron's UI/main thread.
// This worker reads a WAL snapshot using its own read-only connection.
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { exportAppData } = require('./appDataExport')

function run() {
  const { dbPath, directory, destination, prefs, requireExistingDirectory } = workerData
  let before = null
  if (requireExistingDirectory) {
    before = fs.statSync(directory) // Never recreate an unmounted drive.
    if (!before.isDirectory()) throw new Error('Selected backup folder is unavailable.')
  } else {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    before = fs.statSync(directory)
  }
  const database = new Database(dbPath, { readonly: true, fileMustExist: true })
  let snapshot
  try {
    // A read transaction prevents concurrent scan/history writes producing an
    // inconsistent cross-table snapshot.
    snapshot = database.transaction(() => exportAppData(database))()
  } finally {
    database.close()
  }
  snapshot.localPrefs = prefs
  const data = JSON.stringify(snapshot)
  // An unplugged removable volume must not silently fall back to a recreated
  // mount-point folder on the internal disk.
  const after = fs.statSync(directory)
  if (after.dev !== before.dev || after.ino !== before.ino) {
    throw new Error('Backup folder changed or became unavailable during export.')
  }
  const staging = `${destination}.tmp`
  try {
    fs.writeFileSync(staging, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const current = fs.statSync(directory)
    if (current.dev !== before.dev || current.ino !== before.ino) {
      throw new Error('Selected backup volume disconnected during backup.')
    }
    fs.renameSync(staging, destination)
  } finally {
    try { fs.rmSync(staging, { force: true }) } catch {}
  }
  return { filePath: destination }
}

try {
  parentPort.postMessage({ ok: true, ...run() })
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message || 'Automatic backup worker failed.' })
}
