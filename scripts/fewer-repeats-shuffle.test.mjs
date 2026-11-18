import test from 'node:test'
import assert from 'node:assert/strict'
import { fewerRepeatsShuffle, ShuffleHistory } from '../src/fewerRepeatsShuffle.js'
const tracks = (...ids) => ids.map(id => ({ id }))
const ids = rows => rows.map(row => row.id)

test('new and older songs precede recent songs; last heard is last', () => {
  const history = Array.from({ length: 200 }, (_, i) => String(i))
  const input = tracks('0', '10', '50', '150', 'fresh')
  assert.deepEqual(ids(fewerRepeatsShuffle(input, history, () => 0.5)), ['fresh', '150', '50', '10', '0'])
  assert.deepEqual(ids(input), ['0', '10', '50', '150', 'fresh'])
})
test('duplicates retained and newest history occurrence wins', () => {
  const a = { id: 1 }
  assert.deepEqual(fewerRepeatsShuffle([a, a, { id: 'b' }], ['1', 'b', '1']), [{ id: 'b' }, a, a])
  assert.deepEqual(fewerRepeatsShuffle([]), [])
  assert.deepEqual(fewerRepeatsShuffle([a], ['1']), [a])
})
test('randomness without history and a large queue retains every song', () => {
  const input = tracks('a', 'b', 'c')
  assert.notDeepEqual(fewerRepeatsShuffle(input, [], () => 0), fewerRepeatsShuffle(input, [], () => 0.99))
  const large = Array.from({ length: 10000 }, (_, id) => ({ id }))
  assert.equal(new Set(fewerRepeatsShuffle(large).map(row => row.id)).size, 10000)
})
test('history bounded; failure falls back without blocking', async () => {
  const h = new ShuffleHistory()
  await h.load(async () => Array.from({ length: 1000 }, (_, i) => i))
  assert.equal(h.ids.length, 200)
  h.remember(300)
  assert.equal(h.ids[0], '300')
  assert.equal(h.ids.length, 200)
  await h.load(async () => { throw Error('offline') })
  assert.deepEqual(h.ids, [])
})
test('account changes and plays during initial loading are race safe', async () => {
  const h = new ShuffleHistory()
  let resolveOld
  const old = h.load(() => new Promise(resolve => { resolveOld = resolve }))
  await h.load(async () => ['other-user'])
  resolveOld(['old-user'])
  await old
  assert.deepEqual(h.ids, ['other-user'])
  let resolveNew
  const loading = h.load(() => new Promise(resolve => { resolveNew = resolve }))
  h.remember('just-played')
  resolveNew(['older', 'just-played'])
  await loading
  assert.deepEqual(h.ids, ['just-played', 'older'])
})
test('a playing song is deferred even before its history write', () => {
  const h = new ShuffleHistory()
  h.currentId = 'playing'
  assert.deepEqual(ids(fewerRepeatsShuffle(tracks('playing', 'fresh'), h.recentIds)), ['fresh', 'playing'])
  assert.deepEqual(h.ids, [], 'does not turn a selection into a persisted play')
})
