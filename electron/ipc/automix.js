// AutoMix's analyses for the window (electron/automix): a song's, by its
// library file or its online stream, analysed once and kept.

/**
 * Analyze each revision of a local recording independently. An ID-only key
 * reuses the previous waveform after a user overwrites/retags the same path.
 * Include the actual file stamp and CUE offsets so stale results cannot
 * silently drive transition timing or library tempo.
 */
function automixFileCacheKey(track, stat) {
  if (!track?.id || !stat || !Number.isFinite(stat.size) ||
      !Number.isFinite(stat.mtimeMs)) return null
  return [
    'file-v2', String(track.id), Math.round(stat.size),
    Math.round(stat.mtimeMs),
    Number(track.start_offset_ms ?? track.startOffsetMs ?? 0),
    Number(track.end_offset_ms ?? track.endOffsetMs ?? 0),
  ].join(':')
}

function registerAutomixHandlers(ipcMain) {
  const fs = require('fs')
  const { getDB } = require('./db')
  const { analysisFor } = require('../automix')
  const { readAdvancedReport, mergeAdvancedAnalysis } = require('../automix/advanced-report')
  const log = message => { try { require('electron-log').info(message) } catch {} }

  ipcMain.handle('automix:analyze', async (_, track) => {
    if (!track?.id) return null
    const db = getDB()
    const sources = require('../online/sources')
    const ref = sources.streamRef(track)
    if (ref) {
      return analysisFor({
        db, key: `${ref.provider}:${ref.id}`, log,
        ffmpeg: () => require('./tools').findFfmpeg(),
        source: async () => {
          const stream = await sources.resolveStream(ref.provider, ref.id, require('./online').streamOptions())
          return stream?.file ? { file: stream.file } : stream?.url ? { url: stream.url, headers: stream.headers } : null
        },
      })
    }
    const file = String(track.file_path || '')
    if (!file || file.startsWith('ghost://')) return null
    let stat
    try { stat = fs.statSync(file) } catch { return null }
    if (!stat.isFile()) return null
    const key = automixFileCacheKey(track, stat)
    if (!key) return null
    const base = await analysisFor({
      db, key, trackId: String(track.id), log,
      ffmpeg: () => require('./tools').findFfmpeg(),
      source: async () => {
        // Source may be replaced between cache lookup and ffmpeg decode.
        // Discard this attempt rather than cache the new bytes under an old
        // revision key.
        try {
          const current = fs.statSync(file)
          return current.isFile() && automixFileCacheKey(track, current) === key
            ? { file } : null
        } catch { return null }
      },
    })
    if (!base) return null
    // Read a sidecar only when its current source stamp still agrees with
    // the exact file revision used for the baseline waveform cache.
    // Changes to the report do not force PCM decoding.
    try {
      const current = fs.statSync(file)
      if (automixFileCacheKey(track, current) !== key) return null
      return mergeAdvancedAnalysis(base, readAdvancedReport(file, current))
    } catch { return base }
  })
}

module.exports = { registerAutomixHandlers, automixFileCacheKey }
