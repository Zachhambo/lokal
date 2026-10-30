import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findFolderArtworkAsync, coverPriority } = require('../electron/networkArtwork')

const file = name => ({ name, isFile: () => true })
const stat = async () => ({ isFile: () => true, size: 64 * 1024 })

test('NAS artwork: choose named folder artwork rather than unrelated poster', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const chosen = await findFolderArtworkAsync(album, {
    readdir: async () => [file('poster.jpg'), file('Folder.JPG'), file('back.jpg')],
    stat,
  })
  assert.equal(chosen, path.join(album, 'Folder.JPG'))
  assert.ok(coverPriority('cover.jpg') < coverPriority('front.png'))
})

test('NAS artwork: use a lone image and avoid ambiguous multi-cover folders', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const single = await findFolderArtworkAsync(album, {
    readdir: async () => [file('album-front-custom.jpg')],
    stat,
  })
  assert.equal(single, path.join(album, 'album-front-custom.jpg'))
  const ambiguous = await findFolderArtworkAsync(album, {
    readdir: async () => [file('booklet-1.jpg'), file('booklet-2.png')],
    stat,
  })
  assert.equal(ambiguous, null)
})

test('NAS artwork: refuse oversized art and time out offline shares', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const oversized = await findFolderArtworkAsync(album, {
    readdir: async () => [file('cover.jpg')],
    stat: async () => ({ isFile: () => true, size: 20 * 1024 * 1024 }),
  })
  assert.equal(oversized, null)
  const unreachable = await findFolderArtworkAsync(album, {
    readdir: () => new Promise(() => {}),
    timeoutMs: 10,
  })
  assert.equal(unreachable, null)
})
