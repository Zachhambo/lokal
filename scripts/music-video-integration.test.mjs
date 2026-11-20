import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const storage = require('../electron/online/musicVideoDownloads.js')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-stack-'))
  const old = path.join(root, 'music-video-cache')
  const videos = path.join(root, 'Videos')
  fs.mkdirSync(old)
  const db = new Database(':memory:')
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration REAL, file_path TEXT, clip_url TEXT, clip_start REAL, clip_end REAL, clip_transfer_file TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE download_jobs (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)')
  db.prepare('INSERT INTO tracks (id, title, artist, duration, file_path) VALUES (?, ?, ?, ?, ?)').run('track-id', 'Song', 'Artist', 200, path.join(root, 'song.mp3'))
  fs.writeFileSync(path.join(root, 'song.mp3'), 'audio')
  const video = { videoId: 'abcdefghijk', title: 'Song', artist: 'Artist', duration: 200, segments: [{ start: 0, end: null, offset: 0 }], check: 'length' }
  const file = path.join(old, 'abcdefghijk-720.mp4')
  fs.writeFileSync(file, 'video')
  const metadata = path.join(root, 'music-videos.json')
  fs.writeFileSync(metadata, JSON.stringify({ 'v2|track-id|song|artist|200': { at: 1, video } }))
  const filename = require.resolve('../electron/ipc/online.js')
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const manager = { jobs: new Map(), persist() {}, emit() {} }
  let queued = 0
  const context = vm.createContext({
    require: id => {
      if (id === './db') return { getDB: () => db }
      if (id === './tools') return { findYtDlp: () => null, findFfmpeg: () => null }
      if (id === 'electron') return { app: { getPath: name => name === 'videos' ? videos : root } }
      if (id === '../cache') return { cacheDir: () => old }
      if (id === '../online/musicVideoDownloads') return { ...storage, videosDir: () => videos, peekDurableVideoFile: (id, options) => storage.peekDurableVideoFile(id, { ...options, videosDir: videos }) }
      if (id === '../online/youtubeSession') return { createYouTubeSession: () => ({ credentials: async () => ({}) }) }
      if (id === '../discoveryArtwork') return { createArtworkResolver: () => () => [] }
      if (id === '../online/sources') return { pruneOnlineTracks() {}, addons: { refreshManifests: async () => {} } }
      if (id === '../online/musicVideo') return { ...localRequire(id), findMusicVideo: () => { throw new Error('Local downloads must not rescan YouTube') } }
      if (id === './downloader') return { manager: () => manager, queueMusicVideo: () => { queued++; return { downloadId: 'queued' } } }
      return localRequire(id)
    },
    module, console, process, Buffer, URL, setTimeout: () => ({ unref() {} }), clearTimeout,
  })
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return { db, root, old, videos, file, video, metadata, online: module.exports, queued: () => queued, cleanup: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

test('v2 local downloads survive v3 invalidation and expose offline playable hover-preview files', async () => {
  const state = fixture()
  try {
    const rows = state.online.listMusicVideos()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].downloaded, true)
    assert.equal(rows[0].video.file, state.file)
    const prepared = await state.online.prepareMusicVideoFor('track-id')
    assert.equal(prepared.file, state.file)
    assert.equal(state.queued(), 0)
  } finally { state.cleanup() }
})

test('renamed local tracks retain downloaded v2 metadata without a network rescan', async () => {
  const state = fixture()
  try {
    state.db.prepare('UPDATE tracks SET title = ?, artist = ?').run('Renamed song', 'Renamed artist')
    const rows = state.online.listMusicVideos()
    assert.equal(rows[0].track.artist, 'Renamed artist')
    assert.equal(rows[0].video.file, state.file)
    assert.equal((await state.online.prepareMusicVideoFor('track-id')).file, state.file)
    assert.equal(state.queued(), 0)
  } finally { state.cleanup() }
})

test('prepare never queues a replacement download after explicit deletion', async () => {
  const state = fixture()
  try {
    fs.writeFileSync(state.metadata, JSON.stringify({ 'v3|track-id|song|artist|200': { at: Date.now(), video: { ...state.video, motion: 'verified' } } }))
    const handlers = new Map()
    state.online.registerOnlineHandlers({ handle: (name, fn) => handlers.set(name, fn) })
    assert.equal((await handlers.get('musicVideo:deleteDownload')(null, 'track-id')).success, true)
    assert.equal(fs.existsSync(state.file), false)
    assert.equal(fs.existsSync(path.join(state.root, 'song.mp3')), true)
    for (let attempt = 0; attempt < 2; attempt++) {
      const prepared = await state.online.prepareMusicVideoFor('track-id')
      assert.equal(prepared.needsDownload, true)
      assert.equal(prepared.file, null)
    }
    assert.equal(state.queued(), 0)
    const downloaded = await state.online.prepareMusicVideoFor('track-id', { download: true })
    assert.equal(downloaded.downloadId, 'queued')
    assert.equal(state.queued(), 1)
  } finally { state.cleanup() }
})

test('video deletion refuses audio extensions and any files referenced by the audio library', () => {
  const state = fixture()
  try {
    const audio = path.join(state.root, 'song.mp3')
    storage.rememberVideoFile(state.db, state.video, audio, 1080)
    assert.throws(() => storage.deleteVideoFiles(state.db, state.video.videoId), /audio library/)
    assert.equal(fs.existsSync(audio), true)
    storage.rememberVideoFile(state.db, state.video, state.file, 1080)
    state.db.prepare('UPDATE tracks SET file_path = ?').run(state.file)
    assert.throws(() => storage.deleteVideoFiles(state.db, state.video.videoId), /audio library/)
    assert.equal(fs.existsSync(state.file), true)
  } finally { state.cleanup() }
})

test('a manual file or YouTube Music clip replaces the known match and clearing it restores discovery', async () => {
  const state = fixture()
  try {
    const handlers = new Map()
    state.online.registerOnlineHandlers({ handle: (name, fn) => handlers.set(name, fn) })
    const currentLink = () => handlers.get('musicVideo:currentLink')(null, 'track-id')
    const prepare = () => state.online.prepareMusicVideoFor('track-id')
    const update = state.db.prepare('UPDATE tracks SET clip_url = ?, clip_start = ?, clip_end = ?')
    assert.equal(currentLink(), 'https://www.youtube.com/watch?v=abcdefghijk')
    const file = path.join(state.root, 'Video #1.mp4')
    fs.writeFileSync(file, 'manual video')
    update.run(file, 15, 28)
    const local = await prepare()
    assert.equal(local.src, pathToFileURL(file).href)
    assert.equal(local.clip.start, 15)
    assert.equal(local.clip.end, 28)
    const card = state.online.listMusicVideos()[0]
    assert.equal(card.video.file, file)
    assert.equal(card.downloaded, false)
    assert.equal(currentLink(), null)
    const link = 'https://music.youtube.com/watch?v=zyxwvutsrqp&list=ignored'
    update.run(link, 17, 26)
    const youtube = await prepare()
    assert.equal(youtube.videoId, 'zyxwvutsrqp')
    assert.equal(youtube.needsDownload, true)
    assert.equal(youtube.clip.start, 17)
    assert.equal(youtube.clip.end, 26)
    update.run(null, null, null)
    assert.equal((await prepare()).videoId, 'abcdefghijk')
  } finally { state.cleanup() }
})

test('paired phones can retrieve selected clip metadata and bytes only for that selection', () => {
  const state = fixture()
  try {
    const filename = require.resolve('../server/routes/remote.js')
    const localRequire = createRequire(filename)
    const get = new Map()
    const router = { get: (path, handler) => get.set(path, handler), post() {}, use() {} }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module: { exports: {} }, URL, require(id) {
        if (id === 'express') return { Router: () => router }
        if (id === '../../electron/ipc/db') return { getDB: () => state.db }
        if (id === '../../electron/ipc/remote') return { getRemoteState: () => ({ userId: 'owner' }) }
        return localRequire(id)
      },
    }, { filename })
    const route = get.get('/files/:trackId/clip')
    function request(query, linkDevice = { user_id: 'owner' }) {
      const result = { status: 200 }
      route({ params: { trackId: 'track-id' }, query, linkDevice }, {
        set() { return this },
        status(code) { result.status = code; return this },
        sendStatus(code) { result.status = code },
        json(data) { result.body = data },
        sendFile(file) { result.body = fs.readFileSync(file, 'utf8') },
      })
      return result
    }
    const setClip = state.db.prepare('UPDATE tracks SET clip_url = ?, clip_transfer_file = ?, clip_start = 10, clip_end = 20')
    setClip.run(state.file, null)
    assert.equal(request({}).body.clip, null)
    assert.equal(request({ media: '1' }).status, 409)
    setClip.run(state.file, fs.realpathSync(state.file))
    assert.equal(request({}, { user_id: 'other' }).status, 403)
    const clip = request({}).body.clip
    assert.equal(clip.extension, 'mp4')
    assert.equal(clip.start, 10)
    assert.equal(clip.end, 20)
    assert.equal(request({ media: '1', version: clip.version }).body, 'video')
    state.db.exec('UPDATE tracks SET clip_start = 11')
    assert.equal(request({ media: '1', version: clip.version }).status, 409)
    setClip.run('https://music.youtube.com/watch?v=zyxwvutsrqp', null)
    assert.equal(request({}).body.clip.videoId, 'zyxwvutsrqp')
  } finally { state.cleanup() }
})
