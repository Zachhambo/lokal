// Persistent, account-scoped Spotify playlist metadata cache. Never store an
// sp_dc cookie or bearer; the key is a SHA-256 fingerprint of the cookie.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const AUTO_UPDATE_MS = 24 * 60 * 60 * 1000
const FAILURE_RETRY_MS = 60 * 60 * 1000
const VERSION = 1

function createSpotifyPlaylistCache(file, { now = Date.now } = {}) {
  let state
  const load = () => {
    if (state) return state
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved?.version === VERSION && typeof saved.account === 'string' && saved.entries && typeof saved.entries === 'object') {
        state = saved
        return state
      }
    } catch {}
    return (state = { version: VERSION, account: '', entries: {} })
  }
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      fs.writeFileSync(temp, JSON.stringify(load()), { mode: 0o600 })
      fs.renameSync(temp, file)
    } catch {
      // In-memory cache remains useful if the profile directory is read-only.
    }
  }
  const account = rawCookie => {
    const fingerprint = rawCookie ? crypto.createHash('sha256').update(rawCookie).digest('hex') : ''
    if (load().account !== fingerprint) {
      state = { version: VERSION, account: fingerprint, entries: {} }
      persist()
    }
    return fingerprint
  }
  const read = (cookie, key) => {
    if (!account(cookie)) return null
    const item = load().entries[key]
    if (!item || !Number.isFinite(item.at) || !item.value || typeof item.value !== 'object') return null
    return item
  }
  const save = (cookie, key, value) => {
    if (!account(cookie)) return
    load().entries[key] = { value, at: now(), retryAfter: 0 }
    persist()
  }
  const failed = (cookie, key) => {
    const hit = read(cookie, key)
    if (!hit) return
    hit.retryAfter = now() + FAILURE_RETRY_MS
    persist()
  }
  const due = (cookie, key, enabled) => {
    if (!enabled) return false
    const hit = read(cookie, key)
    return !!hit && now() - hit.at >= AUTO_UPDATE_MS && now() >= (hit.retryAfter || 0)
  }
  return { read, save, failed, due }
}

module.exports = { createSpotifyPlaylistCache, AUTO_UPDATE_MS, FAILURE_RETRY_MS }
