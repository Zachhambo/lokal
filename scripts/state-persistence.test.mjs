import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allowedSavedRoute, readSavedRoute, writeSavedRoute,
  readViewState, writeViewState, statePersistenceEnabled,
  setStatePersistenceEnabled,
} from '../src/statePersistence.mjs'

function storage() {
  const entries = new Map()
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  }
}

test('disabled by default: no reads or writes of view state', () => {
  const s = storage()
  assert.equal(statePersistenceEnabled(s), false)
  writeSavedRoute('/library', s)
  writeViewState('library:sort', 'title ASC', s)
  assert.equal(readSavedRoute(s), '/')
  assert.equal(readViewState('library:sort', s), undefined)
})

test('enabled: restores only the minimal path and approved scalar view keys', () => {
  const s = storage()
  assert.equal(setStatePersistenceEnabled(true, s), true)
  writeSavedRoute('/home/discovery/new-releases', s)
  writeViewState('library:sort', 'title ASC', s)
  writeViewState('library:view', 'grid', s)
  writeViewState('sidebar:collapsed', '1', s)
  writeViewState('sidebar:leftWidth', '300', s)
  assert.equal(readSavedRoute(s), '/home/discovery/new-releases')
  assert.equal(readViewState('library:sort', s), 'title ASC')
  assert.equal(readViewState('library:view', s), 'grid')
  assert.equal(readViewState('sidebar:collapsed', s), '1')
  assert.equal(readViewState('sidebar:leftWidth', s), '300')
  assert.equal(s.getItem('lokal-view-state-v1').includes('tracks'), false)
})

test('turning off clears restart state but leaves toggle off across relaunch', () => {
  const s = storage()
  setStatePersistenceEnabled(true, s)
  writeSavedRoute('/artists', s)
  writeViewState('artists:density', 'compact', s)
  setStatePersistenceEnabled(false, s)
  assert.equal(s.getItem('lokal-view-state-v1'), null)
  assert.equal(s.getItem('lokal-state-persistence-enabled'), '0')
  setStatePersistenceEnabled(true, s)
  assert.equal(readSavedRoute(s), '/')
  assert.equal(readViewState('artists:density', s), undefined)
})

test('unknown routes, unapproved keys and huge values cannot be stored', () => {
  const s = storage()
  setStatePersistenceEnabled(true, s)
  for (const path of ['/fake', '//example.com', '/online/album', '/playlist/one/two', 'http://site.test']) {
    assert.equal(allowedSavedRoute(path), false)
    writeSavedRoute(path, s)
  }
  assert.equal(readSavedRoute(s), '/')
  writeViewState('library:tracks', JSON.stringify({ many: 'songs' }), s)
  writeViewState('library:view', 'x'.repeat(513), s)
  writeViewState('navigation:scrollTop', '-5', s)
  assert.equal(readViewState('library:tracks', s), undefined)
  assert.equal(readViewState('library:view', s), undefined)
  assert.equal(readViewState('navigation:scrollTop', s), undefined)
})

test('invalid or oversized data fails closed without throwing', () => {
  const s = storage()
  setStatePersistenceEnabled(true, s)
  s.setItem('lokal-view-state-v1', '{oops')
  assert.equal(readSavedRoute(s), '/')
  s.setItem('lokal-view-state-v1', 'x'.repeat(10000))
  assert.equal(readViewState('library:sort', s), undefined)
  writeSavedRoute('/library', s)
  assert.equal(readSavedRoute(s), '/library')
})

test('a storage API failure leaves the default disabled', () => {
  const broken = { getItem: () => { throw Error('storage disabled') }, setItem: () => { throw Error('storage disabled') } }
  assert.equal(statePersistenceEnabled(broken), false)
  assert.equal(setStatePersistenceEnabled(true, broken), false)
  assert.equal(readSavedRoute(broken), '/')
})
