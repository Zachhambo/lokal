// Shared desktop + web local-library lyric-line search.
// SQLite's ASCII-oriented LOWER is only a candidate prefilter; actual lyric
// matching and relevance scoring use Unicode-aware JavaScript normalization.
const MAX_QUERY_LENGTH = 160
const RESULT_LIMIT = 24
const SQL_CANDIDATE_LIMIT = 120

function normalizeLyricsSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function tokenizeLyricsSearch(value) {
  return normalizeLyricsSearchText(value).split(' ').filter(Boolean)
}

function validLyricsSearchQuery(value) {
  const source = String(value ?? '').trim()
  if (!source || source.length > MAX_QUERY_LENGTH) return false
  const normalized = normalizeLyricsSearchText(source)
  const nonWhitespace = [...normalized].filter(ch => !/\s/u.test(ch))
  if (!nonWhitespace.some(ch => /[\p{L}\p{N}]/u.test(ch))) return false
  // Chinese/Japanese/Indic lyric fragments are often only 2 codepoints;
  // Latin/numeric searches retain the previous >=3 character minimum.
  return nonWhitespace.length >= (/[^\x00-\x7f]/u.test(normalized) ? 2 : 3)
}

function lineToSearchText(line) {
  if (!line) return ''
  if (typeof line.text === 'string' && line.text.trim()) return line.text.trim()
  if (Array.isArray(line.words) && line.words.length) {
    return line.words.map((word, index) => {
      const value = String(word?.word || '')
      if (index === 0) return value
      const previous = String(line.words[index - 1]?.word || '')
      return previous.endsWith('-') ? value : ' ' + value
    }).join('').trim()
  }
  return ''
}

function countLyricTokenMatches(text, tokens) {
  if (!tokens.length) return 0
  const normalized = normalizeLyricsSearchText(text)
  let matches = 0
  for (const token of tokens) if (normalized.includes(token)) matches++
  return matches
}

function buildLyricsSnippet(lines, query) {
  const tokens = tokenizeLyricsSearch(query)
  if (!tokens.length) return ''
  const texts = (Array.isArray(lines) ? lines : []).map(lineToSearchText).filter(Boolean)
  const ranked = texts.map(text => ({ text, score: countLyricTokenMatches(text, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
  const match = ranked[0]?.text
  if (!match) return texts[0] || ''
  const normalized = normalizeLyricsSearchText(match)
  const token = tokens.find(t => normalized.includes(t)) || tokens[0]
  const lower = match.toLowerCase()
  // For non-Latin and normalized text, avoid byte offsets that split surrogate
  // pairs. Prefer the first literal hit; otherwise show the matching lyric line.
  const literalOffset = lower.indexOf(token)
  const characters = Array.from(match)
  const start = literalOffset < 0 ? 0 : Array.from(match.slice(0, literalOffset)).length
  const from = Math.max(0, start - 36)
  const to = Math.min(characters.length, start + Array.from(token).length + 36)
  return (from ? '…' : '') + characters.slice(from, to).join('').trim() +
    (to < characters.length ? '…' : '')
}

/** Search cached local lyrics only; remote providers are not queried. */
function searchLyricsEntries(db, query) {
  if (!validLyricsSearchQuery(query)) return []
  const tokens = tokenizeLyricsSearch(query)
  if (!tokens.length) return []
  // SQLite LIKE matches literal Chinese/Japanese/Indic characters, but its
  // LOWER() only case-folds ASCII. Do not use ASCII-only text cleanup here.
  const first = tokens[0]
  const variants = new Set([first])
  if (/[^\x00-\x7f]/u.test(first)) {
    // SQLite LOWER() only handles ASCII. Include common Unicode case forms
    // when looking up Cyrillic, Greek and other cased scripts.
    variants.add(first.toUpperCase())
    const parts = [...first]
    parts[0] = parts[0].toUpperCase()
    variants.add(parts.join(''))
    // Also cover original full-width spellings before NFKC folding.
    const raw = String(query).trim().split(/\s+/u)[0]
    if (raw.length <= MAX_QUERY_LENGTH) variants.add(raw)
  }
  const patterns = [...new Set([...variants].filter(Boolean)
    // SQLite LOWER() folds ASCII only, even inside Unicode words: e.g.
    // ÉTÉ becomes ÉtÉ, not été. Mirror that behavior in the LIKE patterns.
    .map(term => term.replace(/[A-Z]/g, ch => ch.toLowerCase())))]
    .map(term => '%' + term.replace(/[%_\\]/g, ch => '\\' + ch) + '%')
  const candidateSql = patterns.map(() => "LOWER(lc.content) LIKE ? ESCAPE '\\'").join(' OR ')
  const rows = db.prepare([
    'SELECT t.*, lc.content',
    'FROM lyrics_cache lc',
    'JOIN tracks t ON t.id = lc.track_id',
    "WHERE t.file_path NOT LIKE 'ghost://%'",
    'AND (' + candidateSql + ')',
    'ORDER BY t.play_count DESC, t.title',
    'LIMIT ' + SQL_CANDIDATE_LIMIT,
  ].join('\n')).all(...patterns)

  return rows.map(row => {
    let lines = []
    try { lines = JSON.parse(row.content || '[]') } catch {}
    const content = (Array.isArray(lines) ? lines : []).map(lineToSearchText).join(' ')
    return {
      ...row,
      matchedTokens: countLyricTokenMatches(content, tokens),
      lyricSnippet: buildLyricsSnippet(lines, query),
    }
  }).filter(row => row.lyricSnippet &&
    row.matchedTokens >= Math.max(1, Math.ceil(tokens.length * 0.6)))
    .sort((a, b) => b.matchedTokens - a.matchedTokens ||
      (b.play_count || 0) - (a.play_count || 0))
    .slice(0, RESULT_LIMIT)
}

module.exports = {
  normalizeLyricsSearchText, tokenizeLyricsSearch, validLyricsSearchQuery,
  lineToSearchText, countLyricTokenMatches, buildLyricsSnippet, searchLyricsEntries,
}
