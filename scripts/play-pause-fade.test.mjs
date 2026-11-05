import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PLAY_PAUSE_FADE_DEFAULT_SECONDS,
  readPlayPauseFadeSeconds,
  schedulePlayPauseFade,
} from '../src/audio/playPauseFade.js'

test('play/pause fade duration defaults safely and stays in range', () => {
  assert.equal(readPlayPauseFadeSeconds(), PLAY_PAUSE_FADE_DEFAULT_SECONDS)
  assert.equal(readPlayPauseFadeSeconds({ play_pause_fade_seconds: '2.4' }), 2.4)
  assert.equal(readPlayPauseFadeSeconds({ play_pause_fade_seconds: '-1' }), 0)
  assert.equal(readPlayPauseFadeSeconds({ play_pause_fade_seconds: '99' }), 5)
  assert.equal(readPlayPauseFadeSeconds({ play_pause_fade_seconds: 'invalid' }), PLAY_PAUSE_FADE_DEFAULT_SECONDS)
})

test('play/pause fade cancels the previous ramp and schedules the requested target', () => {
  const calls = []
  const param = {
    value: 0.4,
    cancelAndHoldAtTime: time => calls.push(['hold', time]),
    linearRampToValueAtTime: (value, time) => calls.push(['ramp', value, time]),
    setValueAtTime: (value, time) => calls.push(['set', value, time]),
  }
  const context = { currentTime: 3 }

  assert.equal(schedulePlayPauseFade(param, context, 1, 0.5), 0.5)
  assert.deepEqual(calls, [['hold', 3], ['ramp', 1, 3.5]])

  calls.length = 0
  assert.equal(schedulePlayPauseFade(param, context, 0, 0), 0)
  assert.deepEqual(calls, [['hold', 3], ['set', 0, 3]])
})

test('play/pause fade falls back to the current gain when hold is unavailable', () => {
  const calls = []
  const param = {
    value: 0.25,
    cancelScheduledValues: time => calls.push(['cancel', time]),
    setValueAtTime: (value, time) => calls.push(['set', value, time]),
    linearRampToValueAtTime: (value, time) => calls.push(['ramp', value, time]),
  }

  schedulePlayPauseFade(param, { currentTime: 4 }, 0, 1)
  assert.deepEqual(calls, [['cancel', 4], ['set', 0.25, 4], ['ramp', 0, 5]])
})
