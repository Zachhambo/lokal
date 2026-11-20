import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { LinkStore } = require('../electron/link/store')
const now = 1700000000000
const user = 'owner'
const device = 'mobile_abcdef'
const trackKey = 'artist|song|180'

function fixture() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE playlists (id TEXT PRIMARY KEY, uuid TEXT);
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration REAL, file_path TEXT,
      clip_url TEXT, clip_start REAL, clip_end REAL, clip_transfer_file TEXT
    );
  `)
  return { db, store: new LinkStore(db, { now: () => now }) }
}

function operation(index, videoClip) {
  return {
    entity: 'track', entity_id: trackKey, op: 'track.edit', device_id: device,
    op_id: 'mobile_edit_' + index,
    hlc: String(now + index).padStart(16, '0') + ':00000000',
    fields: { video_clip: videoClip },
  }
}

function addTrack(db) {
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('desktop-track', 'Song', 'Artist', 180, '/audio.flac', '/video.mp4', 1, 10, '/video.mp4')
}

const value = { videoId: 'abcdefghijk', start: 12.5, end: 45 }
const changed = {
  id: 'desktop-track', clip_url: 'https://www.youtube.com/watch?v=abcdefghijk',
  clip_start: 12.5, clip_end: 45,
}

test('clip edits retained before the audio file arrives apply together and notify the desktop UI', () => {
  const { db, store } = fixture()
  try {
    assert.equal(store.applyOps([operation(2, value), operation(1, null)], user, device), 2)
    assert.deepEqual(store.takeVideoClipChanges(), [])
    addTrack(db)
    assert.equal(store.applyPendingVideoClips('other'), 0)
    assert.equal(store.applyPendingVideoClips(user), 1)
    assert.deepEqual(store.takeVideoClipChanges(), [changed])
    const row = db.prepare('SELECT * FROM tracks').get()
    assert.equal(row.clip_url, changed.clip_url)
    assert.equal(row.clip_start, value.start)
    assert.equal(row.clip_end, value.end)
    assert.equal(row.clip_transfer_file, null)
    assert.equal(store.applyOps([operation(2, value)], user, device), 0)
    assert.equal(store.applyOps([operation(0, null)], user, device), 1)
    assert.equal(db.prepare('SELECT clip_url FROM tracks').get().clip_url, changed.clip_url)
    assert.equal(store.applyOps([operation(3, null)], user, device), 1)
    assert.deepEqual(store.takeVideoClipChanges(), [
      { id: 'desktop-track', clip_url: null, clip_start: null, clip_end: null },
    ])
  } finally { db.close() }
})

test('a clip operation cannot introduce a file path or invalid trim', () => {
  const { db, store } = fixture()
  try {
    addTrack(db)
    store.applyOps([
      operation(1, { videoId: '/local.mp4', start: 0, end: 1 }),
      operation(2, { videoId: 'abcdefghijk', start: 20, end: 5 }),
    ], user, device)
    assert.equal(db.prepare('SELECT clip_url FROM tracks').get().clip_url, '/video.mp4')
    assert.deepEqual(store.takeVideoClipChanges(), [])
  } finally { db.close() }
})

test('an upgraded desktop applies a clip previously acknowledged by an older release', () => {
  const { db } = fixture()
  try {
    const item = operation(1, value)
    db.prepare('DELETE FROM link_meta WHERE key=?').run('video_clip_journal_v1')
    db.prepare('INSERT INTO library_ops (op_id,user_id,device_id,hlc,entity,entity_id,op,fields_json) VALUES (?,?,?,?,?,?,?,?)')
      .run(item.op_id, user, item.device_id, item.hlc, item.entity, item.entity_id, item.op, JSON.stringify(item.fields))
    addTrack(db)
    const upgraded = new LinkStore(db, { now: () => now })
    assert.equal(upgraded.applyPendingVideoClips(user), 1)
    assert.deepEqual(upgraded.takeVideoClipChanges(), [changed])
  } finally { db.close() }
})

test('a clip from a desktop copy targets its original even with duplicate metadata', () => {
  const { db, store } = fixture()
  try {
    addTrack(db)
    db.prepare("INSERT INTO tracks (id, title, artist, duration, file_path) VALUES (?, ?, ?, ?, ?)")
      .run('exact-copy', 'Song', 'Artist', 180, '/alternate.flac')
    const edit = operation(2, value)
    edit.fields.desktop_original = { owner: `${store.deviceId}:${user}`, track_id: 'exact-copy' }
    store.applyOps([edit], user, device)
    assert.deepEqual(store.takeVideoClipChanges(), [{ ...changed, id: 'exact-copy' }])
    assert.equal(db.prepare("SELECT clip_url FROM tracks WHERE id='desktop-track'").get().clip_url, '/video.mp4')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM link_track_aliases').get().n, 0)
  } finally { db.close() }
})
