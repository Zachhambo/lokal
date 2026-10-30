import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { selectedHttpSpatial, stageHttpSpatialAudio } = require('../electron/online/httpSpatial.js')
const realFile = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(realFile), '..')

const addon = (value, label = value) => ({
  manifest: { settings: [
    { key: 'quality', default: 'LOSSLESS', options: [
      { value: 'LOSSLESS', label: 'Lossless FLAC' },
      { value, label },
    ] },
  ] },
  settings: { quality: value },
})

test('only an explicit HTTP addon Atmos tier may route to native output', () => {
  assert.equal(selectedHttpSpatial(addon('DOLBY_ATMOS'))?.codec, 'eac3-joc')
  assert.equal(selectedHttpSpatial(addon('ATMOS'))?.codec, 'eac3-joc')
  assert.equal(selectedHttpSpatial(addon('EAC3_JOC'))?.codec, 'eac3-joc')
  assert.equal(selectedHttpSpatial(addon('AC4_ATMOS'))?.codec, 'ac4')
  assert.equal(selectedHttpSpatial(addon('MAX', 'Dolby Atmos (E-AC-3 JOC)'))?.codec, 'eac3-joc')
  assert.equal(selectedHttpSpatial(addon('MAX', 'Dolby Atmos (AC-4)'))?.codec, 'ac4')
  for (const input of [
    addon('LOSSLESS'), addon('HI_RES'), addon('EAC3'), addon('AC4'),
    { manifest: { settings: [] }, settings: { quality: 'ATMOS' } },
    { manifest: { settings: [{ key: 'visualization', options: ['ATMOS'] }] },
      settings: { visualization: 'ATMOS' } },
  ]) {
    assert.equal(selectedHttpSpatial(input), null,
      'A codec label or non-audio setting is not evidence of Atmos')
  }
})

test('HTTP native staging saves original selected media and hides signed URL', async () => {
  const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3])
  const requested = []
  const staged = await stageHttpSpatialAudio('https://media.example/track.m4a?secret=signed', {
    fetchImpl: async (url, options) => {
      requested.push(String(url))
      assert.equal(options.redirect, 'manual')
      return new Response(bytes, { status: 200 })
    },
  })
  try {
    assert.equal(requested.length, 1)
    assert.deepEqual(new Uint8Array(await readFile(staged.file)), bytes)
    assert.equal(staged.file.includes('signed'), false)
    assert.equal(staged.file.endsWith('audio.m4a'), true)
  } finally {
    await staged.cleanup()
  }
  await assert.rejects(access(staged.file))
})

test('HTTP native staging rejects redirects to insecure locations without leaking URL', async () => {
  const bad = 'https://media.example/a.m4a?private=token'
  await assert.rejects(
    stageHttpSpatialAudio(bad, {
      fetchImpl: async () => new Response(null, {
        status: 302, headers: { location: 'http://insecure.example/other' },
      }),
    }),
    err => !/private=token/.test(String(err?.message)) && /Could not retrieve/.test(err.message),
  )
})

test('native handler verifies the delivered HTTP file, never catalogue metadata', () => {
  const handler = readFileSync(path.join(root, 'electron/audio/atmos.js'), 'utf8')
  assert.match(handler, /selectedHttpSpatial\(httpAddon\)/)
  assert.match(handler, /stageHttpSpatialAudio\(stream.url/)
  assert.match(handler, /inspectAtmosFile\s*\(\s*staged\.file/)
  assert.match(handler, /No stereo fallback/)
  const provider = readFileSync(path.join(root, 'electron/ipc/online.js'), 'utf8')
  assert.match(provider, /nativeSpatialPreferred: !!httpSpatial/)
})
