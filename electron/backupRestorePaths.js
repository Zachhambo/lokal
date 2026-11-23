const path = require('node:path')
const fs = require('node:fs/promises')

const DEVICE_SETTINGS = new Set([
  'download_root', 'download_root_device', 'cache_root', 'cache_root_device',
  'phone_download_root', 'phone_download_root_device', 'automix_engine_path',
  'ffmpeg_path', 'ffprobe_path', 'custom_ytdlp_path', 'custom_ffmpeg_path',
  'cast_last_device', 'prefer_media_keys',
])

function absolute(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null
  const raw = value.trim()
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(raw)) {
    return { flavor: path.win32, value: path.win32.normalize(raw) }
  }
  return path.posix.isAbsolute(raw) ? { flavor: path.posix, value: path.posix.normalize(raw) } : null
}

function nativePath(value) {
  const parsed = absolute(value)
  return parsed?.flavor === path ? parsed.value : null
}

function key(value) {
  const parsed = absolute(value)
  return parsed?.flavor === path.win32 ? parsed.value.toLowerCase() : parsed?.value
}

function roots(values) {
  const seen = new Set()
  return values.map(value => absolute(value)?.value).filter(value => {
    if (!value || seen.has(key(value))) return false
    seen.add(key(value))
    return true
  })
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return []
}

function musicFolders(settings) {
  const list = roots(parseList(settings.music_folders))
  return list.length ? list : roots([settings.music_folder])
}

function relativeParts(root, file) {
  const source = absolute(root)
  const target = absolute(file)
  if (!source || target?.flavor !== source.flavor) return null
  const relative = source.flavor.relative(source.value, target.value)
  if (!relative || relative === '..' || relative.startsWith('..' + source.flavor.sep) ||
      source.flavor.isAbsolute(relative)) return null
  return relative.split(source.flavor.sep)
}

function rebase(file, mappings) {
  for (const { source, folder } of mappings) {
    const parts = relativeParts(source, file)
    if (!parts) continue
    // Backslashes are legal in POSIX filenames but would become separators on
    // Windows. Joining them there could resolve to a different file or root.
    if (path === path.win32 && parts.some(part => /[\\/:*?"<>|]/.test(part))) return null
    return folder ? path.join(folder, ...parts) : null
  }
  return null
}

async function planFolders(incoming, current, selection, readable) {
  const sourceFolders = musicFolders(incoming)
  const currentFolders = musicFolders(current).filter(nativePath)
  const checked = new Map()
  const available = folder => {
    const native = nativePath(folder)
    if (!native) return Promise.resolve(false)
    if (!checked.has(key(native))) checked.set(key(native), readable(native))
    return checked.get(key(native))
  }
  const [sourceAvailable, currentAvailable] = await Promise.all([
    Promise.all(sourceFolders.map(folder =>
      // Do not contact a network share found only in an unconfirmed backup.
      folder.startsWith('\\') && !currentFolders.some(current => key(current) === key(folder))
        ? false
        : available(folder),
    )),
    Promise.all(currentFolders.map(available)),
  ])
  const existingDefault = currentFolders[0]
  let primary = existingDefault || sourceFolders[sourceAvailable.indexOf(true)] || null
  const mappings = sourceFolders.map((source, index) => ({
    source,
    folder: sourceAvailable[index] ? nativePath(source) : null,
  }))
  if (mappings[0] && !mappings[0].folder && currentAvailable[0]) mappings[0].folder = existingDefault

  if (selection) {
    const selected = async (value, fallback) => {
      if (value === undefined) return fallback
      const folder = nativePath(value)
      if (folder && await available(folder)) return folder
      // A previously configured removable drive remains selected while offline.
      if (folder && currentFolders.some(existing => key(existing) === key(folder))) return folder
      throw new Error('A selected music folder is unavailable. Choose an accessible folder and try again.')
    }
    const requested = Array.isArray(selection.mappings) ? selection.mappings : []
    const [chosenPrimary] = await Promise.all([
      selected(selection.primary ?? undefined, primary),
      ...mappings.map(async (entry, index) => {
        entry.folder = await selected(requested[index] ?? undefined, entry.folder)
      }),
    ])
    primary = chosenPrimary
  }

  const folders = roots([primary, ...currentFolders, ...mappings.map(entry => entry.folder)])
  const folderAvailable = await Promise.all(folders.map(available))
  return { primary: folders[0] || null, mappings, folders, onlineFolders: folders.filter((_, index) => folderAvailable[index]) }
}

function restoredSettings(incoming, current, plan) {
  const settings = { ...incoming }
  for (const setting of new Set([...Object.keys(incoming), ...Object.keys(current)])) {
    if (!DEVICE_SETTINGS.has(setting) && !setting.startsWith('automatic_backup_')) continue
    if (Object.hasOwn(current, setting)) settings[setting] = current[setting]
    else if (setting !== 'automatic_backup_frequency') delete settings[setting]
  }
  if (plan.folders.length) {
    settings.music_folder = plan.folders[0]
    settings.music_folders = JSON.stringify(plan.folders)
  } else {
    delete settings.music_folder
    delete settings.music_folders
  }

  const network = parseList(current.network_music_folders)
  const sourceNetwork = new Set(parseList(incoming.network_music_folders).map(key))
  for (const { source, folder } of plan.mappings) {
    // A mounted NAS on the source PC may become a normal local drive here.
    if (key(source) === key(folder) && sourceNetwork.has(key(source))) network.push(folder)
  }
  const networkKeys = new Set(network.map(key))
  const networkFolders = plan.folders.filter(folder => networkKeys.has(key(folder)))
  if (networkFolders.length) settings.network_music_folders = JSON.stringify(networkFolders)
  else delete settings.network_music_folders
  return settings
}

async function prepareRestore(payload, current, selection, {
  storageDir, readable, stat = fs.stat,
}) {
  const incoming = payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
    ? payload.settings : {}
  const plan = await planFolders(incoming, current, selection, readable)
  const settings = restoredSettings(incoming, current, plan)
  const mappings = [...plan.mappings]
  const sourceDownloads = absolute(incoming.download_root)
  const destinationDownloads = nativePath(settings.download_root) || plan.primary
  const sourcePhoneBase = sourceDownloads || absolute(musicFolders(incoming)[0])
  const sourcePhone = absolute(incoming.phone_download_root)?.value ||
    sourcePhoneBase?.flavor.join(sourcePhoneBase.value, 'Lokal Phone')
  const destinationPhone = nativePath(settings.phone_download_root) ||
    (destinationDownloads && path.join(destinationDownloads, 'Lokal Phone'))
  for (const [source, folder] of [[sourceDownloads?.value, destinationDownloads], [sourcePhone, destinationPhone]]) {
    if (source && !mappings.some(entry => key(entry.source) === key(source))) mappings.push({ source, folder })
  }
  // Nested libraries and separate download roots take priority over their parent.
  mappings.sort((a, b) => b.source.length - a.source.length)
  const mediaRoots = roots([
    ...plan.folders, nativePath(settings.download_root), nativePath(settings.phone_download_root), storageDir,
  ]).sort((a, b) => b.length - a.length)
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : []
  const originals = new Set(tracks.map(track => key(track?.file_path)).filter(Boolean))
  const movedCounts = new Map()
  const targets = tracks.map(track => {
    const file = track?.file_path
    const candidate = rebase(file, mappings)
    const identity = key(candidate)
    if (!candidate || key(file) === identity || originals.has(identity)) return null
    movedCounts.set(identity, (movedCounts.get(identity) || 0) + 1)
    return candidate
  })

  const assetCache = new Map()
  const failedRoots = new Set()
  async function fileExists(file) {
    const root = mediaRoots.find(candidate => relativeParts(candidate, file))
    if (!root || failedRoots.has(root)) return false
    try {
      return (await stat(file)).isFile()
    } catch (error) {
      // A disconnected drive must not incur one timeout per backed-up file.
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code)) failedRoots.add(root)
      return false
    }
  }
  async function asset(file) {
    if (!file || /^https?:\/\//i.test(file)) return file || null
    const candidate = rebase(file, mappings) || nativePath(file)
    if (!candidate) return null
    if (!assetCache.has(candidate)) assetCache.set(candidate, fileExists(candidate))
    return await assetCache.get(candidate) ? candidate : null
  }

  const scanFolders = new Set(plan.folders.filter(folder =>
    !plan.mappings.some(entry => key(entry.source) === key(folder)),
  ))
  let relocated = 0
  let unmatched = 0
  async function restoreTrack(track, index) {
    if (!track || typeof track !== 'object') return track
    const target = targets[index]
    const moved = target && movedCounts.get(key(target)) === 1 && await fileExists(target)
    if (moved) relocated++
    else if (absolute(track.file_path) &&
      (!nativePath(track.file_path) || mappings.some(entry =>
        key(entry.source) !== key(entry.folder) && relativeParts(entry.source, track.file_path)))) unmatched++

    const artwork = await asset(track.artwork_path)
    const file = moved ? target : track.file_path
    const refreshArtwork = track.artwork_path && !artwork
    const containing = plan.folders.find(folder => relativeParts(folder, file))
    if (containing && (refreshArtwork || moved)) scanFolders.add(containing)
    return {
      ...track,
      file_path: file,
      artwork_path: artwork,
      // Missing cached art should be read again even if audio mtime survived.
      last_modified: refreshArtwork || moved ? null : track.last_modified,
    }
  }

  async function mapRows(rows, transform) {
    if (!Array.isArray(rows)) return rows
    const result = new Array(rows.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(rows.length, 24) }, async () => {
      while (cursor < rows.length) {
        const index = cursor++
        result[index] = await transform(rows[index], index)
      }
    }))
    return result
  }

  const restoredTracks = await mapRows(tracks, restoreTrack)
  const artists = await mapRows(payload.artists, async row =>
    row && { ...row, image_path: await asset(row.image_path) })
  const playlists = await mapRows(payload.playlists, async row =>
    row && { ...row, cover_path: row.cover_data ? null : await asset(row.cover_path) })
  const users = await mapRows(payload.users, async row =>
    row && { ...row, avatar_path: row.avatar_data ? null : await asset(row.avatar_path) })

  return {
    plan,
    refreshFolders: plan.onlineFolders.filter(folder => scanFolders.has(folder) && !failedRoots.has(folder)),
    library: {
      relocated, unmatched,
    },
    data: { ...payload, settings, tracks: restoredTracks, artists, playlists, users },
  }
}

module.exports = { planFolders, prepareRestore }
