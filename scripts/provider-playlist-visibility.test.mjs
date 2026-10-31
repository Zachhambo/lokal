import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hiddenPlaylistIds, setPlaylistHidden } from '../src/providerPlaylistVisibility.js'

test('hidden choices persist for a specific provider and account without deleting playlists', () => {
  const memory = new Map()
  globalThis.localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null },
    setItem(key, value) { memory.set(key, String(value)) },
  }
  const accountOne = 'a'.repeat(64), accountTwo = 'b'.repeat(64)
  assert.deepEqual(hiddenPlaylistIds('spotify', accountOne), [])
  assert.deepEqual(setPlaylistHidden('spotify', accountOne, 'playlist-one', true), ['playlist-one'])
  assert.deepEqual(setPlaylistHidden('spotify', accountOne, 'playlist-two', true), ['playlist-one', 'playlist-two'])
  assert.deepEqual(hiddenPlaylistIds('youtube', accountOne), [])
  assert.deepEqual(hiddenPlaylistIds('spotify', accountTwo), [])
  assert.deepEqual(setPlaylistHidden('spotify', accountOne, 'playlist-one', false), ['playlist-two'])
  assert.deepEqual(hiddenPlaylistIds('spotify', accountOne), ['playlist-two'])
  assert.equal(memory.size, 1)
})

test('missing account identity does not persist or leak selections', () => {
  assert.deepEqual(setPlaylistHidden('youtube', '', 'playlist', true), [])
  assert.deepEqual(hiddenPlaylistIds('youtube', ''), [])
})
