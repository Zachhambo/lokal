// A single metadata resolver for online album and artist detail pages.
// Library and global-search entry points use the same lookups; a supplied
// catalogue ID is authoritative and must never be replaced by a namesake.
const ROOT = 'https://itunes.apple.com'
const norm = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const albumKey = value => norm(value).replace(/\b(deluxe|expanded|remastered|anniversary|edition)\b.*$/, '').trim()
const countryOf = value => /^[a-z]{2}$/i.test(String(value || '')) ? String(value).toUpperCase() : 'US'
const validId = value => /^\d{1,20}$/.test(String(value || ''))
const art = value => typeof value === 'string' && value.startsWith('https://') ? value.replace(/100x100bb/, '600x600bb') : ''

async function read(endpoint, values, fetchImpl) {
  const url = new URL(endpoint, ROOT)
  url.search = new URLSearchParams(values)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('Catalogue request failed (HTTP ' + response.status + ').')
    const body = await response.json()
    return Array.isArray(body?.results) ? body.results : []
  } finally { clearTimeout(timer) }
}

// iTunes artist rows have no portraits. Read the official Apple Music page
// for this *exact* artist ID rather than a similarly named search hit.
async function appleArtistPortrait(artistId, country, fetchImpl) {
  if (!validId(artistId)) return ''
  const url = new URL(`https://music.apple.com/${country.toLowerCase()}/artist/-/${artistId}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal, headers: { Accept: 'text/html' },
    })
    if (!response.ok || typeof response.text !== 'function') return ''
    const html = (await response.text()).slice(0, 350000)
    for (const tag of html.match(/<meta\s+[^>]*>/gi) || []) {
      if (!/(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i.test(tag)) continue
      const match = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)
      if (!match) continue
      const value = match[1].replace(/&amp;/g, '&')
      const candidate = new URL(value)
      if (candidate.protocol === 'https:' &&
          (candidate.hostname === 'mzstatic.com' || candidate.hostname.endsWith('.mzstatic.com')))
        return candidate.toString()
    }
  } catch { /* The catalogue still works without a portrait. */ }
  finally { clearTimeout(timer) }
  return ''
}

const artistRow = row => row?.wrapperType === 'artist' && validId(row.artistId)
const releaseRow = row => row?.wrapperType === 'collection' && validId(row.collectionId)
const release = row => ({
  title: row.collectionName, artist: row.artistName, albumId: null,
  sourceAlbumId: null, catalogue: 'apple', catalogueId: String(row.collectionId),
  artwork_url: art(row.artworkUrl100), year: Number(String(row.releaseDate || '').slice(0, 4)) || null,
  track_count: row.trackCount || null,
  release_type: Number(row.trackCount) === 1 ? 'single' : Number(row.trackCount) <= 6 && Number(row.trackCount) > 1 ? 'ep' : 'album',
  release_date: row.releaseDate || '',
})
const song = row => ({
  title: row.trackName, artist: row.artistName, artists: [row.artistName],
  album: row.collectionName || '', artwork_url: art(row.artworkUrl100),
  duration: Number(row.trackTimeMillis) / 1000 || 0,
  track_num: row.trackNumber || null, albumId: null,
})

async function releasesOf(artistId, country, fetchImpl) {
  const regions = [...new Set([country, 'US', 'GB', 'NG'])]
  const pages = await Promise.allSettled(regions.map(region =>
    read('/lookup', { id: artistId, entity: 'album', limit: '200', country: region }, fetchImpl)))
  if (pages.every(page => page.status === 'rejected')) throw new Error('Could not load artist releases.')
  const seen = new Set()
  return pages.filter(page => page.status === 'fulfilled').flatMap(page => page.value)
    .filter(row => releaseRow(row) && String(row.artistId) === String(artistId) && norm(row.collectionName))
    .filter(row => {
      const key = [norm(row.collectionName), norm(row.artistName), String(row.releaseDate || '').slice(0, 10)].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function artistCatalogue({ artist, catalogue, artistId, hints = [], country } = {}, { fetchImpl = fetch } = {}) {
  const name = String(artist || '').trim()
  if (!name) return { error: 'An artist name is required.' }
  if (catalogue && catalogue !== 'apple') return { error: 'This metadata provider does not support catalogue-ID lookup.' }
  const region = countryOf(country)
  const selectedId = validId(artistId) && catalogue === 'apple' ? String(artistId) : ''
  let candidates = []
  if (selectedId) {
    const result = await read('/lookup', { id: selectedId, country: region }, fetchImpl)
    candidates = result.filter(row => artistRow(row) && String(row.artistId) === selectedId)
  } else {
    const result = await read('/search', { term: name, media: 'music', entity: 'musicArtist', limit: '25', country: region }, fetchImpl)
    candidates = result.filter(row => artistRow(row) && norm(row.artistName) === norm(name)).slice(0, 5)
  }
  if (!candidates.length) return { error: 'Artist not found in the catalogue.' }
  const known = new Set(hints.map(norm).filter(Boolean))
  const investigated = await Promise.all(candidates.map(async candidate => {
    const albums = await releasesOf(candidate.artistId, region, fetchImpl).catch(() => [])
    return { candidate, albums, score: albums.filter(row => known.has(norm(row.collectionName))).length }
  }))
  const best = selectedId ? investigated[0] : [...investigated].sort((a, b) => b.score - a.score)[0]
  // Multiple same-name identities need evidence before we attribute a
  // library's releases to one. Never choose solely on the number of albums.
  if (!selectedId && candidates.length > 1 && known.size && !best.score)
    return { error: 'Cannot verify which same-named artist matches this library.' }
  const id = String(best.candidate.artistId)
  const [tracksRaw, image] = await Promise.all([
    read('/lookup', { id, entity: 'song', sort: 'popular', limit: '25', country: region }, fetchImpl).catch(() => []),
    appleArtistPortrait(id, region, fetchImpl),
  ])
  return {
    name: best.candidate.artistName || name, catalogue: 'apple', artistId: id,
    image, albums: best.albums.map(release),
    tracks: tracksRaw.filter(row => row.wrapperType === 'track' && row.kind === 'song' && norm(row.artistName) === norm(name)).map(song),
  }
}

async function albumCatalogue({ artist, album, catalogue, catalogueId, country } = {}, { fetchImpl = fetch } = {}) {
  const name = String(artist || '').trim()
  const title = String(album || '').trim()
  if (!name || !title) return { error: 'An album title and artist are required.', tracks: [] }
  if (catalogue && catalogue !== 'apple') return { error: 'This metadata provider does not support catalogue-ID lookup.', tracks: [] }
  const region = countryOf(country)
  const selectedId = catalogue === 'apple' && validId(catalogueId) ? String(catalogueId) : ''
  let id = selectedId
  if (!id) {
    const found = await read('/search', { term: name + ' ' + title, media: 'music', entity: 'album', limit: '50', country: region }, fetchImpl)
    const match = found.filter(releaseRow).find(row => norm(row.artistName) === norm(name) && norm(row.collectionName) === norm(title))
      || found.filter(releaseRow).find(row => norm(row.artistName) === norm(name) && albumKey(row.collectionName) === albumKey(title))
    id = match?.collectionId ? String(match.collectionId) : ''
  }
  if (!id) return { error: 'Album not found in the catalogue.', tracks: [] }
  const records = await read('/lookup', { id, entity: 'song', limit: '200', country: region }, fetchImpl)
  const info = records.find(row => releaseRow(row) && String(row.collectionId) === id)
  if (!info || (!selectedId && (norm(info.artistName) !== norm(name) || albumKey(info.collectionName) !== albumKey(title))))
    return { error: 'The catalogue returned a different album.', tracks: [] }
  const tracks = records.filter(row => row.wrapperType === 'track' && row.kind === 'song' && String(row.collectionId) === id)
    .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0))
    .map(song)
  return { tracks, title: info.collectionName, artist: info.artistName, artwork: art(info.artworkUrl100), catalogue: 'apple', catalogueId: id }
}
module.exports = { artistCatalogue, albumCatalogue }
