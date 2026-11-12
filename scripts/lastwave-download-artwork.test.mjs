import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const { finishFile } = require('../electron/download/postprocess')
const { fetchBestCover } = require('../electron/download/coverQuality')
const { DownloadManager } = require('../electron/download/manager')
const { parseFile } = await import('music-metadata')

async function stagedAudio(t) {
  const dir = await mkdtemp(join(tmpdir(), 'lastwave-cover-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'staged.m4a')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'aac', '-movflags', 'empty_moov+frag_keyframe+default_base_moof', file])
  return { dir, file }
}

test('an addon download with missing source artwork embeds the strictly matched fallback cover', async t => {
  const { dir, file } = await stagedAudio(t)
  const image = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#994488' } }).jpeg().toBuffer()
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).startsWith('https://api.deezer.com/search')) return Response.json({ data: [
      { title: 'Another Song', artist: { name: 'Artist' }, album: { cover_xl: 'https://covers.example/wrong.jpg' } },
      { title: 'Coverless Song', artist: { name: 'Artist' }, album: { cover_xl: 'https://covers.example/right.jpg' } },
    ] })
    assert.equal(url, 'https://covers.example/right.jpg')
    return new Response(image, { headers: { 'content-type': 'image/jpeg' } })
  })
  const original = await readFile(file)
  const manager = new DownloadManager().configure({
    getDB: () => ({ prepare: () => ({ get: () => null, all: () => [], run() {} }) }),
    findTools: () => ({ ffmpeg: 'ffmpeg' }),
  })
  manager.initialized = true
  manager.settings = () => ({ music_folder: join(dir, 'library'), download_embed_lyrics: '0' })
  let indexedFile
  manager.indexOne = async (_, path) => { indexedFile = path }
  const job = manager.makeJob('single', 'lokal-addon://a-0123456789/coverless', {
    title: 'Artist - Coverless Song', addonSource: { provider: 'a-0123456789', id: 'coverless' },
    tags: { title: 'Coverless Song', artist: 'Artist', album: 'Album' },
  })
  manager.jobs.set(job.id, job)
  manager.startAddonArtifact(job, async () => ({ file }))
  const end = Date.now() + 5000
  while (manager.running && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(job.status, 'done', job.error)
  const metadata = await parseFile(indexedFile)
  assert.equal(metadata.common.picture?.length, 1)
  assert.equal(metadata.common.title, 'Coverless Song')
  assert.equal(job.opts.tags.cover, 'https://covers.example/right.jpg')
  assert.deepEqual(await readFile(file), original, 'download tagging preserves the playback cache')
})

test('modern CDN artwork is converted to a portable JPEG before embedding into staged M4A', async t => {
  const { dir, file } = await stagedAudio(t)
  const bytes = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#446699' } }).webp().toBuffer()
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'content-type': 'image/webp' } }))
  const done = await finishFile(file, {
    settings: { download_embed_lyrics: '0' }, outputDir: dir,
    known: { title: 'WebP Song', artist: 'Artist', cover: 'https://covers.example/image' },
  })
  const picture = (await parseFile(done.filePath)).common.picture?.[0]
  assert.equal(picture?.format, 'image/jpeg')
  assert.equal((await sharp(picture.data).metadata()).width, 640)
})

test('cover downloads validate image bytes when a CDN uses a generic content type', async () => {
  const bytes = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#448899' } }).jpeg().toBuffer()
  const cover = await fetchBestCover('https://covers.example/generic', {
    fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
  })
  assert.equal(cover?.width, 640)
})
