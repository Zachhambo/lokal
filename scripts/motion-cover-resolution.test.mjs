import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { chooseVariant, motionCoverFor } = require('../electron/artwork/motion.js')

const playlist = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1080,CODECS="avc1.640028"',
  '1080-avc.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=2160x2160,CODECS="hvc1.2.20000000.H150.B0"',
  '2160-hevc.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=2160x2160,CODECS="avc1.640033"',
  '2160-avc.m3u8',
].join('\n')

test('high-resolution moving covers prefer 2160p HEVC without capability detection', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, text: async () => playlist })
  try {
    assert.equal(
      await chooseVariant('https://example.test/master.m3u8', { highResolution: true }),
      'https://example.test/2160-hevc.m3u8',
    )
    assert.equal(
      await chooseVariant('https://example.test/master.m3u8'),
      'https://example.test/1080-avc.m3u8',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

const track = { title: 'Track', artist: 'Artist', album: 'Album' }
const settings = { motion_cover_sources: '["tidal","spotify"]' }

test('replays both legacy files offline regardless of lookup age or source priority', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lokal-motion-test-'))
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE motion_covers (key TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER)')
    const insert = db.prepare('INSERT INTO motion_covers VALUES (?, ?, ?)')
    const covers = [
      ['tidal,spotify', { source: 'tidal', url: 'https://example.test/cover.m3u8', kind: 'hls' }],
      ['spotify,tidal', { source: 'spotify', url: 'https://example.test/canvas.mp4', kind: 'mp4', tall: true }],
    ]
    for (const [order, clip] of covers) {
      const hash = createHash('sha1').update(clip.url + '|default').digest('hex').slice(0, 20)
      writeFileSync(join(dir, hash + '.mp4'), Buffer.alloc(1024))
      insert.run(`track|artist|album|${order}|v3|s3`, JSON.stringify(clip), 0)
    }
    const options = { settings, cacheDir: dir, offline: true }
    assert.equal((await motionCoverFor(db, track, options)).source, 'tidal')
    options.settings = { ...settings, spotify_canvas_first: '1', high_resolution_motion_covers: '1' }
    assert.equal((await motionCoverFor(db, track, options)).source, 'spotify')
    options.settings = { ...options.settings, motion_cover_sources: '["tidal"]' }
    assert.equal((await motionCoverFor(db, track, options)).source, 'tidal')
    options.settings.motion_covers = '0'
    assert.equal(await motionCoverFor(db, track, options), null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prepares the enabled Canvas while the motion cover is selected, then switches offline', { timeout: 5000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lokal-motion-test-'))
  const db = new DatabaseSync(':memory:')
  const spotify = require('../electron/artwork/spotify')
  const cache = require('../electron/cache')
  const original = { fetch: globalThis.fetch, fromSpotify: spotify.fromSpotify, trim: cache.trim }
  const canvasURL = 'https://example.test/canvas.mp4'
  let canvasDownload
  const canvasStarted = new Promise(resolve => { canvasDownload = resolve })
  Object.defineProperty(process.versions, 'electron', { value: 'test', configurable: true })
  spotify.fromSpotify = async () => ({ source: 'spotify', url: canvasURL, kind: 'mp4', tall: true })
  cache.trim = () => {}
  globalThis.fetch = async url => {
    if (url.startsWith('https://api.tidal.com/')) {
      return { ok: true, json: async () => ({
        tracks: { items: [{
          title: track.title,
          artists: [{ name: track.artist }],
          album: { title: track.album, videoCover: 'a-b-c-d-e' },
        }] },
      }) }
    }
    if (url === canvasURL) canvasDownload()
    return { ok: true, arrayBuffer: async () => new Uint8Array(1024).buffer }
  }
  try {
    const options = { settings: { ...settings, spotify_sp_dc: 'test' }, cacheDir: dir }
    assert.equal((await motionCoverFor(db, track, options)).source, 'tidal')
    await canvasStarted
    const spotifyFirst = { ...options.settings, spotify_canvas_first: '1' }
    // Join the already-started background download before simulating restart.
    assert.equal((await motionCoverFor(db, track, { ...options, settings: spotifyFirst })).source, 'spotify')
    let networkCalls = 0
    globalThis.fetch = async () => { networkCalls++; throw new Error('offline') }
    const offline = { cacheDir: dir, offline: true }
    assert.equal((await motionCoverFor(db, track, { ...offline, settings: spotifyFirst })).source, 'spotify')
    assert.equal((await motionCoverFor(db, track, { ...offline, settings })).source, 'tidal')
    assert.equal(networkCalls, 0)
  } finally {
    globalThis.fetch = original.fetch
    spotify.fromSpotify = original.fromSpotify
    cache.trim = original.trim
    delete process.versions.electron
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
