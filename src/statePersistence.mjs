// Small, opt-in restart state. Never store rendered pages, tracks, artwork,
// search results or other cached datasets in this record.
const TOGGLE_KEY = 'lokal-state-persistence-enabled'
const STATE_KEY = 'lokal-view-state-v1'
const VERSION = 1
const MAX_RECORD_SIZE = 8192

const VIEW_KEYS = new Set([
  'library:sort', 'library:source', 'library:genre',
  'library:quality', 'library:format', 'library:view',
  'library:mode', 'library:folderPath', 'library:activeMusicRoot',
  'artists:sort', 'artists:followed', 'artists:mainOnly',
  'artists:density', 'sidebar:collapsed', 'sidebar:leftWidth',
  'sidebar:rightWidth', 'navigation:scrollPath', 'navigation:scrollTop',
])

// Reject corrupted/obsolete saved enum values, especially sort expressions
// that eventually reach the track-query API.
const ENUM_VALUES = {
  'library:sort': ['added_at DESC', 'title ASC', 'artist ASC', 'play_count DESC', 'duration DESC'],
  'library:source': ['all', 'local', 'mobile', 'yt', 'sc', 'addon', 'soulseek', 'web', 'errors'],
  'library:view': ['list', 'grid'],
  'library:mode': ['simple', 'advanced'],
  'library:quality': ['', 'hires', 'lossless', 'high', 'low', 'suspect'],
  'artists:sort': ['name', 'tracks'],
  'artists:followed': ['0', '1'],
  'artists:mainOnly': ['0', '1'],
  'artists:density': ['spaced', 'compact', 'list'],
  'sidebar:collapsed': ['0', '1'],
}
function validViewValue(key, value) {
  if (typeof value !== 'string' || value.length > 512) return false
  if (ENUM_VALUES[key] && !ENUM_VALUES[key].includes(value)) return false
  if (key === 'library:format' && value !== '' && !/^(?:16|24|32)-(?:44100|48000|88200|96000|176400|192000)$/.test(value)) return false
  if (key === 'navigation:scrollTop' && (!Number.isFinite(Number(value)) ||
      Number(value) < 0 || Number(value) > 10000000)) return false
  if (key === 'navigation:scrollPath' && !allowedSavedRoute(value)) return false
  if ((key === 'sidebar:leftWidth' || key === 'sidebar:rightWidth') &&
      (!Number.isFinite(Number(value)) || Number(value) < 100 || Number(value) > 1000)) return false
  return true
}

const STATIC_ROUTES = new Set([
  '/', '/library', '/albums', '/artists', '/genres', '/stations',
  '/videos', '/search', '/profile', '/quality', '/radio', '/recap',
  '/settings', '/cache-analysis',
])
const DETAIL_ROUTES = /^\/(?:artist|genre|playlist)\/[a-zA-Z0-9%_.~-]{1,200}$/
const PROVIDER_ROUTES = /^\/(?:spotify|youtube)\/playlist\/[a-zA-Z0-9%_.~-]{1,200}$/
const HOME_ROUTES = /^\/home\/(?:discovery|flow|releases|history)(?:\/[a-zA-Z0-9%_.~-]{1,100})?$/

export function allowedSavedRoute(path) {
  return typeof path === 'string' && path.length <= 256 &&
    (STATIC_ROUTES.has(path) || DETAIL_ROUTES.test(path) ||
      PROVIDER_ROUTES.test(path) || HOME_ROUTES.test(path))
}

function readRecord(storage) {
  try {
    const raw = storage?.getItem(STATE_KEY)
    if (!raw || raw.length > MAX_RECORD_SIZE) return null
    const data = JSON.parse(raw)
    return data?.version === VERSION && data.values && typeof data.values === 'object' &&
      !Array.isArray(data.values) ? data : null
  } catch { return null }
}

export function statePersistenceEnabled(storage = globalThis.localStorage) {
  try { return storage?.getItem(TOGGLE_KEY) === '1' } catch { return false }
}

export function setStatePersistenceEnabled(enabled, storage = globalThis.localStorage) {
  try {
    if (enabled) storage?.setItem(TOGGLE_KEY, '1')
    else {
      storage?.setItem(TOGGLE_KEY, '0')
      storage?.removeItem(STATE_KEY)
    }
  } catch { return false }
  try { globalThis.window?.dispatchEvent(new Event('lokal:state-persistence-changed')) } catch {}
  return true
}

export function readViewState(key, storage = globalThis.localStorage) {
  if (!statePersistenceEnabled(storage) || !VIEW_KEYS.has(key)) return undefined
  const value = readRecord(storage)?.values?.[key]
  return validViewValue(key, value) ? value : undefined
}

export function writeViewState(key, value, storage = globalThis.localStorage) {
  if (!statePersistenceEnabled(storage) || !VIEW_KEYS.has(key) ||
      !validViewValue(key, value)) return
  try {
    const previous = readRecord(storage) || { version: VERSION, values: {} }
    if (previous.values[key] === value) return
    const next = { ...previous, values: { ...previous.values, [key]: value } }
    const serialized = JSON.stringify(next)
    if (serialized.length <= MAX_RECORD_SIZE) storage?.setItem(STATE_KEY, serialized)
  } catch {}
}

export function readSavedRoute(storage = globalThis.localStorage) {
  if (!statePersistenceEnabled(storage)) return '/'
  const route = readRecord(storage)?.route
  return allowedSavedRoute(route) ? route : '/'
}

export function writeSavedRoute(route, storage = globalThis.localStorage) {
  if (!statePersistenceEnabled(storage) || !allowedSavedRoute(route)) return
  try {
    const previous = readRecord(storage) || { version: VERSION, values: {} }
    if (previous.route === route) return
    const next = JSON.stringify({ ...previous, route })
    if (next.length <= MAX_RECORD_SIZE) storage?.setItem(STATE_KEY, next)
  } catch {}
}
