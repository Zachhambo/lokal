import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { measuredResolutionLabel } from '../src/resolutionLabel.mjs'
import { trackColumnLayout } from '../src/trackColumns.js'

const local = {
  id: 'song', file_path: '/music/a.flac', codec: 'FLAC', lossless: 1,
  bit_depth: 24, sample_rate: 96000, bitrate: 2400,
}

test('source resolution matches Mobile: codec, bit depth, exact kHz', () => {
  assert.equal(measuredResolutionLabel(local), 'FLAC · 24-bit / 96 kHz')
  assert.equal(measuredResolutionLabel({ ...local, bit_depth: 16, sample_rate: 44100 }),
    'FLAC · 16-bit / 44.1 kHz')
  assert.equal(measuredResolutionLabel({ ...local, bit_depth: null, sample_rate: 192000 }),
    'FLAC · 192 kHz')
  assert.equal(measuredResolutionLabel({ ...local, bit_depth: 24, sample_rate: null }),
    'FLAC · 24-bit')
})

test('lossy tags show encoded bitrate or measured sample rate, not PCM depth', () => {
  const mp3 = { ...local, codec: 'MP3', lossless: 0, bitrate: 320, bit_depth: 32, sample_rate: 44100 }
  assert.equal(measuredResolutionLabel(mp3), 'MP3 · 320 kbps / 44.1 kHz')
  assert.equal(measuredResolutionLabel({ ...mp3, codec: 'OPUS', bitrate: 160, sample_rate: null }),
    'OPUS · 160 kbps')
  assert.equal(measuredResolutionLabel({ ...mp3, bitrate: null, sample_rate: 48000 }),
    'MP3 · 48 kHz')
  assert.equal(measuredResolutionLabel({ ...mp3, bitrate: null, sample_rate: null }), null,
    'codec alone must not replace a quality-tier badge')
})

test('unknown, missing and implausible readings never manufacture resolution', () => {
  assert.equal(measuredResolutionLabel(null), null)
  assert.equal(measuredResolutionLabel({ ...local, file_path: 'ghost://album/123' }), null)
  assert.equal(measuredResolutionLabel({ ...local, bit_depth: 0, sample_rate: 0 }), null)
  assert.equal(measuredResolutionLabel({ ...local, bit_depth: 512, sample_rate: 900000 }), null)
  assert.equal(measuredResolutionLabel({ ...local, codec: 'UNKNOWN', bit_depth: 16, sample_rate: 44100 }),
    '16-bit / 44.1 kHz')
  assert.equal(measuredResolutionLabel({ ...local, atmos_verified: 1 }), 'E-AC-3 JOC · Dolby Atmos')
})

test('full-resolution song-list width expands only when the option is enabled', () => {
  const columns = { quality: true, number: false, selection: false, source: false,
    time: false, added: false, grip: false, actions: false }
  const compact = trackColumnLayout(65, columns)
  const detailed = trackColumnLayout(65, columns, { fullResolution: true })
  assert.equal(compact.quality, true)
  assert.equal(detailed.quality, true)
  assert.match(compact.template, /4\.5rem/)
  assert.match(detailed.template, /11\.25rem/)
  const narrow = trackColumnLayout(23, columns, { fullResolution: true })
  assert.equal(narrow.quality, false, 'never squeeze a full resolution badge into a 4.5rem slot')
})

test('separate Appearance toggles persist and do not rewrite existing quality tiers', () => {
  const pref = readFileSync(new URL('../src/resolutionTagPreferences.js', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
  assert.match(pref, /resolution_tags_in_lists/)
  assert.match(pref, /resolution_tags_in_full_player/)
  assert.match(pref, /peekSettings\(\)\?\.\[key\] === '1'/)
  assert.match(pref, /lokal:settings-saved/)
  assert.match(settings, /set\('resolution_tags_in_lists', settings\.resolution_tags_in_lists === '1' \? '0' : '1'\)/)
  assert.match(settings, /set\('resolution_tags_in_full_player', settings\.resolution_tags_in_full_player === '1' \? '0' : '1'\)/)
})

test('every song row and compact player use the list option; fullscreen has its own white pill', () => {
  const rows = readFileSync(new URL('../src/components/TrackList.jsx', import.meta.url), 'utf8')
  const bar = readFileSync(new URL('../src/components/PlayerBar.jsx', import.meta.url), 'utf8')
  const fullscreen = readFileSync(new URL('../src/components/FullscreenPlayer.jsx', import.meta.url), 'utf8')
  assert.match(rows, /const fullResolutionTags = useFullResolutionTags\(\)/)
  assert.match(rows, /qualityTagLabel\(track, tier, allowResolution\)/)
  assert.match(rows, /fullResolution: fullResolutionTags/)
  assert.match(bar, /const fullResolutionTags = useFullResolutionTags\(\)/)
  assert.match(bar, /qualityTagLabel\(currentTrack, qualityTier, fullResolutionTags\)/)
  assert.match(fullscreen, /qualityTagLabel\(currentTrack, fullscreenQualityTier, settings\.resolution_tags_in_full_player === '1'\)/)
  assert.match(fullscreen, /data-fullscreen-quality-tag[\s\S]*?border-white\/25 bg-white\/10/,
    'the white full-resolution tag is anchored above the cover, not under album metadata')
  assert.match(fullscreen, /showFullscreenQuality && \(/)
  assert.match(fullscreen, /fullscreenQualityTier === 'unknown' && fullscreenQualityLabel === 'Not read'/)
  assert.ok(fullscreen.indexOf('data-fullscreen-quality-tag') < fullscreen.indexOf('fullscreen-cover-stage'),
    'badge must be above the artwork in the cover stage')
  assert.ok(fullscreen.indexOf('data-fullscreen-quality-tag') < fullscreen.indexOf('{currentTrack.album}</p>'),
    'badge must not be placed beneath the album')
  assert.match(fullscreen, /trackDetailsVisible \? 'opacity-100' : 'opacity-0'/)
})

test('fullscreen header eye button shows and hides artwork details as one group', () => {
  const fullscreen = readFileSync(new URL('../src/components/FullscreenPlayer.jsx', import.meta.url), 'utf8')
  assert.match(fullscreen, /const \[trackDetailsVisible, setTrackDetailsVisible\] = useState\(true\)/)
  assert.match(fullscreen, /data-fullscreen-details-toggle/)
  assert.match(fullscreen, /onClick=\{\(\) => setTrackDetailsVisible\(visible => !visible\)\}/)
  assert.match(fullscreen, /trackDetailsVisible \? <EyeOff size=\{15\} \/> : <Eye size=\{15\} \/>/)
  assert.ok(fullscreen.indexOf('data-fullscreen-details-toggle') < fullscreen.indexOf('onClick={toggleScreen}'),
    'eye toggle must be adjacent to the monitor fullscreen button in the same header action group')

  for (const marker of ['data-fullscreen-quality-tag', 'data-fullscreen-track-seekbar',
    'data-fullscreen-track-metadata']) {
    assert.match(fullscreen, new RegExp(marker + '[^\\n]*aria-hidden=\\{!trackDetailsVisible\\}'),
      marker + ' should hide accessibly when details are disabled')
  }
  assert.match(fullscreen, /data-fullscreen-track-seekbar="" aria-hidden=\{!trackDetailsVisible\} inert=\{!trackDetailsVisible\}/)
  const meta = fullscreen.slice(fullscreen.indexOf('data-fullscreen-track-metadata'), fullscreen.indexOf('</motion.div>', fullscreen.indexOf('data-fullscreen-track-metadata')))
  assert.match(meta, /\{currentTrack\?\.title/)
  assert.match(meta, /\{currentTrack\?\.artist/)
  assert.match(meta, /\{currentTrack\.album\}/)

  const tag = fullscreen.slice(fullscreen.indexOf('data-fullscreen-quality-tag'), fullscreen.indexOf('</div>', fullscreen.indexOf('data-fullscreen-quality-tag')))
  assert.doesNotMatch(tag, /chromeHidden|chromeFade/,
    'quality badge must stay visible after mouse-idle timeout')
  const seek = fullscreen.slice(fullscreen.indexOf('data-fullscreen-track-seekbar'), fullscreen.indexOf('</div>', fullscreen.indexOf('data-fullscreen-track-seekbar')))
  assert.doesNotMatch(seek, /chromeHidden/,
    'seek bar must be controlled by eye toggle, not idle mouse')
  assert.doesNotMatch(meta, /chromeHidden/,
    'title, artist and album must be controlled by eye toggle, not idle mouse')
  assert.match(fullscreen, /className=\{\x60pointer-events-none z-20 flex h-0/,
    'badge should not add layout height or make the cover jump when toggled')
})
