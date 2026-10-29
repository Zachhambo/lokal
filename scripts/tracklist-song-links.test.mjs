import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { navigateToArtistName, trackArtistParts } from '../src/artistLink.js'
import { navigateToTrackAlbum } from '../src/playbackContext.js'
import { artistCreditParts, keepCommaSet } from '../src/artistNames.js'

const source = readFileSync(new URL('../src/components/TrackList.jsx', import.meta.url), 'utf8')

test('shared TrackList links artist credits and both inline and standalone album columns', () => {
  assert.match(source, /import ArtistNames from '\.\/ArtistNames'/)
  assert.match(source, /columns\.artist && <ArtistNames track=\{track\}/)
  assert.match(source, /!layout\.album && <>[\s\S]*?<TrackAlbumLink track=\{track\} navigate=\{navigate\} inline/)
  assert.match(source, /layout\.album && \([\s\S]*?<TrackAlbumLink track=\{track\} navigate=\{navigate\}/)
  assert.match(source, /if \(!album\) \{[\s\S]*?return <span data-inline-album=/)
  assert.match(source, /onClick=\{event => \{ event\.stopPropagation\(\); navigateToTrackAlbum\(navigate, track\) \}\}/)
  assert.match(source, /onDoubleClick=\{event => event\.stopPropagation\(\)\}/)
})

test('song right-click actions include both artist and album destinations for one track', () => {
  assert.match(source, /one\?\.album && \{ label: 'Go to album', icon: Disc3, onSelect: \(\) => navigateToTrackAlbum\(navigate, one\) \}/)
  assert.match(source, /one\?\.artist && \{ label: 'Go to artist', icon: User, onSelect: \(\) => openTrackArtist\(one\) \}/)
  assert.match(source, /const firstArtist = trackArtistParts\(track, keepCommaSet\(keepCommaArtists\)\)/)
  assert.match(source, /return navigateToArtistName\(navigate, track, firstArtist \|\| track\?\.artist\)/)
  assert.match(source, /const one = list\.length === 1 \? list\[0\] : null/)
  assert.match(source, /onContextMenu=\{\(e\) => openTrackMenu\(e, track\)\}/)
})

test('library song album navigation carries artist and highlight into the album page', () => {
  const calls = []
  const row = { id: 'track-32', title: 'Title', artist: 'Artist', album: 'Album', album_artist: 'Album Artist', artwork_path: '/cover.png' }
  assert.equal(navigateToTrackAlbum((...args) => calls.push(args), row), true)
  assert.equal(calls[0][0], '/albums')
  assert.equal(calls[0][1].state.album.title, 'Album')
  assert.equal(calls[0][1].state.album.album_artist, 'Album Artist')
  assert.equal(calls[0][1].state.highlightTrackId, 'track-32')
  assert.equal(navigateToTrackAlbum((...args) => calls.push(args), { ...row, album: null }), false)
  assert.equal(calls.length, 1)
})

test('song artist navigation preserves comma names and resolves the primary credit', () => {
  const row = { id: 'track-33', title: 'Title', artist: 'Earth, Wind & Fire', album: 'I Am' }
  const primaryName = trackArtistParts(row, keepCommaSet()).find(part => part.artist)?.artist
  assert.equal(primaryName, 'Earth, Wind & Fire')
  const calls = []
  assert.equal(navigateToArtistName((...args) => calls.push(args), row, primaryName), true)
  assert.equal(calls[0][0], '/artist/a-earth-wind-fire')
  assert.equal(calls[0][1].state.name, 'Earth, Wind & Fire')

  const collaboration = { id: 'track-44', title: 'Collab', artist: 'Main Artist (feat. Guest Singer)' }
  const main = trackArtistParts(collaboration, keepCommaSet()).find(part => part.artist)?.artist
  assert.equal(main, 'Main Artist')
  const collabCalls = []
  assert.equal(navigateToArtistName((...args) => collabCalls.push(args), collaboration, main), true)
  assert.equal(collabCalls[0][0], '/artist/a-main-artist')
})

test('artist-credit links can navigate each featured performer, not play the row', () => {
  const row = { id: 'track-34', title: 'Some Song', artist: 'Main Artist (feat. Guest Singer)' }
  const parts = artistCreditParts(row.artist, keepCommaSet())
  assert.deepEqual(parts.filter(part => part.artist).map(part => part.artist), ['Main Artist', 'Guest Singer'])
  const calls = []
  assert.equal(navigateToArtistName((...args) => calls.push(args), row, 'Guest Singer'), true)
  assert.equal(calls[0][0], '/artist/a-guest-singer')
  const artistComponent = readFileSync(new URL('../src/components/ArtistNames.jsx', import.meta.url), 'utf8')
  assert.match(artistComponent, /event\.stopPropagation\(\); onNavigate\?\.\(\); navigateToArtistName/)
  assert.match(artistComponent, /onDoubleClick=\{event => event\.stopPropagation\(\)\}/)
})

test('streamed track navigation keeps online artist and album destination behavior', () => {
  const online = {
    id: 'online-1',
    title: 'Stream Track',
    artist: 'Online Artist',
    album: 'Online Album',
    file_path: 'ghost://addon/0123456789/song-1',
    source_album_id: 'B012345',
  }
  const albums = []
  assert.equal(navigateToTrackAlbum((...args) => albums.push(args), online), true)
  assert.equal(albums[0][0].split('?')[0], '/online/album')
  assert.equal(new URLSearchParams(albums[0][0].split('?')[1]).get('sourceAlbum'), 'B012345')
  const artists = []
  assert.equal(navigateToArtistName((...args) => artists.push(args), online, 'Online Artist'), true)
  assert.equal(artists[0][0], '/artist/a-online-artist')
  assert.equal(artists[0][1].state.anchor.title, 'Stream Track')
})
