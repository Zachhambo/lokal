import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { resolveStationSong } = await import('../src/radio/stationSong.js')

const station = (over = {}) => ({ song_key: 'nova:a:b', artist: 'Artist', title: 'Title', ...over })

test('the playing radio song is looked up online once, by artist and title', async () => {
  const asked = []
  const resolve = async rows => { asked.push(rows); return [{ id: 'yt:1', title: 'Title', artist: 'Artist' }] }
  const first = await resolveStationSong(station(), {}, resolve)
  const again = await resolveStationSong(station(), {}, resolve)
  assert.equal(first.id, 'yt:1')
  assert.equal(again.id, 'yt:1')
  assert.deepEqual(asked, [[{ title: 'Title', artist: 'Artist' }]], 'asked once')
})

test('a song that can not be found is asked for again next time', async () => {
  let calls = 0
  const resolve = async () => { calls++; return [] }
  assert.equal(await resolveStationSong(station({ song_key: 'nova:x:y' }), {}, resolve), null)
  await new Promise(r => setTimeout(r, 5))
  await resolveStationSong(station({ song_key: 'nova:x:y' }), {}, resolve)
  assert.equal(calls, 2)
})

test('a station with no named song resolves to nothing', async () => {
  assert.equal(await resolveStationSong({ title: 'Station' }, {}, async () => [{ id: 'x' }]), null)
})

function radioClient(overrides = {}) {
  const provider = 'a-0123456789'
  return {
    getSettings: async () => ({}),
    onlineProviders: async () => [{ id: provider, package: true }],
    searchTracks: async () => [],
    onlineSearch: async () => ({ results: [{ id: 'song', title: 'Title', artist: 'Artist' }] }),
    onlineSave: async items => items.map(item => ({ ...item, id: 'saved-song', file_path: 'ghost://addon/0123456789/song' })),
    ...overrides,
  }
}

function captureVerification(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events = []
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event)
      // Settle a regressed interactive lookup instead of hanging the test.
      event.detail?.cancel?.()
      return true
    },
  }
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
  return events
}

test('automatic radio song lookup saves metadata without preparing addon audio or prompting', async t => {
  const events = captureVerification(t)
  let prepares = 0
  const client = radioClient({
    onlinePrepare: async () => { prepares++; return { error: 'VERIFY_REQUIRED' } },
  })
  const track = await resolveStationSong(station({ song_key: 'nova:metadata-only' }), client)
  assert.equal(prepares, 0, 'the station already supplies the audio')
  assert.equal(events.length, 0, 'background lookup must not open verification')
  assert.equal(track?.id, 'saved-song', 'Like and Save still get the matched song')
})

test('radio lookup returns quietly and can retry when saving metadata needs verification', async t => {
  const events = captureVerification(t)
  let saves = 0
  const client = radioClient({
    onlinePrepare: async () => ({ ok: true }),
    onlineSave: async () => { saves++; return { error: 'VERIFY_REQUIRED' } },
  })
  const target = station({ song_key: 'nova:save-needs-verification' })
  assert.equal(await resolveStationSong(target, client), null)
  assert.equal(events.length, 0, 'verification failures must not create an interactive retry')
  await resolveStationSong(target, client)
  assert.equal(saves, 2, 'failed background lookups must not stay cached')
})
