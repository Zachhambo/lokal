export function chooseRandomFolders(folders, limit = 6, random = Math.random) {
  const pool = Array.isArray(folders) ? [...folders] : []
  const count = Math.min(pool.length, Math.max(0, Math.floor(Number(limit) || 0)))
  for (let index = 0; index < count; index++) {
    const swap = index + Math.floor(random() * (pool.length - index))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  return pool.slice(0, count)
}

export function configuredMusicRoots(settings) {
  let roots = []
  try {
    const parsed = JSON.parse(settings?.music_folders || 'null')
    if (Array.isArray(parsed)) roots = parsed
  } catch {}
  if (!roots.length && typeof settings?.music_folder === 'string' && settings.music_folder.trim()) {
    roots = [settings.music_folder]
  }
  const seen = new Set()
  return roots.filter(value => {
    if (typeof value !== 'string' || !value.trim()) return false
    const key = value.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(value => value.trim())
}

export async function getFoldersWithDirectTracks(getLibraryFolders, root, forceRefresh = false) {
  const found = []
  const pending = ['']
  while (pending.length) {
    const batch = pending.splice(0, 8)
    const views = await Promise.all(batch.map(relativePath =>
      getLibraryFolders(relativePath, '', root, forceRefresh)
    ))
    for (const view of views) {
      for (const folder of Array.isArray(view?.folders) ? view.folders : []) {
        if (folder.directTrackCount > 0) found.push(folder)
        if (folder.trackCount > folder.directTrackCount) pending.push(folder.path)
      }
    }
  }
  return found
}
