import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const sources = require('../electron/online/sources.js')

function tracksDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      file_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      album_artist TEXT,
      track_num INTEGER,
      year INTEGER,
      genre TEXT,
      duration REAL,
      bitrate INTEGER,
      source_url TEXT,
      artwork_url TEXT,
      last_modified INTEGER
    )
  `)
  return db
}

test('streamed add-on tracks retain their source album id across metadata refreshes', () => {
  const db = tracksDatabase()
  try {
    const item = {
      provider: 'a-0123456789',
      id: 'amazon-track-123',
      title: 'Song',
      artist: 'Artist',
      artists: ['Artist'],
      album: 'Amazon Album',
      albumId: 'B012345678',
      duration: 180,
    }
    const [saved] = sources.saveOnlineTracks(db, [item])
    assert.equal(saved.source_album_id, 'B012345678')

    const [refreshed] = sources.saveOnlineTracks(db, [{ ...item, albumId: null }])
    assert.equal(refreshed.source_album_id, 'B012345678')
  } finally {
    db.close()
  }
})

test('an addon ghost keeps advertised Atmos after saving, refresh and playback reload', () => {
  const db = tracksDatabase()
  try {
    const item = {
      provider: 'a-0123456789', id: 'tidal-song-123', title: 'Song',
      artist: 'Artist', album: 'Album', duration: 220,
      atmos_available: 1,
    }
    const [saved] = sources.saveOnlineTracks(db, [item])
    assert.equal(saved.atmos_available, 1)
    assert.equal(saved.file_path, 'ghost://addon/0123456789/tidal-song-123')
    // The player returns a saved ghost row without the original search badges.
    const [reloaded] = sources.saveOnlineTracks(db, [{
      provider: item.provider, id: item.id, title: item.title, artist: item.artist,
    }])
    assert.equal(reloaded.atmos_available, 1)
    assert.equal(db.prepare('SELECT atmos_available FROM tracks WHERE id = ?').get(saved.id).atmos_available, 1)
    const [stereo] = sources.saveOnlineTracks(db, [{ ...item, id: 'stereo-only', atmos_available: 0 }])
    assert.equal(stereo.atmos_available, 0)
  } finally {
    db.close()
  }
})

test('Amazon AC-4 requestability is persisted independently from Atmos catalogue modes', () => {
  const db = tracksDatabase()
  try {
    const item = {
      provider: 'a-0123456789', id: 'amazon-ac4-track', title: 'Amazon song',
      artist: 'Artist', duration: 189, atmos_available: 0,
      atmos_requestable: 1,
    }
    const [saved] = sources.saveOnlineTracks(db, [item])
    assert.equal(saved.atmos_available, 0)
    assert.equal(saved.atmos_requestable, 1)
    const [reloaded] = sources.saveOnlineTracks(db, [{
      provider: item.provider, id: item.id, title: item.title, artist: item.artist,
    }])
    assert.equal(reloaded.atmos_available, 0,
      'AC-4 option must not become a confirmed catalogue Atmos badge')
    assert.equal(reloaded.atmos_requestable, 1,
      'queue ghost must retain opt-in AC-4 requestability when refreshed without metadata')
    const [stereoOnly] = sources.saveOnlineTracks(db, [{
      ...item, id: 'amazon-stereo-only', atmos_requestable: 0,
    }])
    assert.equal(stereoOnly.atmos_requestable, 0)
  } finally {
    db.close()
  }
})
