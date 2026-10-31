import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { getJson } = require('../electron/online/addons.js')

test('automatic HTTP metadata deadline aborts the actual request', async () => {
  let requested = 0
  let aborted = false
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    requested++
    assert.equal(options.redirect, 'manual')
    assert.equal(options.signal.aborted, false)
    options.signal.addEventListener('abort', () => {
      aborted = true
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
  await assert.rejects(
    getJson('https://addon.example/stream/track', { fetchImpl, timeoutMs: 12 }),
    /took too long to answer/,
  )
  assert.equal(requested, 1)
  assert.equal(aborted, true)
})

test('a successful response can finish before its deadline', async () => {
  const fetchImpl = async () => ({
    status: 200, ok: true,
    text: async () => JSON.stringify({ url: 'https://audio.example/stream.flac', quality: 'LOSSLESS' }),
  })
  const result = await getJson('https://addon.example/stream/track', { fetchImpl, timeoutMs: 50 })
  assert.equal(result.quality, 'LOSSLESS')
})
