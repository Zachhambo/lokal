import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const { findFolderArtworkAsync, coverPriority, cacheFolderArtwork, folderOriginalCandidates, isNetworkArtworkPath, isCachedFolderArtwork } = require('../electron/networkArtwork')

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

test('NAS artwork: a mounted cover is converted to durable app artwork', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-artwork-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const album = path.join(folder, 'cover.jpg')
  await fs.writeFile(album, 'cover')
  const info = await fs.stat(album)
  const writes = []
  const opts = {
    writeCover: async (dir, base, bytes) => {
      writes.push({ dir, base, bytes: Buffer.from(bytes).toString() })
      return path.join(dir, base + '.webp')
    },
  }
  const first = await cacheFolderArtwork(album, '/app/artwork', opts)
  const second = await cacheFolderArtwork(album, '/app/artwork', opts)
  const key = crypto.createHash('sha256').update(`${album}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 24)
  assert.equal(first, second)
  assert.equal(writes[0].dir, '/app/artwork')
  assert.equal(writes[0].bytes, 'cover')
  assert.equal(writes[0].base, 'nas-folder-' + key)
})

test('NAS artwork: reject oversized or unreadable covers', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-artwork-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const album = path.join(folder, 'cover.jpg')
  const handle = await fs.open(album, 'w')
  await handle.truncate(15 * 1024 * 1024)
  await handle.close()
  const writeCover = () => assert.fail('invalid cover must not be written')
  assert.equal(await cacheFolderArtwork(album, '/app/artwork', { writeCover }), null)
  assert.equal(await cacheFolderArtwork(path.join(folder, 'missing.jpg'), '/app/artwork', { writeCover }), null)
})

test('NAS artwork: use the opened file when the path is replaced', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-artwork-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const album = path.join(folder, 'cover.jpg')
  const replacement = path.join(folder, 'replacement.jpg')
  await fs.writeFile(album, 'original')
  await fs.writeFile(replacement, 'replacement')
  let openedInfo
  let writes = 0
  const result = await cacheFolderArtwork(album, '/app/artwork', {
    open: async (...args) => {
      const handle = await fs.open(...args)
      // Replacing a path must not switch the file read or its metadata.
      await fs.rename(replacement, album)
      openedInfo = await handle.stat()
      return handle
    },
    writeCover: async (_dir, base, bytes) => {
      writes++
      assert.equal(bytes.toString(), 'original')
      const key = crypto.createHash('sha256').update(`${album}:${openedInfo.size}:${openedInfo.mtimeMs}`).digest('hex').slice(0, 24)
      assert.equal(base, 'nas-folder-' + key)
      return 'cached'
    },
  })
  assert.equal(result, 'cached')
  assert.equal(writes, 1)
})

test('NAS artwork: reject a file that grows during the bounded read', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-artwork-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const album = path.join(folder, 'cover.jpg')
  await fs.writeFile(album, 'cover')
  let requested = 0
  const result = await cacheFolderArtwork(album, '/app/artwork', {
    open: async (...args) => {
      const handle = await fs.open(...args)
      return {
        stat: () => handle.stat(),
        read: async (buffer, offset, length, position) => {
          requested += length
          await fs.appendFile(album, Buffer.alloc(13 * 1024 * 1024))
          return handle.read(buffer, offset, length, position)
        },
        close: () => handle.close(),
      }
    },
    writeCover: () => assert.fail('changed cover must not be written'),
  })
  assert.equal(result, null)
  assert.equal(requested, 6)
})

test('NAS artwork: reject changes to metadata after a same-size read', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-artwork-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const album = path.join(folder, 'cover.jpg')
  await fs.writeFile(album, 'cover')
  let changed = false
  const result = await cacheFolderArtwork(album, '/app/artwork', {
    open: async (...args) => {
      const handle = await fs.open(...args)
      return {
        stat: () => handle.stat(),
        read: async (...readArgs) => {
          const read = await handle.read(...readArgs)
          if (!changed) {
            changed = true
            await fs.writeFile(album, 'other')
            await fs.utimes(album, new Date(0), new Date(0))
          }
          return read
        },
        close: () => handle.close(),
      }
    },
    writeCover: () => assert.fail('changed cover must not be written'),
  })
  assert.equal(result, null)
})

test('NAS artwork: timed-out reads retain global slots until they settle', async () => {
  const pending = []
  let opens = 0
  let closed = 0
  let writes = 0
  const opts = {
    timeoutMs: 15,
    open: async () => {
      opens++
      return {
        stat: async () => ({ isFile: () => true, size: 1, mtimeMs: 1, ctimeMs: 1 }),
        read: () => new Promise(resolve => pending.push(resolve)),
        close: async () => { closed++ },
      }
    },
    writeCover: () => { writes++ },
  }
  // Each call represents another scan reaching a different album after a timeout.
  for (let i = 0; i < 8; i++) {
    assert.equal(await cacheFolderArtwork('/nas/' + i, '/app/artwork', opts), null)
  }
  assert.equal(opens, 4)
  assert.equal(pending.length, 4)
  pending.forEach(resolve => resolve({ bytesRead: 1 }))
  // Let the aborted reads close their handles and release their slots.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, 4)
  assert.equal(writes, 0)
  assert.equal(await cacheFolderArtwork('/nas/again', '/app/artwork', {
    ...opts, open: async () => { opens++; throw new Error('offline') },
  }), null)
  assert.equal(opens, 5)
})

test('local folder covers stay original; UNC and explicitly connected mounts use durable cache', () => {
  assert.equal(isNetworkArtworkPath('/music/Artist/Album/track.flac', [] , 'linux'), false)
  assert.equal(isNetworkArtworkPath('C:\\Music\\Artist\\track.flac', [], 'win32'), false)
  assert.equal(isNetworkArtworkPath('\\\\server\\share\\Album\\track.flac', [], 'win32'), true)
  assert.equal(isNetworkArtworkPath('Z:\\Music\\Album\\track.flac', ['Z:\\Music'], 'win32'), true)
  assert.equal(isNetworkArtworkPath('/mnt/nas/Album/track.flac', ['/mnt/nas'], 'linux'), true)
  assert.equal(isNetworkArtworkPath('/mnt/nas-alias/track.flac', ['/mnt/nas'], 'linux'), false)
  assert.equal(isNetworkArtworkPath('/music/Other/track.flac', ['/mnt/nas'], 'linux'), false)
  assert.equal(isCachedFolderArtwork('/cache/nas-folder-1234567890abcdef12345678.webp'), true)
  assert.equal(isCachedFolderArtwork('/cache/track.webp'), false)
})

test('NAS folder copy retains original JPG and PNG bytes alongside small list cache', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-original-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'artwork')
  for (const [name, bytes] of [
    ['cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00])],
    ['folder.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ]) {
    const source = path.join(root, name)
    await fs.writeFile(source, bytes)
    const thumbnail = await cacheFolderArtwork(source, dir, {
      writeCover: async (folder, base) => {
        const target = path.join(folder, base + '.webp')
        await fs.mkdir(folder, { recursive: true })
        await fs.writeFile(target, Buffer.from('small thumbnail'))
        return target
      },
    })
    assert.ok(thumbnail.endsWith('.webp'))
    const original = folderOriginalCandidates(thumbnail)
      .find(candidate => candidate.endsWith('.full' + path.extname(name)))
    assert.ok(original)
    assert.deepEqual(await fs.readFile(original), bytes)
    assert.equal((await fs.readFile(thumbnail)).toString(), 'small thumbnail')
  }
})
