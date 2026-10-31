import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findFolderArtworkAsync, coverPriority, cacheFolderArtwork } = require('../electron/networkArtwork')

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

test('NAS artwork: skip an invalid first named image and use a valid next choice', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const calls = []
  const chosen = await findFolderArtworkAsync(album, {
    readdir: async () => [file('front.png'), file('folder.jpg'), file('cover.jpg')],
    stat: async candidate => {
      calls.push(path.basename(candidate))
      if (candidate.endsWith('cover.jpg')) return { isFile: () => true, size: 20 * 1024 * 1024 }
      if (candidate.endsWith('folder.jpg')) return { isFile: () => true, size: 256 * 1024 }
      return { isFile: () => true, size: 128 * 1024 }
    },
  })
  assert.equal(chosen, path.join(album, 'folder.jpg'))
  assert.deepEqual(calls, ['cover.jpg', 'folder.jpg'])
})

test('NAS artwork: unreadable named images fall through, but unrelated posters remain ambiguous', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const chosen = await findFolderArtworkAsync(album, {
    readdir: async () => [file('cover.jpg'), file('front.png'), file('poster.jpg')],
    stat: async candidate => {
      if (candidate.endsWith('cover.jpg')) throw new Error('unreadable')
      return { isFile: () => true, size: 4096 }
    },
  })
  assert.equal(chosen, path.join(album, 'front.png'))
})

test('NAS artwork: a timed-out stat never causes another candidate to stall', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const checked = []
  const started = Date.now()
  const result = await findFolderArtworkAsync(album, {
    readdir: async () => [file('cover.jpg'), file('folder.jpg'), file('front.jpg')],
    stat: candidate => {
      checked.push(path.basename(candidate))
      return new Promise(() => {})
    },
    timeoutMs: 12,
  })
  assert.equal(result, null)
  assert.deepEqual(checked, ['cover.jpg'])
  assert.ok(Date.now() - started < 500, 'all candidates share a bounded deadline')
})

test('NAS artwork: numbered folder covers are recognized', async () => {
  const album = path.resolve('/mnt/nas/Album')
  const chosen = await findFolderArtworkAsync(album, {
    readdir: async () => [file('poster.jpg'), file('cover.1.JPG')],
    stat,
  })
  assert.equal(chosen, path.join(album, 'cover.1.JPG'))
})

test('NAS artwork: a mounted cover is converted to durable app artwork', async () => {
  const album = path.resolve('/mnt/nas/Album/cover.jpg')
  const writes = []
  const opts = {
    stat: async () => ({ isFile: () => true, size: 4, mtimeMs: 1234 }),
    readFile: async () => Buffer.from('cover'),
    writeCover: async (dir, base, bytes) => {
      writes.push({ dir, base, bytes: Buffer.from(bytes).toString() })
      return path.join(dir, base + '.webp')
    },
  }
  const first = await cacheFolderArtwork(album, '/app/artwork', opts)
  const second = await cacheFolderArtwork(album, '/app/artwork', opts)
  assert.equal(first, second)
  assert.equal(writes[0].dir, '/app/artwork')
  assert.equal(writes[0].bytes, 'cover')
  assert.match(writes[0].base, /^nas-folder-[a-f0-9]{24}$/)
})

test('NAS artwork: failed or oversized cover reads cannot corrupt indexed art', async () => {
  const album = path.resolve('/mnt/nas/Album/cover.jpg')
  assert.equal(await cacheFolderArtwork(album, '/app/artwork', {
    stat: async () => ({ isFile: () => true, size: 15 * 1024 * 1024 }),
    readFile: async () => { throw new Error('must not be read') },
  }), null)
  assert.equal(await cacheFolderArtwork(album, '/app/artwork', {
    stat: async () => ({ isFile: () => true, size: 4 }),
    readFile: async () => { throw new Error('NAS offline') },
  }), null)
})
