import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { api } from '../src/api.js'
import { saveToLibrary } from '../src/onlineTracks.js'

const require = createRequire(import.meta.url)
const sources = require('../electron/online/sources.js')
const { DownloadManager } = require('../electron/download/manager.js')
const base = 'https://downloads.example/addon'
const mpd = '<MPD type="static"><Period><AdaptationSet mimeType="audio/mp4">' +
  '<Representation id="audio" bandwidth="800000"><SegmentTemplate ' +
  'initialization="https://cdn.example/init.m4a" media="https://cdn.example/part-$Number$.m4s">' +
  '<SegmentTimeline><S d="48000" r="1"/></SegmentTimeline>' +
  '</SegmentTemplate></Representation></AdaptationSet></Period></MPD>'
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

async function fixture(t) {
  const rows = new Map()
  const db = { prepare: () => ({
    get: key => rows.has(key) ? { value: rows.get(key) } : undefined,
    run: (key, value) => rows.set(key, value), all: () => [],
  }) }
  const addon = await sources.addons.install(db, base + '/manifest.json', {
    fetchImpl: async () => json({ id: 'download-fixture', name: 'LastWave fixture', version: '1', resources: ['search', 'stream'] }),
  })
  const source = { provider: 'a-' + addon.key, id: 'track/with:identity' }
  const directory = await mkdtemp(join(tmpdir(), 'lokal-http-download-'))
  const mgr = new DownloadManager().configure({ getDB: () => db, findTools: () => ({}) })
  mgr.initialized = true
  mgr.settings = () => ({ music_folder: directory })
  const finished = []
  // Exercise the real queue, resolution, file copy and exit handling. The
  // postprocessor boundary writes a tag to prove it cannot alter cached audio.
  mgr.afterFile = (job, file) => {
    job.post = job.post.then(async () => {
      await appendFile(file, 'TAG')
      finished.push({ file, sourceRef: job.sourceRef, opts: job.opts })
      job.downloadedTracks.push(file)
    })
  }
  t.after(async () => { clearTimeout(mgr.addonWake); await rm(directory, { recursive: true, force: true }) })
  return { db, addon, source, directory, mgr, finished }
}

async function settled(mgr, id) {
  for (let n = 0; n < 200; n++) {
    const job = mgr.jobs.get(id)
    if (!mgr.running && !['queued', 'downloading'].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('addon download did not finish')
}

test('Discovery Save downloads staged DASH audio with no direct URL or yt-dlp', async t => {
  const { db, source, mgr, finished } = await fixture(t)
  let requests = 0
  let cachedFile
  const payload = Buffer.from('INITONETWO')
  mgr.configure({ resolveAddonStream: async (provider, id) => {
    const stream = await sources.resolveStream(provider, id, {
      db, force: true, download: true,
      addonFetch: async url => {
        if (url.startsWith(base + '/stream/')) { requests++; return json({ manifestXml: mpd }) }
        return new Response(url.includes('/init.m4a') ? 'INIT' : url.includes('/part-1.m4s') ? 'ONE' : 'TWO')
      },
    })
    assert.equal(stream.url, null, 'the reported failure: DASH has a file instead of a URL')
    cachedFile = stream.file
    return stream
  } })
  t.after(async () => { if (cachedFile) await rm(cachedFile, { force: true }) })
  t.mock.method(api, 'onlineDownloadUrl', async (provider, id) => sources.addonDownloadRequest(db, provider, id))
  t.mock.method(api, 'downloadYT', async (url, opts) => {
    assert.equal(url, `lokal-addon://${source.provider}/${encodeURIComponent(source.id)}`)
    assert.equal(requests, 0, 'media is resolved only by the queued job')
    return mgr.enqueue('single', url, opts)
  })
  const result = await saveToLibrary({
    id: 'discovery-ghost', title: 'Song', artist: 'Artist', album: 'Album',
    file_path: `ghost://addon/${source.provider.slice(2)}/${encodeURIComponent(source.id)}`,
  })
  assert.ok(result.downloadId, JSON.stringify(result))
  const job = await settled(mgr, result.downloadId)
  assert.equal(job.status, 'done', job.error)
  assert.equal(requests, 1, 'no duplicate preflight staging')
  assert.deepEqual(await readFile(cachedFile), payload, 'playback cache remains intact')
  assert.deepEqual(await readFile(finished[0].file), Buffer.concat([payload, Buffer.from('TAG')]))
  assert.notEqual(finished[0].file, cachedFile)
  assert.equal(finished[0].sourceRef, source.provider + ':' + source.id)
  assert.equal(finished[0].opts.replaceTrackId, 'discovery-ghost')
  assert.equal(finished[0].opts.tags.album, 'Album')
})

test('opaque addon downloads reject unknown, disabled or mismatched identities and local paths', async t => {
  const { db, source, addon, mgr } = await fixture(t)
  const url = sources.addonDownloadRequest(db, source.provider, source.id).url
  assert.ok(mgr.enqueue('single', url, { addonSource: { ...source, id: 'another-track' } }).error)
  assert.ok(mgr.enqueue('single', 'file:///private/audio.m4a', { addonSource: source }).error)
  assert.ok(sources.addonDownloadRequest(db, 'a-0000000000', 'track').error)
  assert.ok(sources.addonDownloadRequest(db, source.provider, 'bad\nid').error)
  sources.addons.setEnabled(db, addon.key, false)
  assert.ok(sources.addonDownloadRequest(db, source.provider, source.id).error)
  assert.ok(mgr.enqueue('single', url, { addonSource: source }).error)
})

test('cancel during staging never imports the late file and releases the queue slot', async t => {
  const { db, source, directory, mgr, finished } = await fixture(t)
  let complete
  mgr.configure({ resolveAddonStream: () => new Promise(resolve => { complete = resolve }) })
  const url = sources.addonDownloadRequest(db, source.provider, source.id).url
  const result = mgr.enqueue('single', url, { title: 'Song', addonSource: source })
  await new Promise(resolve => setImmediate(resolve))
  await mgr.cancel(result.downloadId)
  complete({ type: 'file', file: join(directory, 'must-not-be-read.m4a') })
  assert.equal((await settled(mgr, result.downloadId)).status, 'cancelled')
  assert.equal(mgr.running, 0)
  assert.deepEqual(finished, [])
  assert.deepEqual(await readdir(directory), [])
})

test('missing staged files become visible queue errors', async t => {
  const { db, source, directory, mgr, finished } = await fixture(t)
  mgr.configure({ resolveAddonStream: async () => ({ type: 'file', file: join(directory, 'missing.m4a') }) })
  const result = mgr.enqueue('single', sources.addonDownloadRequest(db, source.provider, source.id).url, { title: 'Song', addonSource: source })
  const job = await settled(mgr, result.downloadId)
  assert.equal(job.status, 'error')
  assert.match(job.error, /ENOENT/)
  assert.deepEqual(finished, [])
})

test('direct HTTP addon results still reach the regular downloader', async t => {
  const { db, source, mgr, finished } = await fixture(t)
  const direct = 'https://cdn.example/song.flac'
  mgr.configure({ resolveAddonStream: async () => ({ url: direct, format: 'flac' }) })
  // Stop at the normal downloader's tool check, before spawning an external process.
  let checked = 0
  mgr.checkTools = () => { checked++; return { error: 'fixture downloader reached' } }
  const result = mgr.enqueue('single', sources.addonDownloadRequest(db, source.provider, source.id).url, { title: 'Song', addonSource: source })
  const job = await settled(mgr, result.downloadId)
  assert.equal(checked, 1)
  assert.equal(job.url, direct)
  assert.equal(job.error, 'fixture downloader reached')
  assert.deepEqual(finished, [])
})

test('package artifacts still import metadata and clean up their private staging file', async t => {
  const { db, source, directory, mgr, finished } = await fixture(t)
  const file = join(directory, 'package-staging.flac')
  await writeFile(file, 'PACKAGE')
  t.mock.method(mgr, 'isPackageSource', () => true)
  t.mock.method(mgr, 'downloadPackageWithVerification', async () => ({
    file, metadata: { title: 'Package Song', album: 'Package Album' },
    cleanup: () => rm(file),
  }))
  const result = mgr.enqueue('single', sources.addonDownloadRequest(db, source.provider, source.id).url, { title: 'Package Song', addonSource: source })
  assert.equal((await settled(mgr, result.downloadId)).status, 'done')
  assert.equal(finished[0].opts.tags.album, 'Package Album')
  assert.equal((await readFile(finished[0].file)).toString(), 'PACKAGETAG')
  await assert.rejects(readFile(file), /ENOENT/)
})
