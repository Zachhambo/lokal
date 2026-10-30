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
  const first = images[0]
  if (coverPriority(first.name) < 0 && images.length !== 1) return null
  const candidate = path.join(folder, first.name)
  try {
    const info = await withTimeout(stat, timeoutMs)(candidate)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_FOLDER_COVER_BYTES) return null
    return candidate
  } catch { return null }
}

module.exports = { findFolderArtworkAsync, coverPriority }
