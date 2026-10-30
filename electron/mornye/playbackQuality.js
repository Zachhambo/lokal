'use strict'

// The catalogue can advertise both stereo and Dolby Atmos for one Tidal ID.
// Ordinary HTMLAudioElement streaming is never a native JOC transport. Keep
// its quality selection independent of a user's Atmos download preference.
function isAtmosQuality(value) {
  return /^(?:DOLBY[_ -]?ATMOS|ATMOS|AC-?4)$/i.test(String(value || '').trim())
}

function spatialQuality(addon, quality) {
  const option = (addon?.manifest?.qualityOptions || []).find(q => q.id === quality)
  return isAtmosQuality(quality) || option?.kind === 'spatial' ||
    /^amazon(?:-(?:new|web))?$/i.test(addon?.name || '') && String(quality || '').toLowerCase() === 'eac3'
}

// The add-on's saved quality is its playback preference. Never secretly swap
// a selected Atmos tier for FLAC. Requesting it does not certify the rendition.
function addonPlaybackQuality(addon, settings = {}) {
  const options = addon?.manifest?.qualityOptions || []
  const saved = settings.downloadQuality
  if (saved && options.some(q => q?.id === saved)) return saved
  const available = options.filter(q => q?.id && !spatialQuality(addon, q.id))
  const preferred = available.find(q => String(q.id).toUpperCase() === 'HI_RES_LOSSLESS') ||
    available.find(q => String(q.id).toUpperCase() === 'LOSSLESS') ||
    available.find(q => q.kind === 'lossless') || available[0]
  return preferred?.id || (/tidal/i.test(addon?.name || '') ? 'HI_RES_LOSSLESS' : undefined)
}

// Historical name used by the streaming layer; now returns the saved
// preference as-is. Its caller must route spatial formats to native output.
function stereoPlaybackQuality(addon, settings = {}) {
  return addonPlaybackQuality(addon, settings)
}


/** Download and playback use the add-on setting; explicit one-off quality
 * overrides it. Only dedicated native output may consume spatial streams.
 */
function addonDownloadQuality(addon, settings = {}, { quality, allowAtmos = false, purpose = 'download' } = {}) {
  const options = addon?.manifest?.qualityOptions || []
  if (quality) {
    if (spatialQuality(addon, quality)) {
      if (purpose === 'playback') throw new Error('Configured spatial audio needs native output; PCM playback cannot preserve the encoded stream.')
      if (!allowAtmos) throw new Error('Native spatial audio requires explicit authorization')
      const selected = options.find(q => q.id === quality)
      if (!selected) throw new Error('The addon does not offer the requested spatial tier')
      return selected.id
    }
    return quality
  }
  const preferred = addonPlaybackQuality(addon, settings)
  if (purpose === 'playback' && spatialQuality(addon, preferred)) {
    throw new Error('Configured spatial audio needs native output; PCM playback cannot preserve the encoded stream.')
  }
  return preferred || 'default'
}

module.exports = { isAtmosQuality, spatialQuality, addonPlaybackQuality, stereoPlaybackQuality, addonDownloadQuality }
