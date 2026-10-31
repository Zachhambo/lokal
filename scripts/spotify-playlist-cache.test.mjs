import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { createSpotifyPlaylistCache, AUTO_UPDATE_MS, FAILURE_RETRY_MS } = require('../electron/ipc/spotifyPlaylistCache.js')

test('playlist and track caches survive restart, obey the opt-in daily interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lokal-spotify-'))
  try {
    const file = join(dir, 'playlist-cache.json')
    let now = 100000
    let cache = createSpotifyPlaylistCache(file, { now: () => now })
    assert.equal(cache.read('private-cookie', 'libraryPlaylists'), null)
    cache.save('private-cookie', 'libraryPlaylists', { playlists: [{ id: 'a', name: 'One' }] })
    cache.save('private-cookie', 'libraryPlaylist:a', { title: 'One', tracks: [{ title: 'Track' }] })
    cache = createSpotifyPlaylistCache(file, { now: () => now })
    assert.equal(cache.read('private-cookie', 'libraryPlaylists').value.playlists[0].name, 'One')
    assert.equal(cache.read('private-cookie', 'libraryPlaylist:a').value.tracks[0].title, 'Track')
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', false), false)
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', true), false)
    now += AUTO_UPDATE_MS + 1
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', true), true)
    cache.failed('private-cookie', 'libraryPlaylists')
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', true), false)
    now += FAILURE_RETRY_MS + 1
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', true), true)
    cache.save('private-cookie', 'libraryPlaylists', { playlists: [] })
    assert.equal(cache.read('private-cookie', 'libraryPlaylists').value.playlists.length, 0)
    assert.equal(cache.due('private-cookie', 'libraryPlaylists', true), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('switching account or signing out never shows the previous account playlists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lokal-spotify-'))
  try {
    const file = join(dir, 'cache.json')
    const cache = createSpotifyPlaylistCache(file)
    cache.save('cookie-for-account-one', 'libraryPlaylists', { playlists: [{ id: 'secret' }] })
    assert.equal(cache.read('cookie-for-account-two', 'libraryPlaylists'), null)
    assert.equal(cache.read('', 'libraryPlaylists'), null)
    const reloaded = createSpotifyPlaylistCache(file)
    assert.equal(reloaded.read('cookie-for-account-one', 'libraryPlaylists'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
