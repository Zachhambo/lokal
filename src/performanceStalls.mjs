// Diagnose post-paint renderer freezes, not just slow window creation.
// Called only by the Electron entry point. No Observer/stack collection on
// every frame: one inexpensive timer per second reports event-loop stalls.
export const SAMPLE_MS = 500
export const WARN_MS = 220
export const MAX_REPORT_MS = 30_000
export const REPORT_COOLDOWN_MS = 4_000

export function measuredStall(now, expectedInterval = SAMPLE_MS) {
  return Math.max(0, now - expectedInterval)
}

export function startRendererStallMonitor({
  now = () => performance.now(),
  interval = (callback, ms) => setInterval(callback, ms),
  clear = handle => clearInterval(handle),
  active = () => typeof document === 'undefined' || document.visibilityState === 'visible',
  report = duration => {
    try {
      window.electron?.log?.('warn',
        `[performance] Renderer event loop unresponsive for ${Math.round(duration)}ms`)
    } catch {}
  },
} = {}) {
  let last = now()
  let reportedAt = -Infinity
  const timer = interval(() => {
    const at = now()
    const blocked = measuredStall(at - last)
    last = at
    if (blocked < WARN_MS || blocked > MAX_REPORT_MS ||
        !active() || at - reportedAt < REPORT_COOLDOWN_MS) return
    reportedAt = at
    report(blocked)
  }, SAMPLE_MS)
  return () => clear(timer)
}
