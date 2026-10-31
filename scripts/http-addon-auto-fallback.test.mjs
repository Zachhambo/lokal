import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOMATIC_HTTP_BUDGET_MS,
  automaticHttpAddonHealth,
  createHttpAddonHealth,
  isHttpAddonSource,
} from '../src/onlineAddonHealth.mjs'
import {
  playbackAvailability, searchHttpAddonWithinBudget,
  resolveRecommendationTracks,
} from '../src/recommendations.js'

const first = { id: 'a-0123456789', label: 'First HTTP', addon: true, package: false }
const second = { id: 'a-abcdef0123', label: 'Second HTTP', addon: true, package: false }
const native = { id: 'a-bbbb222222', label: 'Morneye', addon: true, package: true }
const candidate = { title: 'Track', artist: 'Artist' }
const match = (provider) => ({ ...candidate, id: 'stream-1', provider })
const ghost = (item) => ({
  ...item, id: 'saved', file_path: 'ghost://addon/abcdef0123/stream-1',
})

test('Morneye packages retain their long preparation window, HTTP does not', () => {
  assert.equal(isHttpAddonSource(first), true)
  assert.equal(isHttpAddonSource(native), false)
  assert.equal(isHttpAddonSource({ id: 'yt' }), false)
  assert.equal(AUTOMATIC_HTTP_BUDGET_MS, 3000)
})

test('automatic HTTP lookup has one deadline across all alternate queries', async () => {
  const attempted = []
  const client = { onlineSearch: (query) => {
    attempted.push(query)
    return new Promise(() => {})
  } }
  await assert.rejects(
    searchHttpAddonWithinBudget(first, candidate, client, { budgetMs: 12 }),
    /HTTP addon lookup timed out/,
  )
  assert.deepEqual(attempted, ['Artist Track'])
})

test('one temporary HTTP failure does not turn off manual or Morneye playback', () => {
  let clock = 1000
  const health = createHttpAddonHealth({ now: () => clock, cooldownMs: 45000 })
  health.failed(first, 'HTTP 502')
  assert.equal(health.shouldSkip(first, [first, second]), true)
  assert.equal(health.shouldSkip(native, [first, native]), false)
  health.failed(second, 'The addon took too long to answer.')
  assert.equal(health.shouldSkip(first, [first, second]), false, 'probe first source if both are down')
  assert.equal(health.shouldSkip(second, [first, second]), true)
  clock += 45001
  assert.equal(health.shouldSkip(first, [first, second]), false)
  health.failed(first, 'HTTP 503')
  health.succeeded(first)
  assert.equal(health.shouldSkip(first, [first, second]), false)
  health.failed(first, 'HTTP 403')
  assert.equal(health.shouldSkip(first, [first, second]), false, 'authentication errors require action, not cooldown')
})

test('HTTP add-on preparation uses the short deadline, not 15 minutes', async () => {
  const signals = []
  const client = { onlinePrepare: (_provider, _id, _force, options) => {
    signals.push(options.signal)
    return new Promise(() => {})
  } }
  const errors = []
  const unavailable = await playbackAvailability(
    match(first.id), first.id, client, 12,
    error => errors.push(error), () => {}, { packageAddon: false },
  )
  assert.equal(unavailable, 'unavailable')
  assert.match(String(errors[0]), /timed out/)
  assert.equal(signals[0].aborted, true)
})

test('a broken first HTTP add-on falls back and is bypassed on the next track', async () => {
  automaticHttpAddonHealth.reset()
  const counts = new Map()
  const client = {
    onlineSearch: async (_query, provider) => {
      counts.set(provider, (counts.get(provider) || 0) + 1)
      return provider === first.id
        ? { error: 'The addon answered with an error (HTTP 502).' }
        : { results: [match(provider)] }
    },
    onlinePrepare: async () => ({ ok: true }),
    onlineSave: async entries => entries.map(ghost),
    searchTracks: async () => [],
  }
  try {
    const options = { searchLocal: false, sources: [first, second], prepareTimeoutMs: 500 }
    const one = await resolveRecommendationTracks([candidate], client, options)
    assert.equal(one.length, 1)
    assert.equal(counts.get(first.id), 1)
    assert.equal(counts.get(second.id), 1)
    const two = await resolveRecommendationTracks([{ title: 'Track', artist: 'Artist', album: 'Other' }], client, options)
    assert.equal(two.length, 1)
    assert.equal(counts.get(first.id), 1, 'unhealthy source skipped during automatic fallback')
    assert.equal(counts.get(second.id), 2)
  } finally { automaticHttpAddonHealth.reset() }
})

test('manual/only-source lookup keeps normal behavior and can recover a failed add-on', async () => {
  automaticHttpAddonHealth.reset()
  automaticHttpAddonHealth.failed(first, 'HTTP 502')
  const calls = []
  const client = {
    onlineSearch: async (_q, provider) => { calls.push(provider); return { results: [match(provider)] } },
    onlinePrepare: async () => ({ ok: true }),
    onlineSave: async entries => entries.map(ghost),
    searchTracks: async () => [],
  }
  try {
    const result = await resolveRecommendationTracks([candidate], client, {
      searchLocal: false, sources: [first], timeoutMs: 400,
    })
    assert.equal(result.length, 1)
    assert.deepEqual(calls, [first.id], 'the only source is not disabled by its cooldown')
  } finally { automaticHttpAddonHealth.reset() }
})
