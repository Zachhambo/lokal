import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the actual list callback with its queue and native API boundaries.
const source = readFileSync(new URL('../src/components/OnlineSongList.jsx', import.meta.url), 'utf8')
const callback = source.slice(source.indexOf('  const playNativeDolby ='), source.indexOf('  const withResolved ='))

function fixture(atmosPlay) {
  const track = { provider: 'a-0123456789', id: 'song', title: 'Song' }
  const local = { id: 'local', file_path: '/music/local.flac' }
  const ghost = { id: 'ghost', file_path: 'ghost://addon/0123456789/song' }
  const state = {
    currentTrack: local, isPlaying: true, isBuffering: true,
    playQueue(queue, index) { state.queue = queue; state.currentTrack = queue[index] },
  }
  const store = { getState: () => state, setState: patch => Object.assign(state, patch) }
  const ref = item => item.file_path === ghost.file_path
    ? { provider: track.provider, id: track.id } : null
  const play = new Function('tracks', 'api', 'usePlayerStore', 'anchorOf', 'isOnlineTrack', 'streamRef', 'awaitAtmosOutputRelease', `${callback}; return playNativeDolby`)(
    [local, track], { onlineSave: async () => [ghost], atmosPlay }, store,
    item => ref(item) || item, item => !item.file_path || !!ref(item), ref, async () => {},
  )
  return { play: () => play(track, 'headphones', ''), state, local }
}

test('explicit AC-4 playback joins the mixed queue and uses the exact source', async () => {
  const f = fixture(async (...args) => {
    assert.deepEqual(args, ['a-0123456789', 'song', '', 'headphones'])
    assert.equal(f.state.currentTrack.atmosNative, true)
    assert.equal(f.state.queue[0], f.local)
    return { ok: true }
  })
  assert.deepEqual(await f.play(), { ok: true })
})

test('a rejected native request clears shared playback and buffering', async () => {
  const f = fixture(async () => { throw new Error('Native decoder failed') })
  assert.match((await f.play()).error, /Native decoder failed/)
  assert.equal(f.state.isPlaying, false)
  assert.equal(f.state.isBuffering, false)
})

test('late native failures preserve the newer song and playback state', async () => {
  const f = fixture(async () => {
    f.state.currentTrack = f.local
    throw new Error('Old native request failed')
  })
  await f.play()
  assert.equal(f.state.currentTrack, f.local)
  assert.equal(f.state.isPlaying, true)
  assert.equal(f.state.isBuffering, true)
})

test('late native success reports supersession without stopping the newer song', async () => {
  const f = fixture(async () => { f.state.currentTrack = f.local; return { ok: true } })
  assert.match((await f.play()).error, /superseded/)
  assert.equal(f.state.isPlaying, true)
})
