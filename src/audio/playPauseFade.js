export const PLAY_PAUSE_FADE_DEFAULT_SECONDS = 0.5
export const PLAY_PAUSE_FADE_MAX_SECONDS = 5

export function readPlayPauseFadeSeconds(settings = {}) {
  const value = Number.parseFloat(settings?.play_pause_fade_seconds)
  if (!Number.isFinite(value)) return PLAY_PAUSE_FADE_DEFAULT_SECONDS
  return Math.min(PLAY_PAUSE_FADE_MAX_SECONDS, Math.max(0, value))
}

export function schedulePlayPauseFade(param, context, target, duration) {
  if (!param || !context) return 0
  const now = context.currentTime
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  } else {
    const current = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(current, now)
  }
  if (duration <= 0) {
    param.setValueAtTime(target, now)
    return 0
  }
  param.linearRampToValueAtTime(target, now + duration)
  return duration
}
