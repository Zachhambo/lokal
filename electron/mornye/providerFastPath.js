'use strict'

// The availability check is the authoritative provider authorization and
// lookup for both Play and Save. Only an unsuccessful cross-catalogue match
// should retry after enriching the track metadata; this is not a playback
// bypass, and no provider (including Tidal) has a special exemption.
function needsCrossProviderEnrichment({ addon, track } = {}) {
  if (!track || !addon) return false
  const name = value => String(value || '').trim().toLowerCase().replace(/-web$/, '')
  return !(name(addon.name) && name(track.provider_id) === name(addon.name)
    && String(track.id || '').trim() && String(track.name || '').trim())
}

module.exports = { needsCrossProviderEnrichment }
