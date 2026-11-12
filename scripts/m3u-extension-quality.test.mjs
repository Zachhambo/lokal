import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseM3U, basename, findByFilename } = require('../electron/playlists/importM3u.js')
const { addonDownloadQuality } = require('../electron/mornye/playbackQuality.js')

test('M3U parser handles BOM, Windows paths and EXTINF metadata', () => {
  const entries = parseM3U('\uFEFF#EXTM3U\r#EXTINF:190,Artist - Title - Live\r' +
    'C:\\Music\\Title.mp3\r#EXTINF:-1,Other Artist - Outro\r"relative/Outro.flac"\r')
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], {
    file_path: 'C:\\Music\\Title.mp3', title: 'Title - Live', artist: 'Artist', duration: 190,
  })
  assert.deepEqual(entries[1], {
    file_path: 'relative/Outro.flac', title: 'Outro', artist: 'Other Artist', duration: -1,
  })
})

test('unannotated M3U imports artist-title file names after URL decoding', () => {
  assert.deepEqual(parseM3U('#EXTM3U\nMusic/Artist%20-%20Track.flac\n'), [{
    file_path: 'Music/Artist%20-%20Track.flac',
    title: 'Track', artist: 'Artist', duration: null,
  }])
  assert.equal(basename('file:///C:/Music/My%20Song.flac'), 'My Song.flac')
})

test('match relocated files by a unique real filename, never by guesswork', () => {
  const fileRows = [
    { id: '1', file_path: '/new-device/Music/Track.flac', title: 'Track', artist: 'Artist' },
    { id: '2', file_path: '/other/Music/Other.flac', title: 'Other', artist: 'Artist' },
  ]
  const db = { prepare() { return { all() { return fileRows } } } }
  assert.deepEqual(findByFilename(db, { file_path: 'C:\\Old\\Track.flac' }), { id: '1' })
  assert.equal(findByFilename(db, { file_path: 'Missing.flac' }), null)
  const duplicate = { prepare() { return { all() {
    return [...fileRows, { id: '3', file_path: '/second/Track.flac', title: 'Remix', artist: 'Other' }]
  } } } }
  assert.equal(findByFilename(duplicate, { file_path: 'Track.flac' }), null)
  assert.deepEqual(findByFilename(duplicate, {
    file_path: 'Track.flac', title: 'Track', artist: 'Artist',
  }), { id: '1' })
})

test('preserve unique longest path tail when file names repeat', () => {
  const db = { prepare() { return { all() { return [
    { id: 'a', file_path: '/Music/Album A/Track.flac', title: 'Track', artist: 'One' },
    { id: 'b', file_path: '/Music/Album B/Track.flac', title: 'Track', artist: 'Two' },
  ] } } } }
  assert.deepEqual(findByFilename(db, {
    file_path: 'C:\\Old\\Album A\\Track.flac',
  }), { id: 'a' })
  assert.equal(findByFilename(db, { file_path: 'Track.flac' }), null)
  assert.deepEqual(findByFilename(db, {
    file_path: 'Track.flac', title: 'Track', artist: 'Two',
  }), { id: 'b' })
})

test('Mornye download choice overrides preference but rejects undeclared tiers', () => {
  const addon = {
    name: 'tidal-web',
    manifest: { qualityOptions: [
      { id: 'HIGH', kind: 'lossy' },
      { id: 'LOSSLESS', kind: 'lossless' },
      { id: 'DOLBY_ATMOS', kind: 'spatial' },
    ] },
  }
  const settings = { downloadQuality: 'HIGH' }
  assert.equal(addonDownloadQuality(addon, settings, { quality: 'LOSSLESS' }), 'LOSSLESS')
  assert.equal(addonDownloadQuality(addon, settings), 'HIGH')
  assert.throws(() => addonDownloadQuality(addon, settings, { quality: 'ULTRA_FAKE' }), /does not offer/)
  assert.throws(() => addonDownloadQuality(addon, settings, { quality: 'DOLBY_ATMOS' }), /authorization/)
  assert.equal(addonDownloadQuality(addon, settings, { quality: 'DOLBY_ATMOS', allowAtmos: true }), 'DOLBY_ATMOS')
})
