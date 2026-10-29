import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GAPLESS_PREPARE_AHEAD_S, GAPLESS_JOIN_S,
  gaplessHandoffPlan, shouldPrepareGapless,
} from '../src/audio/gapless.js'
import { albumContinues, planTransition } from '../src/audio/automix.js'

const jfk = { id: 'jfk', title: '(JFK)', artist: 'Muse', album: 'Drones',
  album_artist: 'Muse', track_num: 7, duration: 54, file_path: '/music/Drones/07-JFK.flac' }
const defector = { id: 'defector', title: 'Defector', artist: 'Muse', album: 'Drones',
  album_artist: 'Muse', track_num: 8, duration: 270, file_path: '/music/Drones/08-Defector.flac' }

test('issue #642: Muse (JFK) to Defector is an album continuation that AutoMix does not remix', () => {
  assert.equal(albumContinues(jfk, defector), true)
  assert.equal(planTransition({
    out: null, next: null, outTrack: jfk, nextTrack: defector, outDuration: 54,
  }), null, 'the default AutoMix planner deliberately preserves album ordering')
  assert.equal(shouldPrepareGapless({
    mode: 'automix', current: jfk, next: defector, sameAlbum: true, remaining: 10,
  }), true, 'an unremixed album pair must preload rather than wait for ended')
  assert.equal(shouldPrepareGapless({
    mode: 'automix', current: jfk, next: { ...defector, album: 'Other' },
    sameAlbum: false, remaining: 10,
  }), false, 'other AutoMix transitions keep their own analysis-driven plan')
})

test('disabled transitions prepare local PCM at the end without an ordinary fade', () => {
  assert.equal(shouldPrepareGapless({
    mode: 'off', current: jfk, next: defector, remaining: GAPLESS_PREPARE_AHEAD_S,
  }), true)
  const plan = gaplessHandoffPlan(54)
  assert.equal(plan.kind, 'gapless')
  assert.ok(Math.abs(plan.start + plan.length - 54) < 1e-6)
  assert.equal(plan.inOffset, 0, 'the next song must begin from its first frame')
  assert.ok(plan.length < 0.1, 'a tiny decoder overlap, not a visible multi-second fade')
  assert.equal(plan.rate, 1, 'do not pitch- or tempo-shift an album')
  assert.equal(plan.fadeIn, GAPLESS_JOIN_S)
  assert.equal(gaplessHandoffPlan(0), null)
  assert.equal(gaplessHandoffPlan(NaN), null)
})

test('preparation does not interfere with crossfade, pause, repeat one, Cast or native Atmos', () => {
  const base = { mode: 'off', current: jfk, next: defector, remaining: 5 }
  for (const options of [
    { mode: 'crossfade' },
    { enabled: false },

    { mode: 'automix' },
    { repeat: 'one' },
    { playing: false },
    { autoplay: false },
    { castActive: true },
    { localCurrent: false },
    { localNext: false },
    { current: { ...jfk, atmosNative: true } },
    { next: { ...defector, atmosEncoded: true } },
    { remaining: GAPLESS_PREPARE_AHEAD_S + 0.1 },
    { remaining: 0 },
    { current: null },
    { next: null },
  ]) {
    assert.equal(shouldPrepareGapless({ ...base, ...options }), false,
      JSON.stringify(options))
  }
})

test('gapless staging shares the existing source-aware, cancellable two-deck handoff', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(source, /enabled: state\.crossfade\?\.gapless !== false/, 'the player must respect the saved switch')
  assert.match(source, /plan === null && shouldPrepareGapless\(/,
    'AutoMix must stage an album whose plan is intentionally null')
  assert.match(source, /mode: 'off',[\s\S]*?triggerCrossfade\(nextTrack, gaplessHandoffPlan\(dur\)\)/,
    'transitions Off must stage locally rather than wait for ended')
  assert.match(source, /localNext: !!nextTrack\?\.file_path && !streamRef\(nextTrack\)/,
    'do not prematurely open online sources and verification prompts')
  assert.match(source, /live\.crossfade\?\.gapless === false/, 'disabling the toggle also cancels a prepared transition')
  assert.match(source, /upcomingTrack\(live\)\?\.id !== nextTrack\.id/,
    'queue edits during preload must cancel the now-stale transition')
  assert.match(source, /fadeInEl\.addEventListener\('canplay', onReady\)/)
  assert.match(source, /fadeOutEl\.addEventListener\('ended', onEnded\)/)
  assert.match(source, /cancelCrossfade\(\)/)
  assert.match(source, /if \(!usePlayerStore\.getState\(\)\.isPlaying \|\| \(fadeOutEl\.paused && !fadeOutEl\.ended\)\)/,
    'preparation must not start a paused song automatically')
  assert.match(source, /if \(left <= 0\.03 \|\| fadeOutEl\.ended\) \{ beginCrossfade\(\); return \}/)
})

test('Playback settings offer a persistent Gapless toggle independent of transition mode', () => {
  const source = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
  assert.match(source, /Row label=\{t\('Gapless Playback'\)\}/)
  assert.match(source, /set\('gapless_playback', crossfade\.gapless \? '0' : '1'\)/)
  assert.match(source, /aria-pressed=\{crossfade\.gapless\}/)
  assert.match(source, /k === 'gapless_playback'.*setCrossfadeOptions\(readCrossfadeSettings\(/)
})
