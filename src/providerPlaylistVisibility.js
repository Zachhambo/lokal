// A hidden playlist remains cached and untouched on its provider. Visibility
// preferences are scoped by source and a non-reversible account fingerprint.
const keyFor = (provider, accountId) => {
  if (!['spotify', 'youtube'].includes(provider) || !/^[a-f0-9]{64}$/.test(accountId || '')) return null
  return `lokal:playlist-hidden:v1:${provider}:${accountId}`
}

export function hiddenPlaylistIds(provider, accountId) {
  const key = keyFor(provider, accountId)
  if (!key) return []
  try {
    const data = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(data) ? data.filter(id => typeof id === 'string' && id.length <= 120) : []
  } catch { return [] }
}

export function setPlaylistHidden(provider, accountId, playlistId, hidden) {
  const key = keyFor(provider, accountId)
  if (!key || !playlistId || typeof playlistId !== 'string') return []
  const next = new Set(hiddenPlaylistIds(provider, accountId))
  if (hidden) next.add(playlistId)
  else next.delete(playlistId)
  const values = [...next]
  try { localStorage.setItem(key, JSON.stringify(values)) } catch {}
  return values
}
