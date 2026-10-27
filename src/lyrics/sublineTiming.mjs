// Project a singer's real timed units onto a translated or romanized line.
// This is a visual synchronization, not a claim that the translation has
// provider-supplied syllable timestamps. Preserve native subline timings first.
const count = text => Array.from(String(text || '')).length

export function projectSublineUnits(source, sub) {
  if (!sub || typeof sub !== 'object' || !sub.text || !source?.words?.length) return sub
  if (sub.words?.length) return sub
  const units = source.words.filter(u => u && Number.isFinite(u.time) &&
    Number.isFinite(u.end) && u.end >= u.time && count(u.word) > 0)
  if (!units.length) return sub
  const sourceChars = units.reduce((n, u) => n + count(u.word), 0)
  if (!sourceChars) return sub

  // Each source syllable/word owns its exact time window, including holds.
  // Gaps between units do not get falsely painted as additional singing.
  const timeAt = fraction => {
    let remaining = Math.min(1, Math.max(0, fraction)) * sourceChars
    for (const u of units) {
      const len = count(u.word)
      if (remaining <= len) return u.time + (u.end - u.time) * (remaining / len)
      remaining -= len
    }
    return units[units.length - 1].end
  }

  // Latin translations are divided into words; whitespace-free CJK
  // romanizations/translations split into Unicode code points instead.
  const text = sub.text.trim()
  if (!text) return sub
  const parts = /\s/u.test(text)
    ? text.match(/\S+\s*/gu) || []
    : Array.from(text)
  const total = parts.reduce((n, item) => n + count(item.trim()), 0)
  if (!total) return sub
  let elapsedChars = 0
  const words = parts.map(part => {
    const word = part.trim()
    const start = timeAt(elapsedChars / total)
    elapsedChars += count(word)
    const end = timeAt(elapsedChars / total)
    return { word, time: start, end: Math.max(start, end), space: /\s$/u.test(part) }
  }).filter(u => u.word)
  return words.length ? { ...sub, words } : sub
}
