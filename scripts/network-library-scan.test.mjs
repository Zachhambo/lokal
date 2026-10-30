import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { scanNetworkRoots } = require('../electron/ipc/networkLibrary.js')

test('preserves offline NAS root and scans only currently reachable music roots', async () => {
  const saved = []
  const db = {
    prepare: sql => ({
      run: value => saved.push({ sql, value }),
    }),
  }
  const scans = []
  const result = await scanNetworkRoots(
    ['/music/local', '/mnt/nas', '/music/local'],
    {
      existing: ['/music/local', '/mnt/nas'],
      db,
      scan: async roots => {
        scans.push(roots)
        return { results: [{ songs: 2 }], status: { done: 2 } }
      },
      isReadable: async folder => folder === '/music/local',
    },
  )

  assert.deepEqual(scans, [['/music/local']])
  assert.deepEqual(result.folders, ['/music/local', '/mnt/nas'])
  assert.deepEqual(result.offlineFolders, ['/mnt/nas'])
  assert.equal(JSON.parse(saved[0].value)[1], '/mnt/nas')
  assert.equal(saved[1].value, '/music/local')
})

test('keeps all previously saved roots if the NAS is offline', async () => {
  const saved = []
  const result = await scanNetworkRoots(['/mnt/nas'], {
    existing: ['/mnt/nas'],
    db: { prepare: () => ({ run: value => saved.push(value) }) },
    scan: () => { throw new Error('Should not scan an offline server') },
    isReadable: async () => false,
  })
  assert.deepEqual(result.folders, ['/mnt/nas'])
  assert.deepEqual(result.offlineFolders, ['/mnt/nas'])
  assert.equal(saved.length, 2)
})

test('rejects a newly entered inaccessible network root', async () => {
  const result = await scanNetworkRoots(['/mnt/not-found'], {
    existing: ['/music/local'],
    db: { prepare: () => ({ run: () => { throw new Error('Should not save') } }) },
    scan: () => { throw new Error('Should not scan') },
    isReadable: async () => false,
  })
  assert.match(result.error, /accessible/)
})

test('restores offline NAS preference even when metadata scan throws', async () => {
  const saved = []
  await assert.rejects(() => scanNetworkRoots(['/music/local', '/mnt/nas'], {
    existing: ['/music/local', '/mnt/nas'],
    db: { prepare: () => ({ run: value => saved.push(value) }) },
    scan: async () => { throw new Error('NAS disconnected mid-scan') },
    isReadable: async folder => folder === '/music/local',
  }), /disconnected/)

  assert.deepEqual(JSON.parse(saved[0]), ['/music/local', '/mnt/nas'])
  assert.equal(saved[1], '/music/local')
})
