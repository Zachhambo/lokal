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
  return typeof value === 'string' && value.length <= 512 ? value : undefined
}

export function writeViewState(key, value, storage = globalThis.localStorage) {
  if (!statePersistenceEnabled(storage) || !VIEW_KEYS.has(key) ||
      typeof value !== 'string' || value.length > 512) return
  // Scroll values are validated separately from arbitrary view preferences.
  if (key === 'navigation:scrollTop' && (!Number.isFinite(Number(value)) ||
      Number(value) < 0 || Number(value) > 10000000)) return
  if (key === 'navigation:scrollPath' && !allowedSavedRoute(value)) return
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
    storage?.setItem(STATE_KEY, JSON.stringify({ ...previous, route }))
  } catch {}
}
