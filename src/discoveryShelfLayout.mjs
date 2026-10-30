// Matches Mobile's discovery_shelf_layout.dart (stable IDs, provider defaults,
// restore unknown/new shelves, hidden visibility and reorder semantics).
export const DISCOVERY_SHELF_TITLES = Object.freeze({
  mixes: 'Mixed for you',
  community: 'From the community',
  newReleases: 'New releases',
  trending: 'Trending songs for you',
  featuredPlaylists: 'Featured playlists for you',
  dailyDiscover: 'Your daily discover',
  fresh: 'Fresh Finds',
  quick: 'Quick Picks',
  history: 'Recently Played',
  albums: 'Albums For You',
  artists: 'Artists For You',
})
export const DISCOVERY_SHELF_DEFAULTS = Object.freeze({
  youtube: ['mixes', 'community', 'newReleases', 'trending', 'featuredPlaylists', 'dailyDiscover', 'fresh', 'quick', 'artists'],
  lastfm: ['albums', 'fresh', 'artists'],
  spotify: ['mixes', 'fresh', 'quick', 'history', 'albums', 'artists'],
})

export function restoreShelfLayout(provider, saved = {}) {
  const defaults = DISCOVERY_SHELF_DEFAULTS[provider] || []
  const order = [...new Set([...(Array.isArray(saved.order) ? saved.order.filter(id => defaults.includes(id)) : []), ...defaults])]
  const hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter(id => defaults.includes(id))
  return { order, hidden: [...new Set(hidden)] }
}
export function visibleShelfIds(layout) {
  return layout.order.filter(id => !layout.hidden.includes(id))
}
export function moveShelf(layout, from, to) {
  const order = [...layout.order]
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= order.length || to < 0 || to >= order.length) return layout
  const [id] = order.splice(from, 1)
  order.splice(to, 0, id)
  return { ...layout, order }
}
export function showShelf(layout, id, show) {
  if (!layout.order.includes(id)) return layout
  const hidden = new Set(layout.hidden)
  if (show) hidden.delete(id)
  else hidden.add(id)
  return { ...layout, hidden: [...hidden] }
}
export function shelfStorageKey(user, provider) {
  return `lokal.discovery.shelves.v1.${encodeURIComponent(user || 'guest')}.${provider}`
}
export function readShelfLayout(storage, user, provider) {
  let value = {}
  try { value = JSON.parse(storage?.getItem(shelfStorageKey(user, provider)) || '{}') || {} } catch {}
  return restoreShelfLayout(provider, value)
}
export function writeShelfLayout(storage, user, provider, layout) {
  storage?.setItem(shelfStorageKey(user, provider), JSON.stringify(restoreShelfLayout(provider, layout)))
}
