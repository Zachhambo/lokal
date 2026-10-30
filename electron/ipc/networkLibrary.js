'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { probeNetworkLibraryLocation } = require('../networkShare')
const scanner = require('./scanner')
const { getDB } = require('./db')

const STAT_TIMEOUT_MS = 8000

async function isReadableRoot(folder, {
  stat = fs.stat,
  readdir = fs.readdir,
} = {}) {
  // A disconnected SMB mount may never answer immediately. Don't block the
  // Electron main thread; stop waiting after a bounded timeout.
  const check = async () => (await stat(folder)).isDirectory() &&
    Array.isArray(await readdir(folder))
  let timeout
  try {
    return await Promise.race([
      check().catch(() => false),
      new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), STAT_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

/// Preserve offline existing NAS roots while never scanning unavailable ones.
/// This also protects the renderer from fs.statSync on disconnected UNC paths
/// in the legacy scanner. Accessible roots still use its metadata workflow.
async function scanNetworkRoots(inputs, {
  existing = scanner.configuredMusicFolders(),
  scan = scanner.scanFolders,
  db = getDB(),
  isReadable = isReadableRoot,
} = {}) {
  const candidates = Array.isArray(inputs) ? inputs : []
  const previous = new Set(existing.map(x => path.resolve(x).toLowerCase()))
  const seen = new Set()
  const normalized = candidates
    .filter(x => typeof x === 'string' && x.trim())
    .map(x => path.resolve(x.trim()))
    .filter(x => {
      const lower = x.toLowerCase()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })
  const statuses = await Promise.all(normalized.map(async folder => ({
    folder, online: await isReadable(folder),
  })))
  const online = statuses.filter(x => x.online).map(x => x.folder)
  const offline = statuses.filter(x => !x.online && previous.has(x.folder.toLowerCase()))
    .map(x => x.folder)
  const folders = normalized.filter(x =>
    online.includes(x) || offline.includes(x))
  if (!folders.length) {
    return { error: 'Select at least one accessible music folder.', folders: existing }
  }

  let result = { results: [], status: null }
  if (online.length) {
    // The existing scanner performs all metadata/index/bookkeeping work.
    // Feed only probed roots so its synchronous stat cannot block on a known
    // offline SMB mount. A network disconnect mid-scan is still possible.
    result = await scan(online)
    if (result?.error) return result
  }
  // scan(online) temporarily drops offline roots from persisted preferences.
  // Always restore them, including the folder at index zero.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folders', ?)").run(JSON.stringify(folders))
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folder', ?)").run(folders[0])
  return { ...result, folders, offlineFolders: offline }
}

function registerNetworkLibraryHandlers(ipcMain) {
  // These two handlers were registered by the legacy scanner. Replace only
  // their orchestration; actual scan and playback remain unchanged.
  ipcMain.removeHandler('scanner:scanFolders')
  ipcMain.removeHandler('scanner:connectNetworkShare')
  ipcMain.handle('scanner:scanFolders', async (event, inputs) => {
    try {
      return await scanNetworkRoots(inputs)
    } catch (error) {
      return { error: error?.message || 'Could not scan the selected folders.' }
    }
  })
  ipcMain.handle('scanner:connectNetworkShare', async (event, input) => {
    try {
      const { folder } = await probeNetworkLibraryLocation(input)
      const current = scanner.configuredMusicFolders()
      if (!current.some(x => x.toLowerCase() === folder.toLowerCase())) {
        current.push(folder)
      }
      return await scanNetworkRoots(current)
    } catch (error) {
      return { error: error?.message || 'Could not open this network share.' }
    }
  })
}

module.exports = { registerNetworkLibraryHandlers, isReadableRoot, scanNetworkRoots }
