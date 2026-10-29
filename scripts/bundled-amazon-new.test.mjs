import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { readArchive, keyOf } = require('../electron/mornye/packages.js')
const { hasAtmosMetadata } = require('../electron/mornye/atmos.js')
const { addonDownloadQuality, stereoPlaybackQuality } = require('../electron/mornye/playbackQuality.js')
const amazon = {
  name: 'amazon-new',
  manifest: { qualityOptions: [
    { id: 'best', kind: 'lossless' },
    { id: 'opus', kind: 'lossy' },
    { id: 'eac3', kind: 'spatial' },
    { id: 'ac4', kind: 'spatial' },
  ] },
}

test('embedded Amazon (New) archive contains the working source and is independently versioned', () => {
  const bytes = fs.readFileSync(path.join(root, 'electron/mornye/bundled/amazon-new.sflx'))
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    '967bc8cf940cf39029ef7e33f55bf37c5f686028332570ef484579ebc75c5543')
  const parsed = readArchive(bytes)
  assert.equal(parsed.manifest.name, 'amazon-new')
  assert.equal(parsed.manifest.displayName, 'Amazon (New)')
  assert.equal(parsed.manifest.version, '2.3.16')
  assert.ok(parsed.code.includes('amazonTrackAudioModes'))
  assert.notEqual(keyOf('amazon-new'), keyOf('amazon'),
    'Do not share login or settings namespaces with legacy Amazon')
})

test('desktop recognizes actual Amazon audioQualities but never guesses Atmos from codec', () => {
  assert.equal(hasAtmosMetadata({ audioQualities: ['HD', 'UHD', 'ATMOS'] }), true)
  assert.equal(hasAtmosMetadata({ audio_qualities: ['HD', 'DOLBY_ATMOS'] }), true)
  assert.equal(hasAtmosMetadata({ audioQualities: ['HD', 'UHD', '360RA'], audio_codec: 'ac4' }), false)
  assert.equal(hasAtmosMetadata({ codec: 'ac4' }), false)
})

test('Amazon (New) uses explicit AC-4 only for Dolby action, normal playback stays FLAC', () => {
  assert.equal(stereoPlaybackQuality(amazon, { downloadQuality: 'ac4' }), 'best')
  assert.equal(addonDownloadQuality(amazon, { downloadQuality: 'ac4' }), 'best')
  assert.equal(addonDownloadQuality(amazon, {}, {
    quality: 'ac4', allowAtmos: true, purpose: 'download',
  }), 'ac4')
  assert.throws(() => addonDownloadQuality(amazon, {}, {
    quality: 'ac4', allowAtmos: false, purpose: 'download',
  }))
})
