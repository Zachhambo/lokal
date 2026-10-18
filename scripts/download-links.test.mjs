import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artistResultKey, normalizeArtistResults } from '../src/downloadLinks.js'

test('artist search result keys include URLs when yt-dlp repeats the same result ID', () => {
  const results = normalizeArtistResults([
    { id: 'cowboy tr official artist channel', title: 'Cowboy TR', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLone' },
    { id: 'cowboy tr official artist channel', title: 'Cowboy TR', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLtwo' },
    { id: 'cowboy tr official artist channel', title: 'Cowboy TR', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLone' },
  ])

  assert.equal(results.length, 2)
  assert.notEqual(artistResultKey(results[0]), artistResultKey(results[1]))
  assert.equal(new Set(results.map(artistResultKey)).size, results.length)
})
