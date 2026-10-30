'use strict'

// Only a user-selected HTTP addon quality can request native spatial output.
// A provider-wide capability, track catalogue label or bare E-AC-3 codec
// never establishes that a recording actually contains Dolby Atmos.
function selectedHttpSpatial(addon) {
  if (!addon?.manifest || !addon.settings) return null
  for (const field of addon.manifest.settings || []) {
    if (!/quality|codec|format|audio/i.test(String(field?.key || ''))) continue
    const selected = addon.settings[field.key] ?? field.default
    if (selected == null || selected === '') continue
    const option = (field.options || []).find(o =>
      String(typeof o === 'object' ? o.value : o) === String(selected))
    if (!option) continue
    const label = String(typeof option === 'object' ? option.label || '' : '')
    const value = String(selected).trim().replace(/[ -]/g, '_').toUpperCase()
    if (['AC4_ATMOS', 'AC_4_ATMOS'].includes(value) ||
        (/\bATMOS\b/i.test(label) && /\bAC[- ]?4\b/i.test(label))) {
      return { codec: 'ac4', setting: field.key }
    }
    if (['DOLBY_ATMOS', 'ATMOS', 'EAC3_JOC', 'E_AC_3_JOC'].includes(value) ||
        /\bATMOS\b|\bJOC\b/i.test(label)) {
      return { codec: 'eac3-joc', setting: field.key }
    }
  }
  return null
}

// Download a signed progressive stream to a temporary file. The existing
// HTTP addon resolver enforces its own URL/manifest constraints. Redirects
// here are also manually validated and bounded; signed URLs, media bytes and
// the source's token never appear in errors or logs.
async function stageHttpSpatialAudio(url, { signal, fetchImpl = fetch, maxBytes = 512 * 1024 * 1024 } = {}) {
  const fs = require('node:fs')
  const fsp = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const { Readable, Transform } = require('node:stream')
  const { pipeline } = require('node:stream/promises')
  const { checkUrl } = require('./addons')
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lokal-http-spatial-'))
  const file = path.join(dir, 'audio.m4a')
  const cleanup = async () => fsp.rm(dir, { recursive: true, force: true })
  const deadline = AbortSignal.timeout(240000)
  const aborter = new AbortController()
  const cancel = () => aborter.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  deadline.addEventListener('abort', cancel, { once: true })
  try {
    let current = checkUrl(url)
    const local = host => /^(?:localhost|127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.|\\[?::1\\]?)/i.test(host) ||
      /\\.(?:local|internal|lan)$/.test(host)
    const startedLocal = local(current.hostname)
    for (let hop = 0; hop <= 4; hop++) {
      const response = await fetchImpl(current, {
        method: 'GET', redirect: 'manual', signal: aborter.signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === 4) throw new Error('Too many media redirects')
        const location = response.headers.get('location')
        if (!location) throw new Error('Media redirect lacked a destination')
        const next = checkUrl(new URL(location, current).toString())
        // A remote signed-media URL cannot redirect the app into a private
        // network, localhost, or a user's local API.
        if (!startedLocal && local(next.hostname)) throw new Error('Media redirect to a private host was refused')
        current = next
        await response.body?.cancel()
        continue
      }
      if (!response.ok || !response.body) throw new Error('Selected quality is unavailable from this HTTP addon')
      const declared = Number(response.headers.get('content-length'))
      if (declared > maxBytes) throw new Error('The selected audio exceeds the playback staging limit')
      let length = 0
      const limit = new Transform({
        transform(chunk, encoding, next) {
          length += chunk.length
          if (length > maxBytes) next(new Error('The selected audio exceeds the playback staging limit'))
          else next(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(file), { signal: aborter.signal })
      if (!length) throw new Error('The HTTP addon returned empty audio')
      return { file, cleanup }
    }
    throw new Error('Could not resolve the selected spatial audio stream')
  } catch (error) {
    await cleanup()
    // Signed media locations can be present in network exception messages.
    throw new Error(error?.name === 'AbortError' ? 'Spatial audio request was cancelled or timed out' :
      /exceeds the playback staging limit|Too many media redirects|Media redirect lacked a destination|Media redirect to a private host was refused|empty audio|quality is unavailable/.test(error?.message || '')
        ? error.message : 'Could not retrieve the requested HTTP spatial rendition')
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

module.exports = { selectedHttpSpatial, stageHttpSpatialAudio }
