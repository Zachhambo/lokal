import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

let autoplay = '0'
globalThis.localStorage = { getItem: key => key === 'lokal-autoplay' ? autoplay : null, setItem() {}, removeItem() {} }
const { usePlayerStore: store } = await import('../src/store/player.js')
const { shouldTopUpRelated } = await import('../src/queueAutoplay.js')
const { queueOnlineTracks } = await import('../src/onlineQueue.js')
const { resolveRecommendationTracks } = await import('../src/recommendations.js')
const { shouldPrepareGapless } = await import('../src/audio/gapless.js')

const song = id => ({ id, title: id, artist: 'Artist', file_path: `/music/${id}.flac` })
beforeEach(() => {
  autoplay = '0'
  store.setState({
    queue: [], queueIndex: -1, currentTrack: null, isPlaying: false,
    shuffle: false, shuffleQueue: [], shuffleIndex: -1, originalQueue: [],
    repeat: 'none', playHistory: [], futureHistory: [], playNextIds: [],
    playbackContext: null, _fetchingRelated: false,
  })
})

test('Autoplay off advances through the album and manually added songs, then stops', () => {
  store.getState().playQueue(['one', 'two'].map(song))
  store.getState().addToQueue(song('manual'))
  for (const expected of ['two', 'manual']) {
    store.getState().autoNext()
    assert.equal(store.getState().currentTrack.id, expected)
    assert.equal(store.getState().isPlaying, true)
  }
  store.getState().autoNext()
  assert.equal(store.getState().currentTrack.id, 'manual')
  assert.equal(store.getState().isPlaying, false)
})

test('Autoplay off respects shuffled queue order and Repeat All', () => {
  const queue = ['one', 'two', 'three'].map(song)
  store.setState({ queue, currentTrack: queue[0], queueIndex: 0,
    shuffle: true, shuffleQueue: [queue[0], queue[2], queue[1]], shuffleIndex: 0,
    isPlaying: true,
  })
  store.getState().autoNext()
  assert.equal(store.getState().currentTrack.id, 'three')
  store.getState().autoNext()
  assert.equal(store.getState().currentTrack.id, 'two')
  store.getState().autoNext()
  assert.equal(store.getState().isPlaying, false)
  store.setState({ shuffle: false, repeat: 'all', queueIndex: 2, currentTrack: queue[2] })
  store.getState().autoNext()
  assert.equal(store.getState().currentTrack.id, 'one')
  assert.equal(store.getState().isPlaying, true)
})

test('only queue-end recommendations depend on Autoplay; repeats and explicit radio stay separate', () => {
  store.getState().playQueue([song('one')])
  assert.equal(shouldTopUpRelated(store.getState()), false)
  autoplay = '1'
  assert.equal(shouldTopUpRelated(store.getState()), true)
  for (const repeat of ['all', 'one']) {
    assert.equal(shouldTopUpRelated({ ...store.getState(), repeat }), false)
  }
  for (const type of ['flow', 'discovery', 'mix', 'internet-radio']) {
    assert.equal(shouldTopUpRelated({ ...store.getState(), playbackContext: { type } }), false)
  }
  autoplay = '0'
  assert.equal(shouldTopUpRelated(store.getState()), false, 'a pending recommendation must not append after Autoplay is disabled')
})

test('Autoplay off still prepares the next queued local album song for gapless playback', () => {
  assert.equal(shouldPrepareGapless({ mode: 'off', current: song('one'), next: song('two'), remaining: 5, autoplay: false }), true)
})

for (const next of [false, true]) {
  test(`online album ${next ? 'Play next' : 'Add to queue'} retains every row and its local copy in order`, async () => {
    const local = song('owned')
    const album = [{ title: 'first', artist: 'Artist' }, local, { title: 'last', artist: 'Artist' }]
    const prepares = []
    const client = {
      searchTracks: async () => [],
      onlineSearch: async query => ({ results: [{ id: query.includes('first') ? 'first' : 'last', title: query.includes('first') ? 'first' : 'last', artist: 'Artist' }] }),
      onlineSave: async rows => rows.map(row => ({ ...row, id: row.id, file_path: `ghost://addon/0123456789/${row.id}` })),
      onlinePrepare: async (...args) => { prepares.push(args); return { ok: true } },
    }
    store.getState().playQueue([song('playing'), song('existing')])
    await queueOnlineTracks(album, {
      next, store,
      resolve: (tracks, _, options) => resolveRecommendationTracks(tracks, client, { ...options, sources: [{ id: 'a-0123456789', package: true }] }),
    })
    assert.deepEqual(store.getState().queue.map(t => t.id), next
      ? ['playing', 'first', 'owned', 'last', 'existing']
      : ['playing', 'existing', 'first', 'owned', 'last'])
    assert.equal(store.getState().currentTrack.id, 'playing')
    assert.equal(store.getState().queue.find(t => t.id === 'owned'), local)
    assert.deepEqual(prepares, [], 'queueing an album does not prepare addon audio')
  })
}
