// Source scope is independent of the single-choice result-category filter.
// All runs both library and online searches; the exclusive modes remain fast.
export const SEARCH_SCOPES = Object.freeze(['all', 'library', 'online'])
export const normalizeSearchScope = value => SEARCH_SCOPES.includes(value) ? value : 'library'
export const searchesLibrary = scope => normalizeSearchScope(scope) !== 'online'
export const searchesOnline = scope => normalizeSearchScope(scope) !== 'library'
export const scopeDescription = scope => {
  const value = normalizeSearchScope(scope)
  return value === 'all' ? 'Search your library and online sources together'
    : value === 'online' ? 'Search online catalogues and playback sources'
    : 'Search only your library'
}
