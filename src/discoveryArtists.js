// The artists you follow: their releases fill Home → Releases. Unfollowing
// an artist also keeps them out of Discovery (stored as the hidden list it
// replaced). A new artist in the library isn't followed until you say so;
// on the first run, everyone already in the library who wasn't hidden is
// followed, so nothing changes for an existing library.
import { create } from 'zustand'
import { api } from './api'

export const discoveryArtistKey = name => String(name || '').normalize('NFKC').trim().toLowerCase()
export function parseHiddenArtists(value) {
  try {
    const names = JSON.parse(value || '[]')
    return new Set(Array.isArray(names) ? names.map(discoveryArtistKey).filter(Boolean) : [])
  } catch { return new Set() }
}

/** The followed artists stored as names: key -> display name. */
export function parseFollowedArtists(value) {
  try {
    const names = JSON.parse(value || '[]')
    return new Map((Array.isArray(names) ? names : []).map(name => [discoveryArtistKey(name), String(name || '').trim()]).filter(([key]) => key))
  } catch { return new Map() }
}

/** The name-based follow list remains backward compatible. Catalogue IDs are
 * stored alongside it so an exact Search selection survives a restart. */
export function validFollowIdentity(input) {
  if (!input || typeof input !== 'object') return null
  const catalogue = String(input.catalogue || '').toLowerCase()
  const artistId = String(input.artistId || input.catalogue_id || '').trim()
  if (catalogue === 'apple' ? !/^\d{1,20}$/.test(artistId)
    : catalogue === 'spotify' ? !/^[A-Za-z0-9]{8,64}$/.test(artistId) : true) return null
  const url = String(input.imageUrl || input.artwork_url || '')
  const imageUrl = /^https:\/\/[^\s"'<>]{1,2000}$/.test(url) ? url : ''
  return { catalogue, artistId, ...(imageUrl ? { imageUrl } : {}) }
}

export function parseFollowedArtistIdentities(value) {
  try {
    const rows = JSON.parse(value || '{}')
    if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return new Map()
    return new Map(Object.entries(rows).slice(0, 1000)
      .map(([key, value]) => [discoveryArtistKey(key), validFollowIdentity(value)])
      .filter(([key, value]) => key && value))
  } catch { return new Map() }
}

export const useDiscoveryArtists = create(() => ({
  hidden: new Set(), followed: new Map(), identities: new Map(), followReady: false, loaded: false,
}))
let pending = null
let writes = Promise.resolve()

export function loadDiscoveryArtists() {
  if (!pending) pending = api.getSettings().then(settings => {
    if (settings?.error) throw new Error(settings.error)
    const followed = parseFollowedArtists(settings.followed_artists)
    const identities = parseFollowedArtistIdentities(settings.followed_artist_identities)
    for (const key of identities.keys()) if (!followed.has(key)) identities.delete(key)
    useDiscoveryArtists.setState({
      hidden: parseHiddenArtists(settings.discovery_hidden_artists),
      followed, identities,
      followReady: settings.followed_artists_ready === '1',
      loaded: true,
    })
  }).finally(() => { pending = null })
  return pending
}

/** Changes the lists one write at a time; the store only changes once saved. */
function update(change) {
  const write = writes.catch(() => {}).then(async () => {
    await loadDiscoveryArtists()
    const state = useDiscoveryArtists.getState()
    const hidden = new Set(state.hidden)
    const followed = new Map(state.followed)
    const identities = new Map(state.identities)
    const extra = change({ hidden, followed, identities }) || {}
    for (const key of identities.keys()) if (!followed.has(key)) identities.delete(key)
    const values = {
      discovery_hidden_artists: JSON.stringify([...hidden]),
      followed_artists: JSON.stringify([...followed.values()]),
      followed_artist_identities: JSON.stringify(Object.fromEntries(identities)),
      ...extra,
    }
    const result = await api.saveSettings(values)
    if (result?.error) throw new Error(result.error)
    useDiscoveryArtists.setState({ hidden, followed, identities, ...(extra.followed_artists_ready === '1' ? { followReady: true } : {}) })
  })
  writes = write
  return write
}

/** Follow (true) or unfollow (false) artists by name. */
export function setArtistsFollowed(names, follow) {
  const list = (names || []).map(name => [discoveryArtistKey(name), String(name || '').trim()]).filter(([key]) => key)
  if (!list.length) return Promise.resolve()
  return update(({ hidden, followed, identities }) => {
    for (const [key, name] of list) {
      if (follow) { followed.set(key, followed.get(key) || name); hidden.delete(key) }
      else { followed.delete(key); hidden.add(key); identities.delete(key) }
    }
  })
}

export function setArtistFollowed(name, follow, identity = null) {
  const selected = validFollowIdentity(identity)
  const key = discoveryArtistKey(name)
  if (!follow || !selected || !key) return setArtistsFollowed([name], follow)
  return update(({ hidden, followed, identities }) => {
    followed.set(key, String(name).trim())
    hidden.delete(key)
    identities.set(key, selected)
  })
}

/** Unfollowing keeps the artist out of Discovery too (the old "Hide from discovery"). */
export const setDiscoveryArtistHidden = (name, hidden) => setArtistFollowed(name, !hidden)

/**
 * Once: follow everyone already in the library who wasn't hidden. Call it
 * with the library's artists once they've loaded.
 */
export async function initFollowedArtists(libraryArtists) {
  await loadDiscoveryArtists()
  if (useDiscoveryArtists.getState().followReady) return
  await update(({ hidden, followed }) => {
    for (const artist of libraryArtists || []) {
      const key = discoveryArtistKey(artist?.name)
      if (key && !hidden.has(key) && !followed.has(key)) followed.set(key, String(artist.name).trim())
    }
    return { followed_artists_ready: '1' }
  })
}

export const isArtistFollowed = (state, name) => state.followed.has(discoveryArtistKey(name))
