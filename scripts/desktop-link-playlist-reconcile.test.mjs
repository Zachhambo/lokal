import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { diffPlaylistSnapshots } = require('../electron/link/reconcile.js')

const member = (key, position) => ({
  track_key: key, position, title: key, artist: 'Artist',
  album: 'Album', duration: 180, file_hash: key, online_ref: false,
  source_ref: null, artwork_url: null
})

test('initial reconciliation exports playlist definitions and ordered members', () => {
  const operations = diffPlaylistSnapshots({}, {
    first: { name: 'My playlist', members: [member('a', 0), member('b', 1)] }
  })
  assert.deepEqual(operations.map(item => item.op), [
    'playlist.create', 'playlist.add', 'playlist.add'
  ])
  assert.deepEqual(operations.slice(1).map(item => item.fields.position), [0, 1])
})

test('subsequent unchanged playlist snapshots generate no redundant operations', () => {
  const state = { p: { name: 'Same', members: [member('a', 0)] } }
  assert.deepEqual(diffPlaylistSnapshots(state, state), [])
})

test('desktop removal and rename are both exported', () => {
  const before = {
    removed: { name: 'Delete me', members: [] },
    renamed: { name: 'Old', members: [] }
  }
  const after = { renamed: { name: 'New', members: [] } }
  const events = diffPlaylistSnapshots(before, after)
  assert.deepEqual(events.map(row => [row.entity_id, row.op]), [
    ['removed', 'playlist.delete'], ['renamed', 'playlist.rename']
  ])
})

test('member removals and ordering changes survive the incremental cursor', () => {
  const before = { p: { name: 'Playlist', members: [member('a', 0), member('b', 1)] } }
  const after = { p: { name: 'Playlist', members: [member('b', 0), member('c', 1)] } }
  const events = diffPlaylistSnapshots(before, after)
  assert.deepEqual(events.map(row => [row.op, row.fields.track_key]), [
    ['playlist.remove', 'a'], ['playlist.move', 'b'], ['playlist.add', 'c']
  ])
})
