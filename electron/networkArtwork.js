'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const MAX_FOLDER_COVER_BYTES = 12 * 1024 * 1024

function coverPriority(name) {
  const stem = path.parse(name).name.toLowerCase().replace(/[\s_-]+/g, '')
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

module.exports = { findFolderArtworkAsync, coverPriority }
