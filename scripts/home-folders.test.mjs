import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseRandomFolders, configuredMusicRoots, getFoldersWithDirectTracks } from '../src/homeFolders.mjs'

test('home folder selection chooses up to six unique folders without changing the source list', () => {
  const folders = Array.from({ length: 10 }, (_, index) => ({ path: `folder-${index}` }))
  const original = [...folders]
  const selected = chooseRandomFolders(folders, 6, () => 0)
  assert.equal(selected.length, 6)
  assert.equal(new Set(selected.map(folder => folder.path)).size, 6)
  assert.deepEqual(folders, original)
  assert.deepEqual(selected.map(folder => folder.path), ['folder-0', 'folder-1', 'folder-2', 'folder-3', 'folder-4', 'folder-5'])
})

test('home folder selection handles small and missing libraries', () => {
  const folders = [{ path: 'one' }, { path: 'two' }]
  assert.equal(chooseRandomFolders(folders).length, 2)
  assert.deepEqual(chooseRandomFolders(null), [])
})

test('configured music roots use the saved list with legacy fallback and deduplication', () => {
  assert.deepEqual(configuredMusicRoots({ music_folders: '["C:\\\\Music","C:\\\\Music","D:\\\\Music"]' }), ['C:\\Music', 'D:\\Music'])
  assert.deepEqual(configuredMusicRoots({ music_folders: '[]', music_folder: 'C:\\Music' }), ['C:\\Music'])
})

test('home folder discovery traverses nested directories and only returns folders with direct tracks', async () => {
  const views = {
    '': { folders: [{ path: 'parent', trackCount: 10, directTrackCount: 0 }, { path: 'loose', trackCount: 2, directTrackCount: 2 }] },
    parent: { folders: [{ path: 'parent/album', trackCount: 4, directTrackCount: 4 }, { path: 'parent/collection', trackCount: 6, directTrackCount: 0 }] },
    'parent/collection': { folders: [{ path: 'parent/collection/nested', trackCount: 3, directTrackCount: 3 }] },
  }
  const requests = []
  const folders = await getFoldersWithDirectTracks(async relativePath => {
    requests.push(relativePath)
    return views[relativePath] || { folders: [] }
  }, 'C:\\Music')
  assert.deepEqual(new Set(folders.map(folder => folder.path)), new Set(['loose', 'parent/album', 'parent/collection/nested']))
  assert.equal(requests.length, 3, 'folders containing only direct tracks do not require another listing')
})
