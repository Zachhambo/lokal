import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { rolldown } from 'rolldown'
import { uniqueSongs, recommendationVideoId, resolveRecommendationTracks } from '../src/recommendations.js'

const require = createRequire(import.meta.url)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

// Exercise the real components with controlled hooks and provider requests.
async function componentFixture(file, api, params = {}) {
  const bundle = await rolldown({ input: file, external: () => true })
  const { output } = await bundle.generate({ format: 'cjs' })
  await bundle.close()
  const slots = [], effects = [], listeners = new Map()
  let cursor = 0, first = true
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const slot = cursor++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
    },
    useRef(initial) { const slot = cursor++; return slots[slot] ||= { current: initial } },
    useEffect(effect) { if (first) effects.push(effect) },
  }
  const modules = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props: { ...props, children: [props?.children] } }),
      jsxs: (type, props) => ({ type, props: { ...props, children: [props?.children] } }), Fragment: react.Fragment },
    'react-router-dom': { useNavigate: () => () => {}, useLocation: () => ({ pathname: '/' }), useParams: () => params },
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '../panelWidths.jsx': { usePanelWidths: () => false, usePanelWidth: () => 200, PanelResizeHandle: () => null },
    '../store/player': { useAppStore: () => ({}) },
    '../api': { api, peekSettings: () => ({}) },
    '../sidebarNav': { sidebarNavOrder: () => [], splitSidebarNav: () => ({ visible: [], hidden: [] }) },
    '../recapPeriods': { listenerTimeZone: () => 'UTC', nextPeriodBoundary: () => new Date(Date.now() + 10000), recapTree: () => [], latestPeriod: () => null },
    '../i18n': { useTranslation: () => ({ t: x => x }) },
  }
  const module = { exports: {} }
  const window = {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn) },
    dispatch(name) { for (const fn of listeners.get(name) || []) fn() },
  }
  const context = vm.createContext({ module, exports: module.exports, require: id => modules[id] || {}, window,
    document: { addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null }, setTimeout: () => 0, clearTimeout, console })
  vm.runInContext(output[0].code, context, { filename: file })
  const render = () => { cursor = 0; const tree = module.exports({}); first = false; return tree }
  const mount = () => effects.map(effect => effect()).filter(fn => typeof fn === 'function')
  return { render, mount, window }
}
function findNodes(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.props?.children || []) {
    if (Array.isArray(child)) child.forEach(item => findNodes(item, predicate, found))
    else findNodes(child, predicate, found)
  }
  return found
}

test('sidebar loading and manual refresh share the current request for both providers', async () => {
  const calls = { spotify: [], youtube: [] }
  const request = provider => force => { const call = deferred(); calls[provider].push({ ...call, force }); return call.promise }
  const api = { isElectron: true, spotifyLibraryPlaylists: request('spotify'), youtubeLibraryPlaylists: request('youtube'),
    getPlaylists: async () => [], getSettings: async () => ({}), getListeningDays: async () => ({ days: [] }) }
  const fixture = await componentFixture('src/components/Sidebar.jsx', api)
  const shelves = () => findNodes(fixture.render(), node => node.props?.provider && node.props?.refresh)
  assert.deepEqual(shelves().map(node => node.props.loading), [true, true])
  const cleanups = fixture.mount()
  for (const provider of ['spotify', 'youtube']) calls[provider][0].resolve({ accountId: 'old', playlists: [{ id: 'old' }] })
  await flush()
  assert.deepEqual(shelves().map(node => node.props.loading), [false, false])
  for (const shelf of shelves()) shelf.props.refresh()
  assert.deepEqual(shelves().map(node => node.props.loading), [true, true])
  fixture.window.dispatch('lokal:settings-saved')
  for (const provider of ['spotify', 'youtube']) calls[provider][1].resolve({ accountId: 'old', playlists: [{ id: 'stale' }], error: 'stale error' })
  await flush()
  assert.deepEqual(shelves().map(node => node.props.loading), [true, true])
  for (const provider of ['spotify', 'youtube']) calls[provider][2].resolve({ accountId: 'new', playlists: [{ id: 'new' }] })
  await flush()
  for (const shelf of shelves()) {
    assert.equal(shelf.props.accountId, 'new')
    assert.equal(shelf.props.playlists[0].id, 'new')
    assert.equal(shelf.props.error, '')
    assert.equal(shelf.props.loading, false)
  }
  for (const shelf of shelves()) shelf.props.refresh()
  fixture.window.dispatch('lokal:settings-saved')
  for (const provider of ['spotify', 'youtube']) calls[provider][3].reject(new Error('stale error'))
  await flush()
  assert.deepEqual(shelves().map(node => node.props.loading), [true, true])
  assert.deepEqual(shelves().map(node => node.props.error), ['', ''])
  for (const provider of ['spotify', 'youtube']) calls[provider][4].resolve({ accountId: 'new', playlists: [{ id: 'new' }] })
  await flush()
  cleanups.forEach(cleanup => cleanup())
})

test('web sidebar starts without provider loading', async () => {
  const api = { isElectron: false }
  const fixture = await componentFixture('src/components/Sidebar.jsx', api)
  // On the web provider shelves are not rendered; inspect the state via a desktop rerender.
  const tree = fixture.render()
  assert.equal(findNodes(tree, node => node.props?.provider && node.props?.refresh).length, 0)
  api.isElectron = true
  assert.deepEqual(findNodes(fixture.render(), node => node.props?.provider && node.props?.refresh).map(node => node.props.loading), [false, false])
})

test('Spotify row identities are distinct while playback matches by song', async () => {
  const rows = [
    { spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist', thumbnail: 'cover' },
    { spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist', thumbnail: 'cover' },
    { videoId: 'abcdefghijk', title: 'Other', author: 'Singer', thumbnail: 'other' },
    { id: 'fallback', title: 'Third', artist: 'Artist' },
    { title: 'Fourth', artist: 'Artist' },
  ]
  const fixture = await componentFixture('src/pages/SpotifyPlaylist.jsx', { spotifyLibraryPlaylistTracks: async () => ({ tracks: rows }) }, { id: 'A'.repeat(22) })
  fixture.render()
  fixture.mount()
  await flush()
  const trackList = findNodes(fixture.render(), node => node.props?.resolveTracks)[0]
  const tracks = trackList.props.tracks
  assert.equal(new Set(tracks.map(track => track.id)).size, rows.length)
  assert.ok(tracks[0].id.startsWith('spotify:track:a:'))
  assert.ok(tracks[2].id.startsWith('abcdefghijk:'))
  assert.ok(tracks[3].id.startsWith('fallback:'))
  assert.ok(tracks[4].id.startsWith('spotify-row:'))
  assert.equal(tracks[2].artist, 'Singer')
  assert.equal(tracks[0].artwork_url, 'cover')
  assert.equal(uniqueSongs(tracks).length, rows.length - 1)
  assert.equal(recommendationVideoId(tracks[2]), 'abcdefghijk')
  const searches = []
  const resolved = await resolveRecommendationTracks(tracks.slice(0, 2), { searchTracks: async title => { searches.push(title); return [{ id: 'local', title: 'Song', artist: 'Artist', file_path: '/song.mp3' }] } }, { sources: [] })
  assert.deepEqual(searches, ['Song'])
  assert.equal(resolved[0].id, 'local')
})

function ipcFixture(provider) {
  const filename = require.resolve(provider === 'spotify' ? '../electron/ipc/spotifyLikes.js' : '../electron/ipc/online.js')
  const localRequire = createRequire(filename)
  const handlers = new Map(), saved = [], failed = []
  let account = 'one', pending
  const cache = { read: () => ({ value: { playlists: [{ id: 'cached' }], tracks: [{ title: 'cached' }] }, at: 1 }),
    due: () => false, save: (...args) => saved.push(args), failed: (...args) => failed.push(args) }
  const db = { prepare: () => ({ all: () => [{ key: 'spotify_sp_dc', value: account }] }) }
  const spotify = { cookieValue: value => value || '', libraryPlaylists: () => pending.promise, playlistTracks: () => pending.promise }
  const youtube = { normalizeAccountCookies: value => value, accountHeaders: () => true,
    fetchLibraryPlaylists: () => pending.promise, fetchMusicPlaylist: () => pending.promise }
  const session = { credentials: async () => ({ cookies: account }) }
  const mocks = { './db': { getDB: () => db }, '../artwork/spotify': spotify, '../online/youtube': youtube,
    electron: { app: { getPath: () => '/tmp' } }, './spotifyPlaylistCache': { createSpotifyPlaylistCache: () => cache },
    '../online/youtubeSession': { createYouTubeSession: () => session }, '../online/youtubeFast': { setAccount() {} },
    '../online/sources': { pruneOnlineTracks() {}, addons: { refreshManifests: async () => {} } },
    '../discoveryArtwork': { createArtworkResolver: () => () => [] } }
  const module = { exports: {} }
  const context = vm.createContext({ module, exports: module.exports, require: id => mocks[id] || localRequire(id),
    console, process, Buffer, URL, setTimeout: () => ({ unref() {} }), clearTimeout })
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  const register = provider === 'spotify' ? module.exports.registerSpotifyLikesHandlers : module.exports.registerOnlineHandlers
  register({ handle: (name, fn) => handlers.set(name, fn) })
  return { handlers, saved, failed, setAccount: value => { account = value }, start: () => { pending = deferred(); return pending } }
}

for (const provider of ['spotify', 'youtube']) {
  for (const kind of ['playlists', 'tracks']) {
    test(`${provider} ${kind}: stale account failures do not return cached data`, async () => {
      const fixture = ipcFixture(provider)
      const event = provider === 'spotify' ? (kind === 'playlists' ? 'spotify:libraryPlaylists' : 'spotify:libraryPlaylistTracks')
        : (kind === 'playlists' ? 'online:libraryPlaylists' : 'online:libraryPlaylistTracks')
      const invoke = () => kind === 'playlists' ? fixture.handlers.get(event)(null, true)
        : fixture.handlers.get(event)(null, provider === 'spotify' ? `spotify:playlist:${'A'.repeat(22)}` : 'PLtest', true)
      let pending = fixture.start()
      let result = invoke()
      await flush()
      pending.reject(new Error('offline'))
      let response = await result
      assert.equal(response[kind][0][kind === 'playlists' ? 'id' : 'title'], 'cached')
      assert.equal(response.error, 'offline')
      assert.equal(fixture.failed.length, 1)
      pending = fixture.start()
      result = invoke()
      await flush()
      fixture.setAccount('two')
      pending.reject(new Error('offline'))
      response = await result
      assert.equal(response[kind].length, 0)
      assert.match(response.error, /account changed/i)
      assert.equal(fixture.failed.length, 1)
      assert.equal(fixture.saved.length, 0)
    })
  }
}
