import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { chooseVariant } = require('../electron/artwork/motion.js')

const playlist = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1080,CODECS="avc1.640028"',
  '1080-avc.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=12000000,RESOLUTION=2160x2160,CODECS="hvc1.2.20000000.H150.B0"',
  '2160-hevc.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=2160x2160,CODECS="avc1.640033"',
  '2160-avc.m3u8',
].join('\n')

test('high-resolution moving covers prefer 2160p HEVC without capability detection', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, text: async () => playlist })
  try {
    assert.equal(
      await chooseVariant('https://example.test/master.m3u8', { highResolution: true }),
      'https://example.test/2160-hevc.m3u8',
    )
    assert.equal(
      await chooseVariant('https://example.test/master.m3u8'),
      'https://example.test/1080-avc.m3u8',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
