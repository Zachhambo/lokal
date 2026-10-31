import test from 'node:test'
import assert from 'node:assert/strict'
import { addonPlaybackOutputKey } from '../src/audio/addonPlaybackOutputKey.mjs'

test('addon verification metadata does not reload an existing audio source', () => {
  const provider = 'a-test'
  const playing = { [provider]: { nativeSpatialPreferred: false, authenticated: false } }
  const before = addonPlaybackOutputKey(provider, playing)
  const verified = { [provider]: { nativeSpatialPreferred: false, authenticated: true, verified: true } }
  assert.equal(addonPlaybackOutputKey(provider, verified), before)
  assert.equal(addonPlaybackOutputKey(provider, { ...verified, 'a-other': { nativeSpatialPreferred: true } }), before)
  assert.equal(addonPlaybackOutputKey(provider, null), before)
})

test('changing current addon audio mode still reloads its output', () => {
  const provider = 'a-test'
  const stereo = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: false } })
  const atmos = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: true, nativeSpatialCodec: 'eac3' } })
  const ac4 = addonPlaybackOutputKey(provider, { [provider]: { nativeSpatialPreferred: true, nativeSpatialCodec: 'ac4' } })
  assert.notEqual(stereo, atmos)
  assert.notEqual(atmos, ac4)
  assert.equal(addonPlaybackOutputKey('yt', {}), '')
})
