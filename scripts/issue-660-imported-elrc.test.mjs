import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const service = require('../electron/lyrics/service')
const { prepareLyricsExport, writeConfirmedLyricsExport } = require('../electron/lyrics/fileExport')
const { parseAny } = require('../electron/lyrics/detect')
const fileLyrics = require('../electron/lyrics/fileLyrics')
const { fromPrivateTag } = require('../electron/lyrics/embedded')

function db() {
  const instance = new Database(':memory:')
  instance.exec(`
    CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE lyrics_cache (track_id TEXT PRIMARY KEY, lyrics_type TEXT, content TEXT, source TEXT, fetched_at INTEGER, file_path TEXT, meta TEXT);
    INSERT INTO tracks VALUES ('one', 'ghost://track/one'), ('two', 'ghost://track/two');
  `)
  return instance
}

test('#660: importing an LRC creates a pinned cache that can be embedded without a provider request', async t => {
  const conn = db(); t.after(() => conn.close())
  const imported = service.importLyrics(conn, 'one', '[00:01.00]Hello world\n[00:03.00]Second line', 'lrc')
  assert.equal(imported.source, 'imported')
  assert.equal(imported.sync, 'line')
  const selected = await service.getLyricsForSaving(conn, { trackId: 'one' }, 'imported')
  assert.equal(selected.pinned, true)
  assert.deepEqual(selected.lines.map(l => l.text).filter(Boolean), ['Hello world', 'Second line'])
  const { text, privateTag } = fileLyrics.fromResult(selected)
  assert.match(text, /\[00:01\.00\]Hello world/)
  assert.equal(fromPrivateTag(privateTag).lines[0].text, 'Hello world')
})

test('#660: imported LRC can actually be embedded into a local MP3 and read back', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lokal-issue-660-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const frame = Buffer.alloc(417)
  frame.writeUInt32BE(0xFFFB9064, 0)
  const audioFile = path.join(dir, 'imported.mp3')
  writeFileSync(audioFile, Buffer.concat(Array(40).fill(frame)))
  const conn = db(); t.after(() => conn.close())
  conn.prepare('UPDATE tracks SET file_path = ? WHERE id = ?').run(audioFile, 'one')
  const raw = '[00:01.00]Imported first line\n[00:03.00]Imported second line'
  service.importLyrics(conn, 'one', raw, 'lrc')
  const selected = await service.getLyricsForSaving(conn, { trackId: 'one' }, 'imported')
  const prepared = fileLyrics.fromResult(selected)
  const saved = fileLyrics.writeFileLyrics(audioFile, prepared.text, prepared.privateTag)
  assert.equal(saved.ok, true)
  assert.equal(saved.synced, true)
  const embedded = await fileLyrics.readFileLyrics(audioFile)
  assert.equal(embedded.synced, true)
  assert.match(embedded.text, /\[00:01\.00\]Imported first line/)
  assert.match(embedded.text, /\[00:03\.00\]Imported second line/)
})

test('#660: importing an ELRC preserves real word timestamps for embed and re-export', async t => {
  const conn = db(); t.after(() => conn.close())
  const raw = [
    '[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.10>',
    'Bonjour monde',
    '[00:03.00]<00:03.00>Second <00:03.60>line<00:04.10>',
    'Deuxième ligne',
  ].join('\n')
  const imported = service.importLyrics(conn, 'one', raw, 'elrc')
  assert.equal(imported.sync, 'syllable')
  const selected = await service.getLyricsForSaving(conn, { trackId: 'one' }, 'imported')
  assert.deepEqual(selected.lines[0].words.map(word => word.time), [1, 1.5])
  assert.equal(selected.lines[0].translation?.text, 'Bonjour monde')
  const exported = prepareLyricsExport(selected)
  assert.equal(exported.extension, 'elrc')
  assert.equal(exported.text, raw, 'normal export must preserve imported source text like Mobile')
  assert.match(exported.text, /<00:01\.00>Hello\s+<00:01\.50>world<00:02\.10>/)
  const reparsed = parseAny(exported.text)
  assert.deepEqual(reparsed.lines[0].words.map(word => word.time), [1, 1.5])
  assert.equal(reparsed.lines[0].translation?.text, 'Bonjour monde')
  const embedded = fileLyrics.fromResult(selected)
  assert.ok(embedded.privateTag)
  assert.equal(fromPrivateTag(embedded.privateTag).lines[0].words[1].time, 1.5)
  assert.match(embedded.text, /\[00:01\.00\]Hello world/)
})

test('#660: only the pinned lyrics for the selected track and source are used', async t => {
  const conn = db(); t.after(() => conn.close())
  service.importLyrics(conn, 'one', '[00:02.00]Only track one', 'lrc')
  await assert.rejects(service.getLyricsForSaving(conn, { trackId: 'two' }, 'imported'), /no longer selected/)
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM lyrics_cache WHERE track_id = 'two'").get().n, 0)
  service.importLyrics(conn, 'two', '[00:03.00]Only track two', 'lrc')
  const selected = await service.getLyricsForSaving(conn, { trackId: 'two' }, 'imported')
  assert.equal(selected.lines[0].text, 'Only track two')
  assert.notEqual(selected.lines[0].text, 'Only track one')
  await assert.rejects(service.getLyricsForSaving(conn, { trackId: 'two' }, ''), /Select lyrics/)
})

test('portable export chooses line LRC or TXT when no word timing exists', async t => {
  const conn = db(); t.after(() => conn.close())
  const line = service.importLyrics(conn, 'one', '[00:05.00]A full line', 'lrc')
  const lrc = prepareLyricsExport(line)
  assert.equal(lrc.extension, 'lrc')
  assert.doesNotMatch(lrc.text, /<\d+:/)
  const plain = service.importLyrics(conn, 'one', 'No times here\nAnother line', 'txt')
  const txt = prepareLyricsExport(plain)
  assert.equal(txt.extension, 'txt')
  assert.match(txt.text, /Another line/)
  assert.throws(() => prepareLyricsExport({ lines: [] }), /no lyrics/)
})

test('blank plain/TXT imports do not replace previously saved lyrics', async t => {
  const conn = db(); t.after(() => conn.close())
  service.importLyrics(conn, 'one', '[00:02.00]Important saved lyrics', 'lrc')
  const saved = conn.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get('one')
  assert.equal(service.importLyrics(conn, 'one', ' \n \t\n ', 'txt'), null)
  assert.equal(service.importLyrics(conn, 'one', '', 'plain'), null)
  assert.deepEqual(conn.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get('one'), saved)
  assert.equal((await service.getLyricsForSaving(conn, { trackId: 'one' }, 'imported')).lines[0].text,
    'Important saved lyrics')
})

test('existing extension-adjusted lyric export target requires explicit replacement approval', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lokal-export-overwrite-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bare = path.join(dir, 'lyric')
  const actual = bare + '.elrc'
  writeFileSync(actual, 'Original existing lyrics')
  const confirmations = []
  const dialog = {
    showMessageBox: async options => {
      confirmations.push(options)
      return { response: 0 }
    },
  }
  assert.equal(existsSync(bare), false, 'the native dialog may return the path without .elrc')
  const cancelled = await writeConfirmedLyricsExport(fsPromises, dialog, actual, 'Replacement lyrics')
  assert.deepEqual(cancelled, { saved: false, canceled: true })
  assert.equal(readFileSync(actual, 'utf8'), 'Original existing lyrics', 'cancellation never overwrites')
  assert.equal(confirmations.length, 1)
  assert.match(confirmations[0].detail, /lyric\.elrc/)
  assert.equal(confirmations[0].defaultId, 0)
  assert.equal(confirmations[0].cancelId, 0)

  dialog.showMessageBox = async () => ({ response: 1 })
  assert.deepEqual(await writeConfirmedLyricsExport(fsPromises, dialog, actual, 'Approved replacement'),
    { saved: true })
  assert.equal(readFileSync(actual, 'utf8'), 'Approved replacement')
})

test('new export targets are created exclusively; other filesystem errors propagate', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lokal-export-new-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let prompts = 0
  const dialog = { showMessageBox: async () => { prompts++; return { response: 1 } } }
  const fresh = path.join(dir, 'fresh.lrc')
  assert.deepEqual(await writeConfirmedLyricsExport(fsPromises, dialog, fresh, '[00:01.00]Fresh'),
    { saved: true })
  assert.equal(readFileSync(fresh, 'utf8'), '[00:01.00]Fresh')
  assert.equal(prompts, 0)
  await assert.rejects(
    writeConfirmedLyricsExport(fsPromises, dialog, path.join(dir, 'missing', 'no.lrc'), 'x'),
    error => error.code === 'ENOENT')
  assert.equal(prompts, 0, 'non-conflict errors must not trigger replacement')
})

test('native Desktop UI exposes ELRC import/export and the embedding path uses pinned selection', () => {
  const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
  const ipc = src('electron/ipc/lyrics.js')
  const fullscreen = src('src/components/LyricsFullscreen.jsx')
  const panel = src('src/components/LyricsPanel.jsx')
  const preload = src('electron/preload.js')
  assert.match(ipc, /service\.getLyricsForSaving\(db, \{ trackId, title, artist, album, duration \}, providerId\)/)
  assert.match(ipc, /dialog\.showSaveDialog\(/)
  assert.match(ipc, /ipcMain\.handle\('lyrics:exportFile'/)
  assert.match(fullscreen, /extensions: \['lrc', 'elrc', 'txt', 'ttml', 'xml'\]/)
  assert.match(fullscreen, /await api\.importLyrics\(currentTrack\.id, content, type\)/)
  const fullPlayer = src('src/components/FullscreenPlayer.jsx')
  assert.match(fullscreen, /import \{ announceLyricsChanged \} from '\.\.\/lyricLine'/)
  assert.match(fullPlayer, /import \{ announceLyricsChanged \} from '\.\.\/lyricLine'/)
  assert.match(fullscreen, /announceLyricsChanged\(currentTrack\.id\)/)
  assert.match(fullscreen, /announceLyricsChanged\(trackId\)/)
  assert.match(fullPlayer, /announceLyricsChanged\(trackId\)/)
  assert.match(ipc, /writeConfirmedLyricsExport\(fs, dialog, target, exported\.text\)/)
  assert.match(panel, /onClick=\{exportCurrentLyrics\}/)
  assert.match(preload, /exportLyricsFile: \(providerId, id, ti, ar, al, d\) => invoke\('lyrics:exportFile'/)
})
