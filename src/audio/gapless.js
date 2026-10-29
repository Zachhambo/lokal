// Local song boundaries should not wait for the old HTMLMediaElement's
// `ended` event before opening the next decoder. Keep a second, already
// buffered deck ready and hand off with a sub-100ms equal-rate overlap.
//
// This is deliberately *not* a DJ crossfade: the tiny seam compensates for
// Chromium's asynchronous media element start. The file itself is not trimmed,
// resampled or edited. True sample-accurate joins still require a continuous
// decoder/PCM queue, which HTMLMediaElement does not expose.
export const GAPLESS_PREPARE_AHEAD_S = 12
export const GAPLESS_JOIN_S = 0.09

export function gaplessHandoffPlan(duration) {
  if (!Number.isFinite(duration) || duration <= GAPLESS_JOIN_S * 2) return null
  return {
    kind: 'gapless',
    start: duration - GAPLESS_JOIN_S,
    length: GAPLESS_JOIN_S,
    fadeIn: GAPLESS_JOIN_S,
    inOffset: 0,
    rate: 1,
    bassSwap: false,
  }
}

/**
 * Transition modes:
 * - Off: all consecutive ordinary local files should play without an
 *   additional decoder startup pause.
 * - AutoMix: keep its deliberate mixing plan except when it explicitly
 *   preserves an album sequence unchanged.
 * - Crossfade: already has its own timing/decoder preparation.
 */
export function shouldPrepareGapless({
  mode,
  sameAlbum = false,
  playing = true,
  repeat = 'none',
  autoplay = true,
  current,
  next,
  remaining,
  localCurrent = true,
  localNext = true,
  castActive = false,
} = {}) {
  if (!playing || !autoplay || repeat === 'one' || castActive) return false
  if (!current || !next || !localCurrent || !localNext) return false
  if (current.atmosNative || next.atmosNative || current.atmosEncoded || next.atmosEncoded) return false
  if (!(remaining > 0 && remaining <= GAPLESS_PREPARE_AHEAD_S)) return false
  return mode === 'off' || (mode === 'automix' && sameAlbum)
}
