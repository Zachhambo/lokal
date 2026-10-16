import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLAYBACK_FADE_MS, playbackFadeLevel } from '../src/audio/playbackFade.js'

test('playback fades linearly over half a second', () => {
  assert.equal(PLAYBACK_FADE_MS, 500)
  assert.equal(playbackFadeLevel(0, 1, 0), 0)
  assert.equal(playbackFadeLevel(0, 1, 250), 0.5)
  assert.equal(playbackFadeLevel(0, 1, 500), 1)
  assert.equal(playbackFadeLevel(1, 0, 250), 0.5)
  assert.equal(playbackFadeLevel(1, 0, 500), 0)
  assert.equal(playbackFadeLevel(0, 1, 700), 1)
})
