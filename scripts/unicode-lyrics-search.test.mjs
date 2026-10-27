import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  normalizeLyricsSearchText, validLyricsSearchQuery, searchLyricsEntries,
  buildLyricsSnippet, tokenizeLyricsSearch,
} = require('../electron/lyrics/librarySearch')

const fixture = [
  { id: 'zh', title: 'Chinese', play_count: 9, lines: [{ text: '夜空中最亮的星，请照亮我前行' }] },
  { id: 'ja', title: 'Japanese', play_count: 8, lines: [{ text: '君の心には 光がある' }] },
  { id: 'hi', title: 'Hindi', play_count: 7, lines: [{ text: 'दिल से दिल तक यह गीत जाएगा' }] },
  { id: 'pa', title: 'Punjabi', play_count: 6, lines: [{ text: 'ਦਿਲ ਦੀ ਗੱਲ ਸੁਣ ਲੈ' }] },
  { id: 'latin', title: 'English', play_count: 5, lines: [{ text: 'Love, is all you need' }] },
  { id: 'ru', title: 'Cyrillic', play_count: 5, lines: [{ text: 'ПРИВЕТ МИР' }] },
  { id: 'accent', title: 'Accented', play_count: 3, lines: [{ text: 'ÉTÉ DANS LE SUD' }] },
  { id: 'mixed', title: 'Mixed', play_count: 4, lines: [{ words: [{ word: '東京' }, { word: 'の' }, { word: '夜' }] }] },
]

function libraryDb() {
  return {
    prepare(sql) {
      assert.match(sql, /FROM lyrics_cache lc/)
      assert.match(sql, /file_path NOT LIKE 'ghost:\/\//)
      return {
        all(...terms) {
          const literals = terms.map(term => term.slice(1, -1).replace(/\\([%_\\])/g, '$1'))
          return fixture
            .map(f => ({
              id: f.id, title: f.title, play_count: f.play_count,
              file_path: '/music/' + f.id + '.flac',
              content: JSON.stringify(f.lines),
            }))
            .filter(row => literals.some(literal => row.content.replace(/[A-Z]/g, ch => ch.toLowerCase()).includes(literal)))
        },
      }
    },
  }
}

test('preserves CJK, Devanagari and Gurmukhi codepoints and combining marks', () => {
  for (const [query, expected] of [
    ['最亮', 'zh'], ['心に', 'ja'], ['दिल', 'hi'], ['ਦਿਲ', 'pa'],
    ['東京', 'mixed'], ['LOVE', 'latin'], ['привет', 'ru'], ['été', 'accent'],
  ]) {
    assert.deepEqual(searchLyricsEntries(libraryDb(), query).map(r => r.id), [expected], query)
  }
})

test('two-character CJK searches work while one-character noise is rejected', () => {
  assert.equal(validLyricsSearchQuery('日本'), true)
  assert.equal(validLyricsSearchQuery('君の'), true)
  assert.equal(validLyricsSearchQuery('दि'), true)
  assert.equal(validLyricsSearchQuery('ਨੂੰ'), true)
  assert.equal(validLyricsSearchQuery('日'), false)
  assert.equal(validLyricsSearchQuery('ab'), false)
  assert.equal(validLyricsSearchQuery(' '), false)
  assert.equal(validLyricsSearchQuery('%__'), false)
})

test('Unicode normalization and punctuation do not throw away lyrics', () => {
  assert.equal(normalizeLyricsSearchText('ＡＢＣ， ＤＥＦ'), 'abc def')
  assert.equal(normalizeLyricsSearchText('दिल, से! दिल'), 'दिल से दिल')
  assert.equal(normalizeLyricsSearchText('ਪੰਜਾਬੀ ਕਵਿਤਾ'), 'ਪੰਜਾਬੀ ਕਵਿਤਾ')
  assert.deepEqual(tokenizeLyricsSearch('光… 心'), ['光', '心'])
})

test('returns a matching original-script snippet rather than Latin-only fallback', () => {
  const line = '早上 好 世界，再见'
  const snippet = buildLyricsSnippet([{ text: 'unrelated' }, { text: line }], '再见')
  assert.match(snippet, /再见/u)
  assert.ok(snippet.includes('世界'))
  assert.equal(buildLyricsSnippet([{ words: [{ word: 'दिल' }, { word: 'से' }] }], 'से'), 'दिल से')
})

test('nonmatching lyrics do not enter results even if raw JSON prefilter matches metadata', () => {
  const db = { prepare: () => ({ all: () => [{
    id: 'fake', title: 'fake', play_count: 1,
    content: JSON.stringify([{ text: 'other lyrics' }, { label: '日本' }]),
  }] }) }
  assert.deepEqual(searchLyricsEntries(db, '日本'), [])
})
