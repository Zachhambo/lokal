import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mono = require('../electron/online/monochrome.js')
const sources = require('../electron/online/sources.js')

test('Monochrome search uses the official source and normalizes usable tracks', async () => {
  let requests = 0
  const rows = await mono.searchTracks('Daft Punk', {
    fetchImpl: async (url, options) => {
      requests++
      const request = new URL(url)
      assert.equal(request.host, 'tracks.monochrome.st')
      assert.equal(request.pathname, '/search/tracks')
      assert.equal(request.searchParams.get('q'), 'Daft Punk')
      assert.equal(options.redirect, 'error')
      return { ok: true, json: async () => ({ tracks: [
        { trackId:'155142501534011392', title:'Get Lucky', artistNames:['Daft Punk', 'Pharrell Williams'], duration:369626, artwork:'https://tracks.monochrome.st/cover.jpg', playable:true },
        { trackId:'155142501534011392', title:'Duplicate' },
        { trackId:'../../bad', title:'Invalid' },
        { trackId:'155142501534011393', title:'Unavailable', playable:false },
      ]}) }
    }
  })
  assert.equal(requests, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].provider, 'mono')
  assert.equal(rows[0].duration, 370)
  assert.equal(rows[0].artist, 'Daft Punk, Pharrell Williams')
  assert.equal(rows[0].thumbnail, 'https://tracks.monochrome.st/cover.jpg')
  assert.equal(sources.validId('mono',rows[0].id),true)
  assert.deepEqual(sources.streamRef({file_path:sources.ghostPath('mono',rows[0].id)}), {provider:'mono',id:rows[0].id})
  assert.equal(sources.sourceIdentity(rows[0].url), 'mono:155142501534011392')
  const stream = await sources.resolveStream('mono',rows[0].id)
  assert.equal(stream.url,'https://tracks.monochrome.st/track/155142501534011392')
  assert.equal(stream.mime,'audio/flac')
})

test('Monochrome rejects path traversal, foreign hosts and malformed IDs', async () => {
  assert.equal(mono.idFromUrl('https://evil.example/track/155142501534011392'), null)
  assert.equal(mono.idFromUrl('http://tracks.monochrome.st/track/155142501534011392'), null)
  assert.equal(mono.idFromUrl('https://tracks.monochrome.st/track/155142501534011392'), '155142501534011392')
  assert.equal(sources.validId('mono','../fake'),false)
  await assert.rejects(sources.resolveStream('mono','../fake'), /Unknown online song/)
})

test('Monochrome search error does not fall through to YouTube', async () => {
  await assert.rejects(mono.searchTracks('artist', {
    fetchImpl: async () => ({ ok:false, status: 503 })
  }), /HTTP 503/)
})
