// The same fallback artist image shown in Online Search must be reusable from
// followed-artist cards and details. Search often gets an iTunes/Apple artist
// without any image, so it uses the exact-display-name Deezer artist portrait.
// This lookup is metadata-only; it does not pick playback sources or IDs.
import { api } from './api'

const normalize = value => String(value || '').normalize('NFKC')
  .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const portraitCache = new Map()
const MAX_CACHE = 150
const TTL = 15 * 60_000

export function peekSearchArtistPortrait(name) {
  const entry = portraitCache.get(normalize(name))
  return entry && entry.expires > Date.now() ? entry.image || '' : ''
}

export function resolveSearchArtistPortrait(name) {
  const key = normalize(name)
  if (!key) return Promise.resolve('')
  const existing = portraitCache.get(key)
  if (existing && existing.expires > Date.now()) return existing.promise
  // Keep the API and artist matching exactly the same as Global Search's
  // original portrait resolution. The promise is shared across views.
  const entry = { image: '', expires: Date.now() + TTL, promise: null }
  entry.promise = Promise.resolve().then(async () => {
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(() => api.artistSearchMetadata(name, { source: 'deezer' })),
        new Promise(resolve => { timer = setTimeout(() => resolve([]), 8000) }),
      ])
    } finally { clearTimeout(timer) }
  }).then(rows => {
      const row = Array.isArray(rows) ? rows.find(row => normalize(row?.title) === key) : null
      const image = String(row?.imageUrl || '')
      entry.image = /^https:\/\//.test(image) ? image : ''
      return entry.image
    }).catch(() => '')
  portraitCache.set(key, entry)
  while (portraitCache.size > MAX_CACHE) portraitCache.delete(portraitCache.keys().next().value)
  return entry.promise
}
