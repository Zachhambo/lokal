// Portable lyrics file export. Normal LRC stays line-synced; true word
// timestamps are exported as enhanced LRC (.elrc), matching Mobile's
// per-word <mm:ss.xx> format rather than discarding them on save.
const { toPortableLyrics } = require('./embedded')

function timestamp(seconds) {
  if (!Number.isFinite(Number(seconds))) return null
  const cs = Math.max(0, Math.round(Number(seconds) * 100))
  const minutes = Math.floor(cs / 6000)
  const secs = Math.floor((cs % 6000) / 100)
  const centis = cs % 100
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

function toEnhancedLrc(result) {
  const lines = (result?.lines || []).filter(line => line?.time != null && !line.gap && (line.text || line.bgText))
  if (!lines.length || !lines.some(line => line.words?.length)) return null
  const sung = new Set(lines.map(line => timestamp(line.time)))
  const translated = new Set(lines.filter(line => line.translation?.text).map(line => timestamp(line.time)))
  const includeTranslations = sung.size && translated.size >= sung.size / 2
  const out = []
  for (const line of result.lines) {
    if (line.time == null) continue
    const time = timestamp(line.time)
    if (!time) continue
    if (line.gap) { out.push(`[${time}]`); continue }
    let body = ''
    const words = (line.words || []).filter(w => String(w?.word || '').trim() && Number.isFinite(Number(w.time)))
    if (words.length) {
      body = words.map(word => `<${timestamp(word.time)}>${word.word}${word.space ? ' ' : ''}`).join('')
      const finalEnd = Number(words.at(-1).end)
      if (Number.isFinite(finalEnd) && finalEnd > Number(words.at(-1).time)) {
        if (line.bgText) body += ` (${line.bgText})`
        body += `<${timestamp(finalEnd)}>`
      } else if (line.bgText) {
        body += ` (${line.bgText})`
      }
    } else {
      body = String(line.text || '')
      if (line.bgText) body += ` (${line.bgText})`
    }
    if (!body.trim()) continue
    out.push(`[${time}]${body}`)
    if (includeTranslations && line.translation?.text) out.push(String(line.translation.text).trim())
  }
  return out.length ? out.join('\n') + '\n' : null
}

function prepareLyricsExport(result) {
  if (!result?.lines?.some(line => String(line?.text || line?.bgText || '').trim())) {
    throw new Error('There are no lyrics to save.')
  }
  const enhanced = toEnhancedLrc(result)
  if (enhanced) return { extension: 'elrc', text: enhanced, format: 'enhanced-lrc' }
  const portable = toPortableLyrics(result)
  if (!portable) throw new Error('These lyrics cannot be exported.')
  const extension = result.sync === 'none' || result.type === 'unsynced' ? 'txt' : 'lrc'
  return { extension, text: portable + '\n', format: extension }
}

module.exports = { timestamp, toEnhancedLrc, prepareLyricsExport }
