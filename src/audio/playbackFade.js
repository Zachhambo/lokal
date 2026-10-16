export const PLAYBACK_FADE_MS = 500

export function playbackFadeLevel(from, to, elapsedMs) {
  const progress = Math.max(0, Math.min(1, elapsedMs / PLAYBACK_FADE_MS))
  return from + (to - from) * progress
}
