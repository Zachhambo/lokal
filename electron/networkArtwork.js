'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const MAX_FOLDER_COVER_BYTES = 12 * 1024 * 1024

// List rows retain their shared 150px WebP thumbnail, while large surfaces
// recover the untouched folder image beside it. Only our hashed cache names
// are eligible; never derive a source path from renderer-controlled input.
const FOLDER_THUMBNAIL = /^nas-folder-[a-f0-9]{24}\.webp$/i
const FULL_COVER_EXTS = ['.jpg', '.png', '.webp', '.gif']
function folderOriginalCandidates(thumbnailPath) {
  if (!FOLDER_THUMBNAIL.test(path.basename(String(thumbnailPath || '')))) return []
  const base = path.basename(thumbnailPath, '.webp')
  return FULL_COVER_EXTS.map(ext => path.join(path.dirname(thumbnailPath), base + '.full' + ext))
}
const hasFolderOriginal = thumbnailPath =>
  folderOriginalCandidates(thumbnailPath).some(file => require('node:fs').existsSync(file))

// Only covers from actual network roots need a durable copy. Local folder
// images must keep their original path and resolution in the library database.
// Explicitly registered mounted shares are tracked in settings because their
// drive letters / POSIX mount paths do not otherwise identify them as remote.
function isNetworkArtworkPath(filePath, configuredRoots = [], platform = process.platform) {
  if (typeof filePath !== 'string' || !filePath) return false
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32') {
    // Windows extended local paths (\\?\C:\...) are not NAS shares.
    if (/^\\\\\?\\UNC\\/i.test(filePath)) return true
    if (/^\\\\[?.]\\/.test(filePath)) return false
    if (/^(?:\\\\|\/\/)/.test(filePath)) return true
  }
  const candidate = paths.resolve(filePath)
  return configuredRoots.some(root => {
    if (typeof root !== 'string' || !root) return false
    const parent = paths.resolve(root)
    const relative = paths.relative(parent, candidate)
    return relative === '' || (relative !== '..' &&
      !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative))
  })
}

function isCachedFolderArtwork(filePath) {
  return /^nas-folder-[a-f0-9]{24}\.(?:webp|jpe?g)$/i.test(path.basename(String(filePath || '')))
}

function fullCoverExtension(bytes) {
  if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg'
  if (bytes?.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png'
  if (bytes?.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return '.webp'
  if (bytes?.length >= 6 && bytes.toString('latin1', 0, 4) === 'GIF8') return '.gif'
  return null
}
async function preserveOriginalFolderCover(artworkDir, base, bytes) {
  const ext = fullCoverExtension(bytes)
  if (!ext) return null
  const destination = path.join(artworkDir, base + '.full' + ext)
  try {
    const existing = await fs.stat(destination)
    if (existing.isFile() && existing.size === bytes.length) return destination
  } catch {}
  await fs.mkdir(artworkDir, { recursive: true })
  const temp = destination + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp'
  try {
    await fs.writeFile(temp, bytes)
    await fs.rename(temp, destination)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
  return destination
}
const MAX_OUTSTANDING_COVER_READS = 4
const COVER_READ_CHUNK_BYTES = 64 * 1024
let outstandingCoverReads = 0

function coverPriority(name) {
  // Match mobile's cover.1.jpg / folder.2.png aliases as well as the
  // usual cover.jpg names. Never select a random multi-image booklet.
  const stem = path.parse(name).name.toLowerCase()
    .replace(/\.[0-9]+$/, '').replace(/[\s_-]+/g, '')
  return ['cover', 'folder', 'front', 'albumart', 'album', 'art'].indexOf(stem)
}

/**
 * Non-blocking, bounded folder-cover discovery for slow SMB/WebDAV mounts.
 * Embedded artwork takes precedence in the scanner. Never attach arbitrary
 * unrelated images if an album folder contains several different posters.
 */
async function findFolderArtworkAsync(folder, {
  readdir = fs.readdir,
  stat = fs.stat,
  timeoutMs = 8000,
} = {}) {
  const { withTimeout } = require('./ipc/networkLibrary')
  let entries
  try {
    entries = await withTimeout(readdir, timeoutMs)(folder, { withFileTypes: true })
  } catch { return null }
  const images = entries.filter(entry =>
    entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
  images.sort((a, b) => {
    const left = coverPriority(a.name)
    const right = coverPriority(b.name)
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
  if (!images.length) return null
  // Never choose an arbitrary poster among multiple images. Try each named
  // cover in priority order: an oversized/unreadable cover.jpg must not hide
  // a valid folder.jpg or front.png.
  const candidates = images.filter(entry => coverPriority(entry.name) >= 0)
  if (!candidates.length && images.length === 1) candidates.push(images[0])
  // Share one candidate-stat deadline. A stalled NAS must not cost another
  // full timeout for each conventional artwork filename.
  const deadline = Date.now() + timeoutMs
  for (const entry of candidates) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const candidate = path.join(folder, entry.name)
    try {
      const info = await withTimeout(stat, remaining)(candidate)
      if (info.isFile() && info.size > 0 && info.size <= MAX_FOLDER_COVER_BYTES) {
        return candidate
      }
    } catch (error) {
      if (Date.now() >= deadline || error?.code === 'ETIMEDOUT' ||
          /timed out/i.test(error?.message || '')) break
      // Immediate errors (e.g. EACCES/ENOENT) may still leave a valid cover.
    }
  }
  return null
}


/**
 * Persist the cover of a mounted SMB/WebDAV folder into app-owned artwork
 * storage. Renderer thumbnails should not depend on a UNC mount remaining
 * reachable after the initial scan, and multiple tracks share one cache file.
 * Fail closed to the old path: a transient offline share must not erase art.
 */
async function cacheFolderArtwork(sourcePath, artworkDir, {
  open = fs.open,
  writeCover = require('./artwork/thumb').writeCover,
  timeoutMs = 8000,
} = {}) {
  if (!sourcePath || outstandingCoverReads >= MAX_OUTSTANDING_COVER_READS) return null
  const controller = new AbortController()
  let timer
  outstandingCoverReads++
  // FileHandle reads cannot interrupt an in-flight OS request. Stop issuing
  // further reads after a timeout and retain the slot until cleanup finishes.
  const read = (async () => {
    let handle
    try {
      handle = await open(sourcePath, 'r')
      controller.signal.throwIfAborted()
      const info = await handle.stat()
      controller.signal.throwIfAborted()
      if (!info.isFile() || info.size <= 0 || info.size > MAX_FOLDER_COVER_BYTES) return null

      // One extra byte detects growth while never allocating beyond the limit.
      const buffer = Buffer.allocUnsafe(info.size + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length,
          Math.min(COVER_READ_CHUNK_BYTES, buffer.length - length), null)
        controller.signal.throwIfAborted()
        if (!bytesRead) break
        length += bytesRead
      }
      if (length !== info.size || length > MAX_FOLDER_COVER_BYTES) return null
      const after = await handle.stat()
      controller.signal.throwIfAborted()
      if (!after.isFile() || after.size !== info.size ||
          after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) return null
      const key = crypto.createHash('sha256')
        .update(String(sourcePath) + ':' + info.size + ':' + info.mtimeMs)
        .digest('hex').slice(0, 24)
      return { key, bytes: buffer.subarray(0, length) }
    } finally {
      if (handle) await handle.close()
    }
  })().finally(() => { outstandingCoverReads-- })

  try {
    const result = await Promise.race([
      read,
      new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null) }, timeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (!result) return null
    const base = 'nas-folder-' + result.key
    const thumbnail = await writeCover(artworkDir, base, result.bytes)
    // Older installations may already have the thumbnail but not the source.
    // Repair their full-resolution art the next time the folder is scanned,
    // without changing what small library lists load.
    try { await preserveOriginalFolderCover(artworkDir, base, result.bytes) }
    catch { /* The thumbnail stays usable if the cache disk is read-only. */ }
    return thumbnail
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { findFolderArtworkAsync, coverPriority, cacheFolderArtwork, folderOriginalCandidates, hasFolderOriginal, isNetworkArtworkPath, isCachedFolderArtwork }
