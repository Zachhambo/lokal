'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { probeNetworkLibraryLocation } = require('../networkShare')

const STAT_TIMEOUT_MS = 8000

function withTimeout(fn, timeoutMs = STAT_TIMEOUT_MS) {
  return (...args) => {
    let timer
    return Promise.race([
      Promise.resolve().then(() => fn(...args)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Network share probe timed out. Check the NAS connection.')), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
  }
}

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

// A late fs.watch notification after disconnect must not destroy indexed
// music. Recheck each affected root immediately before any delete; group by
// root so a bulk rename does not cause thousands of NAS probes.
async function verifiedMissingPaths(paths, ownerFor, wasReadable, probe = isReadableRoot) {
  const verified = []
  const availability = new Map()
  for (const filePath of new Set(paths)) {
    const root = ownerFor(filePath)
    if (!root || wasReadable.get(root) !== true) continue
    if (!availability.has(root)) availability.set(root, await probe(root))
    if (availability.get(root)) verified.push(filePath)
  }
  return verified
}

/// Preserve offline existing NAS roots while never scanning unavailable ones.
/// This also protects the renderer from fs.statSync on disconnected UNC paths
/// in the legacy scanner. Accessible roots still use its metadata workflow.
async function scanNetworkRoots(inputs, {
  existing = [],
  scan,
  db,
  isReadable = isReadableRoot,
  closeWatchers = () => require('../libraryWatcher').watchLibraryRoots([]),
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
  try {
    if (online.length) {
      // Metadata scanning only sees currently reachable roots. A new network
      // failure during that scan must never erase a previously saved NAS.
      result = await scan(online)
    } else {
      // A disconnected share leaves old fs.watch handles behind unless
      // explicitly replaced with an empty active watcher set.
      closeWatchers()
    }
  } finally {
    // The scanner saves only online roots. Restore all configured folders,
    // even when a scan throws halfway through its work.
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folders', ?)").run(JSON.stringify(folders))
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folder', ?)").run(folders[0])
  }
  return { ...result, folders, offlineFolders: offline }
}

function registerNetworkLibraryHandlers(ipcMain) {
  const scanner = require('./scanner')
  const { getDB } = require('./db')
  const run = roots => scanNetworkRoots(roots, {
    existing: scanner.configuredMusicFolders(),
    scan: scanner.scanFolders,
    db: getDB(),
  })
  const progress = (event, scanning, status) => {
    try {
      if (!event.sender.isDestroyed()) {
        event.sender.send('scanner:progress', {
          scanning, total: status?.total ?? 0, done: status?.done ?? 0,
          errors: status?.errors ?? 0, skipped: status?.skipped ?? 0,
          ...(!scanning ? { complete: true } : {}),
        })
      }
    } catch {}
  }
  // These two handlers were registered by the legacy scanner. Replace only
  // their orchestration; actual scan and playback remain unchanged.
  ipcMain.removeHandler('scanner:scanFolders')
  ipcMain.removeHandler('scanner:connectNetworkShare')
  ipcMain.handle('scanner:scanFolders', async (event, inputs) => {
    progress(event, true)
    try {
      const result = await run(inputs)
      progress(event, false, result.status)
      return result
    } catch (error) {
      progress(event, false)
      return { error: error?.message || 'Could not scan the selected folders.' }
    }
  })
  ipcMain.handle('scanner:connectNetworkShare', async (event, input) => {
    try {
      const { folder } = await probeNetworkLibraryLocation(input, {
        stat: withTimeout(fs.stat),
        readdir: withTimeout(fs.readdir),
      })
      const current = scanner.configuredMusicFolders()
      if (!current.some(x => x.toLowerCase() === folder.toLowerCase())) {
        current.push(folder)
      }
      progress(event, true)
      const result = await run(current)
      progress(event, false, result.status)
      return result
    } catch (error) {
      progress(event, false)
      return { error: error?.message || 'Could not open this network share.' }
    }
  })
}

module.exports = { registerNetworkLibraryHandlers, isReadableRoot, scanNetworkRoots, withTimeout, verifiedMissingPaths }
