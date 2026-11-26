import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isMultichannelEac3, stereoDownmixArgs } = require('../electron/audio/stereoDownmix.js')

test('only multichannel E-AC-3 streams are selected for stereo conversion', () => {
  assert.equal(isMultichannelEac3({ codec_name: 'eac3', channels: 6 }), true)
  assert.equal(isMultichannelEac3({ codec_name: 'EAC3', channels: 8 }), true)
  assert.equal(isMultichannelEac3({ codec_name: 'eac3', channels: 2 }), false)
  assert.equal(isMultichannelEac3({ codec_name: 'aac', channels: 6 }), false)
  assert.equal(isMultichannelEac3(null), false)
})

test('downmix output is decoded stereo PCM at a browser-friendly sample rate', () => {
  const args = stereoDownmixArgs('input.m4a', 'output.wav')
  assert.ok(args.includes('input.m4a'))
  assert.ok(args.includes('output.wav'))
  assert.deepEqual(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 2), ['-ac', '2'])
  assert.deepEqual(args.slice(args.indexOf('-ar'), args.indexOf('-ar') + 2), ['-ar', '48000'])
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'pcm_s16le'])
  assert.ok(args.includes('-map'))
  assert.ok(args.includes('0:a:0'))
})
