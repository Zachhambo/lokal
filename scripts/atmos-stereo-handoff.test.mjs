import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { beginAtmosOutputRelease, awaitAtmosOutputRelease, shouldToggleNormalStream } from '../src/audio/atmosHandoff.mjs'

const require = createRequire(import.meta.url)
const { stereoPlaybackQuality, isAtmosQuality, addonDownloadQuality } = require('../electron/mornye/playbackQuality.js')

test('Mornye saved quality controls playback without inferring a catalogue tag', () => {
  const tidal = { name: 'tidal', manifest: { qualityOptions: [
    { id: 'DOLBY_ATMOS', kind: 'spatial' },
    { id: 'HIGH', kind: 'lossy' },
    { id: 'LOSSLESS', kind: 'lossless' },
    { id: 'HI_RES_LOSSLESS', kind: 'lossless' },
  ] } }
  assert.equal(stereoPlaybackQuality(tidal, { downloadQuality: 'DOLBY_ATMOS' }), 'DOLBY_ATMOS')
  assert.equal(stereoPlaybackQuality(tidal, { downloadQuality: 'LOSSLESS' }), 'LOSSLESS')
  assert.equal(stereoPlaybackQuality(tidal, { downloadQuality: 'HIGH' }), 'HIGH')
  assert.equal(stereoPlaybackQuality(tidal, {}), 'HI_RES_LOSSLESS')
  assert.equal(isAtmosQuality('DOLBY_ATMOS'), true)
  assert.equal(isAtmosQuality('LOSSLESS'), false)
})

test('other addon formats are passed through as configured', () => {
  const plugin = { name: 'qobuz', manifest: { qualityOptions: [
    { id: 'HI_RES_LOSSLESS', kind: 'lossless' },
    { id: 'HIGH', kind: 'lossy' },
  ] } }
  for (const quality of ['HI_RES_LOSSLESS', 'HIGH']) {
    assert.equal(stereoPlaybackQuality(plugin, { downloadQuality: quality }), quality)
    assert.equal(addonDownloadQuality(plugin, { downloadQuality: quality }, { purpose: 'playback' }), quality)
  }
})

test('Atmos-to-normal handoff holds the PCM start until native teardown completes', async () => {
  let finish
  const nativeStopped = new Promise(resolve => { finish = resolve })
  const events = []
  const native = beginAtmosOutputRelease(async () => {
    events.push('native_stop_begin')
    await nativeStopped
    events.push('native_stop_complete')
  })
  const pcm = awaitAtmosOutputRelease().then(() => events.push('pcm_start'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['native_stop_begin'])
  finish()
  await Promise.all([native, pcm])
  assert.deepEqual(events, ['native_stop_begin', 'native_stop_complete', 'pcm_start'])
})

test('rapid Atmos release requests serialize rather than overlap', async () => {
  const calls = []
  let unblock
  const gate = new Promise(resolve => { unblock = resolve })
  const first = beginAtmosOutputRelease(async () => {
    calls.push('stop_one_start')
    await gate
    calls.push('stop_one_end')
  })
  const second = beginAtmosOutputRelease(async () => calls.push('stop_two'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['stop_one_start'])
  unblock()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['stop_one_start', 'stop_one_end', 'stop_two'])
})

test('same Tidal track after Atmos changes engine instead of pausing native session', () => {
  const sameSource = true
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: true }, sameSource), false)
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: false }, sameSource), true)
  assert.equal(shouldToggleNormalStream({ id: 42, atmosNative: false }, false), false)
})

test('configured Atmos is requested for downloads, never downmixed to FLAC', () => {
  const tidal = { name: 'tidal', manifest: { qualityOptions: [
    { id: 'DOLBY_ATMOS', kind: 'spatial' }, { id: 'HI_RES_LOSSLESS', kind: 'lossless' },
  ] } }
  assert.equal(addonDownloadQuality(tidal, { downloadQuality: 'DOLBY_ATMOS' }), 'DOLBY_ATMOS')
  assert.equal(addonDownloadQuality(tidal, { downloadQuality: 'HI_RES_LOSSLESS' }), 'HI_RES_LOSSLESS')
  assert.equal(addonDownloadQuality(tidal, { downloadQuality: 'DOLBY_ATMOS' }, { quality: 'HI_RES_LOSSLESS' }), 'HI_RES_LOSSLESS')
  assert.throws(() => addonDownloadQuality(tidal, { downloadQuality: 'DOLBY_ATMOS' }, { purpose: 'playback' }), /native output/i)
})

test('Amazon AC-4 and FLAC settings request different audio codecs', () => {
  const amazon = { name: 'amazon', manifest: { qualityOptions: [
    { id: 'best', kind: 'lossless' },
    { id: 'eac3', kind: 'spatial' },
    { id: 'ac4', kind: 'spatial' },
  ] } }
  assert.equal(stereoPlaybackQuality(amazon, { downloadQuality: 'ac4' }), 'ac4')
  assert.equal(stereoPlaybackQuality(amazon, { downloadQuality: 'best' }), 'best')
  assert.equal(addonDownloadQuality(amazon, { downloadQuality: 'ac4' }), 'ac4')
  assert.equal(addonDownloadQuality(amazon, { downloadQuality: 'best' }), 'best')
  assert.equal(addonDownloadQuality(amazon, {}, { quality: 'DOLBY_ATMOS', allowAtmos: true }), 'ac4')
  assert.throws(() => addonDownloadQuality(amazon, { downloadQuality: 'ac4' }, { purpose: 'playback' }), /native output/i)
  assert.throws(() => addonDownloadQuality(amazon, {}, { quality: 'ac4' }), /explicit authorization/i)
})
