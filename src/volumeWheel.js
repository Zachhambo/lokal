import { useCallback, useEffect, useRef } from 'react'

export const VOLUME_WHEEL_STEP = 0.05

/** The volume after one wheel notch: up raises it, down lowers it, clamped to the current output range. */
export function wheelVolume(volume, deltaY, max = 1) {
  const next = (Number(volume) || 0) - VOLUME_WHEEL_STEP * Math.sign(deltaY || 0)
  return Math.round(Math.min(max, Math.max(0, next)) * 100) / 100
}

/**
 * A ref for a volume slider so the mouse wheel over it changes the volume
 * instead of scrolling the page. Attached natively: React's onWheel is
 * passive, so preventDefault there wouldn't stop the scroll.
 */
export function useVolumeWheel(volume, setVolume, max = 1) {
  const latest = useRef({ volume, setVolume, max })
  latest.current = { volume, setVolume, max }
  const cleanup = useRef(null)
  useEffect(() => () => cleanup.current?.(), [])
  return useCallback((element) => {
    cleanup.current?.()
    cleanup.current = null
    if (!element) return
    const onWheel = (event) => {
      if (!event.deltaY) return
      event.preventDefault()
      const { volume: current, setVolume: set, max: limit } = latest.current
      set(wheelVolume(current, event.deltaY, limit))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    cleanup.current = () => element.removeEventListener('wheel', onWheel)
  }, [])
}
