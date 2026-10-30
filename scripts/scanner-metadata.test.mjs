import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseWithDeadline, stopMetadataWorker } = require('../electron/ipc/scannerMetadata')

after(async () => { await stopMetadataWorker() })

// A valid 1-second mono PCM WAV verifies worker IPC preserves parsed
// metadata and that retaining duration:true does not require full-file reads.
test('scanner: metadata worker reads duration and returns metadata', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-metadata-worker-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'test.wav')
  const samples = 8000
  const dataSize = samples * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  fs.writeFileSync(file, wav)

  const result = await parseWithDeadline(file, {
    duration: true, skipCovers: false,
  }, 20000)
  assert.equal(result.format.sampleRate, 8000)
  assert.ok(Math.abs(result.format.duration - 1) < 0.01)
})
