// Source-file resolution, shared by all Desktop quality badges. Keep this
// pure so the mapping can be validated without Electron/React. The display is
// source metadata, not a promise of bit-perfect hardware output.
export function measuredResolutionLabel(track, codecLabel = track?.codec || '') {
  if (!track || String(track.file_path || '').startsWith('ghost://')) return null
  if (Number(track.atmos_verified) === 1) return 'E-AC-3 JOC · Dolby Atmos'
  const codec = String(codecLabel || '').trim().toUpperCase()
  const isLossless = Number(track.lossless) === 1 ||
    /^(?:FLAC|WAV|ALAC|AIFF|AIF|APE|WAVPACK)$/.test(codec)
  const bits = Number(track.bit_depth)
  const rate = Number(track.sample_rate)
  const kbps = Number(track.bitrate)
  const parts = []
  // An MP3/AAC decoded into 24-bit or 32-bit PCM is still a lossy source:
  // never present those output widths as a source bit depth.
  if (isLossless && Number.isInteger(bits) && bits >= 8 && bits <= 64) parts.push(`${bits}-bit`)
  if (Number.isFinite(rate) && rate >= 8000 && rate <= 768000) {
    const khz = rate / 1000
    parts.push(`${Number(khz.toFixed(1))} kHz`)
  }
  if (!isLossless && Number.isFinite(kbps) && kbps > 0 && kbps <= 10000) {
    parts.unshift(`${Math.round(kbps)} kbps`)
  }
  if (!parts.length) return null
  const known = codec && !['UNKNOWN', 'ONLINE', 'N/A', 'OTHER'].includes(codec)
  return [known ? codec : '', parts.join(' / ')].filter(Boolean).join(' · ')
}
