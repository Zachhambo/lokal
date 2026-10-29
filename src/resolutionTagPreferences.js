import { useEffect, useState } from 'react'
import { api, peekSettings } from './api'

// Match Mobile's two independent Appearance toggles. Both default off and
// follow backend-saved settings instead of a new local-only preference.
export const RESOLUTION_LISTS_KEY = 'resolution_tags_in_lists'
export const RESOLUTION_FULL_PLAYER_KEY = 'resolution_tags_in_full_player'

export function useFullResolutionTags(fullPlayer = false) {
  const key = fullPlayer ? RESOLUTION_FULL_PLAYER_KEY : RESOLUTION_LISTS_KEY
  const [enabled, setEnabled] = useState(() => peekSettings()?.[key] === '1')
  useEffect(() => {
    let active = true
    let request = 0
    const refresh = () => {
      const sequence = ++request
      const cached = peekSettings()
      if (cached) {
        setEnabled(cached[key] === '1')
        return
      }
      Promise.resolve(api.getSettings()).then(settings => {
        if (active && request === sequence) setEnabled(settings?.[key] === '1')
      }).catch(() => {})
    }
    refresh()
    window.addEventListener('lokal:settings-saved', refresh)
    return () => {
      active = false
      window.removeEventListener('lokal:settings-saved', refresh)
    }
  }, [key])
  return enabled
}
