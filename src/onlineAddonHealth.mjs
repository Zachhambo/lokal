// Automatic Discovery can move past an unhealthy HTTP addon without changing
// the listener's saved provider priority or disabling explicitly chosen playback.
// Morneye packages can legitimately prepare a file and are not subject to this.
export const AUTOMATIC_HTTP_BUDGET_MS = 3000
export const AUTOMATIC_HTTP_COOLDOWN_MS = 45000

const transient = /(?:timed? ?out|timeout|too long to answer|network|could not (?:reach|connect)|\bHTTP (?:502|503|504)\b|\bE(?:CONNRESET|TIMEDOUT|CONNREFUSED)\b)/i

export function isHttpAddonSource(source) {
  return /^a-[0-9a-f]{10}$/.test(String(source?.id || '')) && source.package !== true
}

export function isTransientAddonFailure(error) {
  const message = typeof error === 'string' ? error : String(error?.message || error || '')
  return transient.test(message)
}

export function createHttpAddonHealth({ cooldownMs = AUTOMATIC_HTTP_COOLDOWN_MS, now = Date.now } = {}) {
  const blocked = new Map()
  return {
    // Only automatic routing can skip providers. Never skip all available
    // sources; always probe one if the entire configured set is cooling.
    shouldSkip(source, sources) {
      if (!isHttpAddonSource(source)) return false
      const until = blocked.get(source.id) || 0
      if (until <= now()) { blocked.delete(source.id); return false }
      return sources.some(other => other.id !== source.id &&
        (!isHttpAddonSource(other) || (blocked.get(other.id) || 0) <= now()))
    },
    failed(source, error) {
      if (!isHttpAddonSource(source)) return
      if (isTransientAddonFailure(error)) blocked.set(source.id, now() + cooldownMs)
      else blocked.delete(source.id)
    },
    succeeded(source) {
      if (isHttpAddonSource(source)) blocked.delete(source.id)
    },
    reset() { blocked.clear() },
  }
}

export const automaticHttpAddonHealth = createHttpAddonHealth()
