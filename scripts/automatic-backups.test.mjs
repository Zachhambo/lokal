import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAutomaticBackups, KEEP } = require('../electron/automaticBackups.js')

function fixture(dir, clock, exporter = () => ({ version: 1, users: [], play_history: [] })) {
  const state = new Map()
  const db = {
    prepare(query) {
      if (query.startsWith('SELECT')) return { get: key => ({ value: state.get(key) || '' }) }
      if (query.startsWith('INSERT')) return { run: (key, value) => state.set(key, value) }
      throw new Error(query)
    },
  }
  return createAutomaticBackups({ db, exportData: exporter, documentsPath: dir, now: () => clock.value })
}

test('daily automatic backups are opt-in, due-based and compatible with manual import', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  const backup = fixture(dir, clock)
  assert.equal(backup.status().frequency, 'off')
  await backup.run()
  await assert.rejects(fs.stat(backup.status().directory), /ENOENT/)
  backup.configure({ frequency: 'daily' })
  backup.capturePrefs({ localTheme: 'dark' })
  const first = await backup.run()
  assert.equal(first.lastSuccess, clock.value)
  assert.ok(first.filePath.endsWith('.json'))
  assert.equal(JSON.parse(await fs.readFile(first.filePath, 'utf8')).localPrefs.localTheme, 'dark')
  assert.equal((await fs.readdir(first.directory)).length, 1)
  clock.value += 12 * 60 * 60 * 1000
  await backup.run()
  assert.equal((await fs.readdir(first.directory)).length, 1)
  clock.value += 12 * 60 * 60 * 1000
  await backup.run()
  assert.equal((await fs.readdir(first.directory)).length, 2)
})

test('failed scheduled exports preserve prior files and retry without recording success', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  let broken = false
  const backup = fixture(dir, clock, () => {
    if (broken) throw Error('database busy')
    return { version: 1, playlists: [] }
  })
  backup.configure({ frequency: 'weekly' })
  const before = await backup.run()
  broken = true
  clock.value += 7 * 24 * 60 * 60 * 1000
  await assert.rejects(backup.run(), /database busy/)
  assert.equal(backup.status().lastSuccess, before.lastSuccess)
  assert.deepEqual(await fs.readdir(before.directory), [path.basename(before.filePath)])
  clock.value += 59 * 60 * 1000
  await backup.run()
  assert.equal(backup.status().lastSuccess, before.lastSuccess)
  assert.equal((await fs.readdir(before.directory)).length, 1)
  broken = false
  clock.value += 60 * 1000
  const retry = await backup.run()
  assert.equal(retry.lastSuccess, clock.value)
  assert.equal((await fs.readdir(before.directory)).length, 2)
})

test('rotation keeps the newest ten automatic exports without deleting other files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  const backup = fixture(dir, clock)
  backup.configure({ frequency: 'daily' })
  const directory = backup.status().directory
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'manual-export.json'), '{}')
  for (let i = 0; i < KEEP + 3; i++) {
    await backup.run()
    clock.value += 24 * 60 * 60 * 1000
  }
  const files = await fs.readdir(directory)
  assert.equal(files.filter(file => file.startsWith('lokal-auto-backup-')).length, KEEP)
  assert.ok(files.includes('manual-export.json'))
})

test('changing backup destination resets success and never creates a missing custom mount', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-backup-drive-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  const backup = fixture(root, clock)
  backup.configure({ frequency: 'daily' })
  const first = await backup.run()
  assert.ok(first.filePath)
  const unavailable = path.join(root, 'removed-drive', 'backups')
  backup.configure({ directory: unavailable })
  assert.equal(backup.status().lastSuccess, 0)
  await assert.rejects(backup.run(), /ENOENT/)
  await assert.rejects(fs.stat(unavailable), /ENOENT/)
  assert.ok(backup.status().lastError)
  // Re-selecting a mounted directory makes it eligible immediately.
  const valid = path.join(root, 'external-drive')
  await fs.mkdir(valid)
  const stat = await fs.stat(valid)
  backup.configure({ directory: valid, directoryIdentity: `${stat.dev}:${stat.ino}` })
  const restored = await backup.run()
  assert.ok(restored.filePath.startsWith(valid))
  assert.equal(restored.lastError, '')
  assert.equal(restored.lastSuccess, clock.value)
})

test('fresh preferences are requested on every run and oversized payloads fail', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-backup-fresh-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { createAutomaticBackups } = require('../electron/automaticBackups.js')
  const state = new Map()
  const db = { prepare(query) {
    if (query.startsWith('SELECT')) return { get: key => ({ value: state.get(key) || '' }) }
    return { run: (key, value) => state.set(key, value) }
  } }
  let current = { 'lokal-theme': 'dark' }
  const calls = []
  const backup = createAutomaticBackups({
    db, dbPath: '/mock/lokal.db', documentsPath: root,
    getPreferences: async () => current,
    workerRun: async options => {
      calls.push(options)
      await fs.writeFile(options.destination, JSON.stringify({ version: 1, localPrefs: options.prefs }))
    },
    now: () => Date.parse('2026-11-08T12:00:00Z') + calls.length * 1000,
  })
  backup.configure({ frequency: 'daily' })
  await backup.run({ force: true })
  assert.equal(calls[0].prefs['lokal-theme'], 'dark')
  current = { 'lokal-theme': 'light' }
  await backup.run({ force: true })
  assert.equal(calls[1].prefs['lokal-theme'], 'light')
  current = { 'lokal-cache': 'x'.repeat(33 * 1024 * 1024) }
  await assert.rejects(backup.run({ force: true }), /too large/)
  assert.equal(calls.length, 2)
  assert.ok(backup.status().lastError)
})

test('preload IPC round-trip returns current renderer preferences to main process', async t => {
  const vm = await import('node:vm')
  const { EventEmitter } = await import('node:events')
  const { registerAutomaticBackupIpc } = require('../electron/automaticBackupIpc.js')
  const bus = new EventEmitter()
  const handlers = new Map()
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: { id: 99 } }, ...args)
  const ipcRenderer = {
    invoke,
    on: (channel, fn) => bus.on(channel, fn),
    removeListener: (channel, fn) => bus.removeListener(channel, fn),
  }
  let preloadAPI
  vm.runInNewContext(await fs.readFile(path.join(process.cwd(), 'electron/preload.js'), 'utf8'), {
    require: name => name === 'electron'
      ? { ipcRenderer, contextBridge: { exposeInMainWorld: (_, api) => { preloadAPI = api } } }
      : require(name),
    window: { addEventListener() {} },
  }, { filename: 'electron/preload.js' })
  const documentsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-backup-ipc-'))
  t.after(() => fs.rm(documentsPath, { recursive: true, force: true }))
  const webContents = {
    id: 99, isDestroyed: () => false, isLoadingMainFrame: () => false,
    send: (channel, requestId) => bus.emit(channel, {}, requestId),
  }
  const BrowserWindow = {
    getAllWindows: () => [{ isDestroyed: () => false, webContents }],
  }
  let current = { 'lokal-theme': 'dark' }
  let received = null
  registerAutomaticBackupIpc({
    ipcMain, BrowserWindow, documentsPath,
    dialog: { showOpenDialog: async () => ({ canceled: true }) },
    shell: { openPath: async () => '' },
    schedule: false,
    createBackups: getPreferences => ({
      status: () => ({ frequency: 'daily', directory: documentsPath }),
      configure: () => ({ frequency: 'daily', directory: documentsPath }),
      run: async () => {
        received = await getPreferences()
        return { ok: true }
      },
    }),
  })
  const off = preloadAPI.onAutomaticBackupPrefsRequest(id => {
    preloadAPI.automaticBackupDeliverPrefs(id, current).catch(() => {})
  })
  assert.equal((await preloadAPI.automaticBackupStatus()).frequency, 'daily')
  assert.deepEqual(JSON.parse(JSON.stringify(await preloadAPI.automaticBackupRunNow())), { ok: true })
  assert.deepEqual(JSON.parse(JSON.stringify(received)), { 'lokal-theme': 'dark' })
  current = { 'lokal-theme': 'light' }
  await preloadAPI.automaticBackupRunNow()
  assert.equal(received['lokal-theme'], 'light')
  off()
})
