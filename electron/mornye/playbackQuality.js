'use strict'

// The catalogue can advertise both stereo and Dolby Atmos for one Tidal ID.
// Ordinary HTMLAudioElement streaming is never a native JOC transport. Keep
// its quality selection independent of a user's Atmos download preference.
function isAtmosQuality(value) {
  return /^(?:DOLBY[_ -]?ATMOS|ATMOS|AC-?4)$/i.test(String(value || '').trim())
}

function stereoPlaybackQuality(addon, settings = {}) {
  const configured = settings.downloadQuality
  const selected = (addon?.manifest?.qualityOptions || []).find(opt => opt.id === configured)
  if (!isAtmosQuality(configured) && selected?.kind !== 'spatial') return configured || undefined
  const options = addon?.manifest?.qualityOptions || []
  const stereo = options.filter(opt => opt?.id && !isAtmosQuality(opt.id) &&
    !isAtmosQuality(opt.kind) && !isAtmosQuality(opt.name) &&
    !isAtmosQuality(opt.label) && opt.kind !== 'spatial')
  const rank = opt => {
    const id = String(opt.id).toUpperCase()
    if (id === 'HI_RES_LOSSLESS') return 0
    if (id === 'LOSSLESS') return 1
    if (id === 'HIGH') return 2
    return opt.kind === 'lossless' ? 3 : 4
  }
  stereo.sort((a, b) => rank(a) - rank(b))
  // Tidal's stereo tiers have stable IDs. Never use the Atmos tier merely
  // because an add-on didn't publish the optional qualityOptions manifest.
  return stereo[0]?.id || (/tidal/i.test(addon?.name || '') ? 'HI_RES_LOSSLESS' : undefined)
}


/** Ordinary download chooses a stereo tier even if Atmos was saved as default.
 * An Atmos request is only legal for a separately opted-in download operation.
 * Never silently substitute stereo for an explicitly requested Atmos version.
 */
function addonDownloadQuality(addon, settings = {}, { quality, allowAtmos = false, purpose = 'download' } = {}) {
  if (isAtmosQuality(quality)) {
    if (!allowAtmos || purpose !== 'download') throw new Error('Dolby Atmos requires the explicit Download Dolby Atmos action')
    const options = addon?.manifest?.qualityOptions || []
    const amazon = /^amazon(?:-web)?$/i.test(addon?.name || '')
    const offered = options.find(q => String(q?.id || '').toLowerCase() === (amazon ? 'ac4' : 'dolby_atmos')) ||
      options.find(q => isAtmosQuality(q?.id))
    if (!offered) throw new Error('This addon does not offer Dolby Atmos downloads')
    return offered.id
  }
  if (quality) return quality
  const savedOption = (addon?.manifest?.qualityOptions || []).find(opt => opt.id === settings.downloadQuality)
  if (settings.downloadQuality && !isAtmosQuality(settings.downloadQuality) && savedOption?.kind !== 'spatial') return settings.downloadQuality
  const available = (addon?.manifest?.qualityOptions || []).filter(q => q?.id &&
    q.kind !== 'spatial' && ![q.id, q.name, q.label, q.kind].some(isAtmosQuality))
  const preferred = available.find(q => String(q.id).toUpperCase() === 'HI_RES_LOSSLESS') ||
    available.find(q => String(q.id).toUpperCase() === 'LOSSLESS') ||
    available.find(q => q.kind === 'lossless') || available[0]
  // Tidal versions can omit qualityOptions. Its stable hi-res stereo tier is
  // still safer than sending DOLBY_ATMOS or the first manifest choice.
  return preferred?.id || (/tidal/i.test(addon?.name || '') ? 'HI_RES_LOSSLESS' : 'default')
}

module.exports = { isAtmosQuality, stereoPlaybackQuality, addonDownloadQuality }
