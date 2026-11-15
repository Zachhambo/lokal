import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { artistCatalogue, albumCatalogue } = require('../electron/online/catalogueDetails.js')
const { onlineAlbumPath, albumCacheKey } = await import('../src/onlineBrowse.js')

const mock = calls => async url => {
  const u = new URL(url)
  const p = Object.fromEntries(u.searchParams)
  calls.push({ path: u.pathname, ...p })
  let results = []
  if (u.pathname === '/search' && p.entity === 'musicArtist') results = [
    { wrapperType: 'artist', artistId: 100, artistName: 'Bones' },
    { wrapperType: 'artist', artistId: 200, artistName: 'Bones' },
  ]
  if (u.pathname === '/lookup' && p.entity === 'album') results = [
    p.id === '100'
      ? { wrapperType: 'collection', collectionId: 11, artistId: 100, artistName: 'Bones', collectionName: 'Other Artist Album', trackCount: 4, releaseDate: '2024-01-01' }
      : { wrapperType: 'collection', collectionId: 22, artistId: 200, artistName: 'Bones', collectionName: 'PaidProgramming2', trackCount: 12, releaseDate: '2025-01-01' },
  ]
  if (u.pathname === '/lookup' && p.entity === 'song') results = [
    { wrapperType: 'collection', collectionId: Number(p.id), artistId: 200, artistName: 'Bones', collectionName: 'PaidProgramming2', trackCount: 1 },
    { wrapperType: 'track', kind: 'song', collectionId: Number(p.id), artistName: 'Bones', trackName: 'Test song', collectionName: 'PaidProgramming2', trackNumber: 1 },
  ]
  if (u.pathname === '/lookup' && !p.entity && p.id === '200') results = [
    { wrapperType: 'artist', artistId: 200, artistName: 'Bones' },
  ]
  if (u.pathname === '/search' && p.entity === 'album') results = [
    { wrapperType: 'collection', collectionId: 22, artistName: 'Bones', collectionName: 'PaidProgramming2' },
    { wrapperType: 'collection', collectionId: 33, artistName: 'Other Bones', collectionName: 'PaidProgramming2' },
  ]
  return { ok: true, json: async () => ({ results }) }
}

test('library artist title hints select the matching identity, not the first namesake', async () => {
  const calls = []
  const result = await artistCatalogue({ artist: 'Bones', hints: ['PaidProgramming2'] }, { fetchImpl: mock(calls) })
  assert.equal(result.artistId, '200')
  assert.deepEqual(result.albums.map(album => album.title), ['PaidProgramming2'])
  assert.ok(calls.some(call => call.id === '200' && call.entity === 'album'))
})

test('explicit artist IDs never get replaced by another artist with the same name', async () => {
  const result = await artistCatalogue({
    artist: 'Bones', catalogue: 'apple', artistId: '200', hints: ['Other Artist Album'],
  }, { fetchImpl: mock([]) })
  assert.equal(result.artistId, '200')
  assert.deepEqual(result.albums.map(album => album.title), ['PaidProgramming2'])
})

test('ambiguous library artist names without a matching release are not guessed', async () => {
  const result = await artistCatalogue({ artist: 'Bones', hints: ['Unrelated library track'] }, { fetchImpl: mock([]) })
  assert.match(result.error, /Cannot verify/)
})

test('an exact Apple artist receives its own verified official portrait', async () => {
  const fallback = mock([])
  const fetchImpl = async url => {
    if (new URL(url).hostname === 'music.apple.com') return {
      ok: true, text: async () => '<meta content="https://is1-ssl.mzstatic.com/image/thumb/bones/600x600bb.jpg" property="og:image">',
    }
    return fallback(url)
  }
  const result = await artistCatalogue({
    artist: 'Bones', catalogue: 'apple', artistId: '200',
  }, { fetchImpl })
  assert.equal(result.image, 'https://is1-ssl.mzstatic.com/image/thumb/bones/600x600bb.jpg')
})

test('unverified external OG images cannot masquerade as artist portraits', async () => {
  const fallback = mock([])
  const fetchImpl = async url => {
    if (new URL(url).hostname === 'music.apple.com') return {
      ok: true, text: async () => '<meta property="og:image" content="https://unrelated.example/other.jpg">',
    }
    return fallback(url)
  }
  const result = await artistCatalogue({
    artist: 'Bones', catalogue: 'apple', artistId: '200',
  }, { fetchImpl })
  assert.equal(result.image, '')
})

test('album lookup uses exact collection IDs and returns the published track order', async () => {
  const calls = []
  const result = await albumCatalogue({
    artist: 'Bones', album: 'PaidProgramming2', catalogue: 'apple', catalogueId: '22',
  }, { fetchImpl: mock(calls) })
  assert.equal(result.title, 'PaidProgramming2')
  assert.equal(result.tracks[0].title, 'Test song')
  assert.ok(calls.some(call => call.id === '22' && call.entity === 'song'))
})

test('album name lookup rejects unrelated artist credits', async () => {
  const result = await albumCatalogue({ artist: 'Another', album: 'PaidProgramming2' }, { fetchImpl: mock([]) })
  assert.equal(result.tracks.length, 0)
})

test('album routes and cache keys isolate distinct source collection IDs', () => {
  const first = { artist: 'Bones', album: 'Same title', catalogue: 'apple', catalogueId: '22' }
  const second = { ...first, catalogueId: '33' }
  const parsed = new URLSearchParams(onlineAlbumPath(first).split('?')[1])
  assert.equal(parsed.get('catalogue'), 'apple')
  assert.equal(parsed.get('catalogueId'), '22')
  assert.notEqual(albumCacheKey(first), albumCacheKey(second))
})
