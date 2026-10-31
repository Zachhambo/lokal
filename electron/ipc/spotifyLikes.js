// Likes kept in step with Spotify, both ways, from the moment it's turned on
// (Settings → Integrations → Spotify → Sync likes):
//
//   Lokal → Spotify  a song liked in Lokal is found on Spotify and saved to
//                    Liked Songs (src/api.js toggleLike, next to the YouTube
//                    Music and Last.fm mirrors).
//   Spotify → Lokal  songs liked on Spotify *after* sync was turned on are
//                    read now and then (newest first, stopping at the first
//                    one already seen) and liked in Lokal (src/spotifyLikes.js
//                    finds them in the library or online).
//
// Likes from before are never read: turning it on only notes the newest
// Spotify like as where to start. A library of 20,000 likes costs one small
// request per look. Unlikes aren't mirrored either way.
//
// Settings: spotify_likes_sync '1' | '', spotify_likes_since (ms, the newest
// like already handled: moved on by spotifyLikes:ack once the window has liked
// them here), spotify_likes_user (the Lokal user they're for).

const PUSHED_KEEP_MS = 30 * 60 * 1000 // Lokal's own likes, not brought back when Spotify lists them

function registerSpotifyLikesHandlers(ipcMain) {
  const { getDB } = require('./db')
  const spotify = require('../artwork/spotify')
  const log = message => { try { require('electron-log').info(message) } catch {} }
  const settings = () => { try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value])) } catch { return {} } }
  const save = (key, value) => { try { getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value)) } catch {} }
  const pushed = new Map() // spotify uri -> when Lokal liked it there
  let polling = null

  const status = () => {
    const all = settings()
    return { enabled: all.spotify_likes_sync === '1', since: Number(all.spotify_likes_since) || null, userId: all.spotify_likes_user || null, hasCookie: !!spotify.cookieValue(all.spotify_sp_dc) }
  }

  ipcMain.handle('spotifyLikes:status', () => status())

  // Turned on: the newest Spotify like becomes the starting point (nothing older is ever read).
  ipcMain.handle('spotifyLikes:enable', async (_, userId) => {
    try {
      const { newest } = await spotify.likedSince(settings().spotify_sp_dc, null)
      save('spotify_likes_since', newest || Date.now())
      save('spotify_likes_user', userId || 'guest')
      save('spotify_likes_sync', '1')
      log(`spotify likes: sync on, from ${new Date(newest || Date.now()).toISOString()}`)
      return status()
    } catch (error) {
      return { ...status(), error: error.message }
    }
  })

  ipcMain.handle('spotifyLikes:disable', () => { save('spotify_likes_sync', ''); return status() })

  // Songs liked on Spotify since the last look, oldest first, for the window to
  // like in Lokal. Where to look from next moves on only when the window says
  // it has them (spotifyLikes:ack): one it couldn't like yet comes back.
  ipcMain.handle('spotifyLikes:poll', async () => {
    const now = status()
    if (!now.enabled || !now.since) return { items: [] }
    if (polling) return polling
    polling = (async () => {
      try {
        const { items, newest } = await spotify.likedSince(settings().spotify_sp_dc, now.since)
        // Turned off, or on again for someone else, meanwhile: this look is theirs no more.
        const after = status()
        if (!after.enabled || after.userId !== now.userId || after.since !== now.since) return { items: [] }
        const cutoff = Date.now() - PUSHED_KEEP_MS
        for (const [uri, at] of pushed) if (at < cutoff) pushed.delete(uri)
        const fresh = items.filter(item => !pushed.has(item.uri)).reverse()
        // Nothing for the window (or only Lokal's own likes): the look is done here.
        if (!fresh.length) { if (newest > now.since) save('spotify_likes_since', newest); return { items: [] } }
        log(`spotify likes: ${fresh.length} new on Spotify`)
        return { items: fresh, userId: now.userId, since: now.since, newest }
      } catch (error) {
        return { items: [], error: error.message }
      } finally {
        polling = null
      }
    })()
    return polling
  })

  // The window has liked (or given up on) Spotify's likes up to `through` (ms).
  ipcMain.handle('spotifyLikes:ack', (_, { userId, since, through } = {}) => {
    const now = status()
    if (!now.enabled || now.userId !== userId || now.since !== since || !(Number(through) > now.since)) return status()
    save('spotify_likes_since', Number(through))
    return status()
  })

  // Discovery's Spotify source: the Made For You mixes and their songs. Spotify
  // remakes them weekly (Discover Weekly on Monday, Release Radar on Friday)
  // and Daily Mixes daily, so a look is kept 12 hours unless refreshed.
  const DISCOVERY_KEEP_MS = 12 * 60 * 60 * 1000
  const cache = new Map() // `${cookie}\0${key}` -> { at, value }
  const cached = async (key, force, load) => {
    const id = `${spotify.cookieValue(settings().spotify_sp_dc)}\0${key}`
    const hit = cache.get(id)
    if (!force && hit && Date.now() - hit.at < DISCOVERY_KEEP_MS) return hit.value
    const value = await load()
    cache.set(id, { at: Date.now(), value })
    return value
  }
  ipcMain.handle('spotify:madeForYou', async (_, force) => {
    try { return { mixes: await cached('home', !!force, () => spotify.madeForYou(settings().spotify_sp_dc)) } }
    catch (error) { return { mixes: [], error: error.message } }
  })
  // Playlist metadata persists across launches, unlike rotating Discovery
  // mixes. Cached content is returned immediately even if an automatic update
  // is due; the renderer may refresh quietly after showing it.
  const { createSpotifyPlaylistCache } = require('./spotifyPlaylistCache')
  const spotifyPlaylistDisk = createSpotifyPlaylistCache(require('path').join(
    require('electron').app.getPath('userData'), 'spotify-playlists-v1.json'))
  const playlistRequests = new Map()
  const libraryResource = async (key, force, load, empty) => {
    const cookie = spotify.cookieValue(settings().spotify_sp_dc)
    if (!cookie) return { ...empty, error: 'Connect Spotify in Settings → Integrations first.' }
    const accountId = require('node:crypto').createHash('sha256').update(cookie).digest('hex')
    const hit = spotifyPlaylistDisk.read(cookie, key)
    const autoUpdate = settings().spotify_playlist_auto_update === '1'
    if (hit && !force) return { ...hit.value, accountId, lastUpdated: hit.at, autoUpdate,
      refreshDue: spotifyPlaylistDisk.due(cookie, key, autoUpdate) }
    const requestKey = `${cookie}\0${key}`
    if (playlistRequests.has(requestKey)) return playlistRequests.get(requestKey)
    const promise = (async () => {
      try {
        const value = await load(cookie)
        // Do not overwrite the new account's data with a late old-account request.
        if (spotify.cookieValue(settings().spotify_sp_dc) !== cookie) {
          return { ...empty, error: 'Spotify account changed. Refresh again.' }
        }
        spotifyPlaylistDisk.save(cookie, key, value)
        const saved = spotifyPlaylistDisk.read(cookie, key)
        return { ...value, accountId, lastUpdated: saved?.at || Date.now(), autoUpdate, refreshDue: false }
      } catch (error) {
        if (spotify.cookieValue(settings().spotify_sp_dc) === cookie)
          spotifyPlaylistDisk.failed(cookie, key)
        return hit
          ? { ...hit.value, accountId, lastUpdated: hit.at, autoUpdate, refreshDue: false,
              error: error.message || 'Could not refresh Spotify playlists.' }
          : { ...empty, accountId, error: error.message || 'Could not load Spotify playlists.' }
      }
    })().finally(() => playlistRequests.delete(requestKey))
    playlistRequests.set(requestKey, promise)
    return promise
  }
  ipcMain.handle('spotify:libraryPlaylists', async (_, force) => libraryResource(
    'libraryPlaylists', !!force,
    cookie => spotify.libraryPlaylists(cookie).then(playlists => ({ playlists })),
    { playlists: [] },
  ))
  // Explicit user-library browsing allows longer playlists without
  // increasing Home Discovery's 200-song mix limit.
  ipcMain.handle('spotify:libraryPlaylistTracks', async (_, uri, force) => {
    if (!/^spotify:playlist:[A-Za-z0-9]{22}$/.test(String(uri || '')))
      return { tracks: [], error: 'Invalid Spotify playlist.' }
    return libraryResource(
      `libraryPlaylist:${uri}`, !!force,
      cookie => spotify.playlistTracks(cookie, String(uri), { max: 1000 }),
      { tracks: [] },
    )
  })
  ipcMain.handle('spotify:playlist', async (_, uri, force) => {
    try { return await cached(`playlist:${uri}`, !!force, () => spotify.playlistTracks(settings().spotify_sp_dc, String(uri || ''))) }
    catch (error) { return { tracks: [], error: error.message } }
  })

  // Unlike mixes, recently played changes frequently. A failed optional
  // account-scope request is never treated as fabricated listening history.
  ipcMain.handle('spotify:recentlyPlayed', async (_, force) => {
    try {
      const cookie = spotify.cookieValue(settings().spotify_sp_dc)
      const key = `${cookie}\\0recentlyPlayed`
      const hit = cache.get(key)
      if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return { tracks: hit.value }
      const tracks = await spotify.recentlyPlayed(settings().spotify_sp_dc)
      cache.set(key, { at: Date.now(), value: tracks })
      return { tracks }
    } catch (error) { return { tracks: [], error: error.message } }
  })

  // A song liked in Lokal: liked on Spotify too.
  ipcMain.handle('spotifyLikes:push', async (_, track) => {
    const now = status()
    if (!now.enabled || !track?.title || !track?.artist) return { ok: false }
    // Another Lokal user's likes stay theirs.
    if (now.userId && track.userId && String(track.userId) !== String(now.userId)) return { ok: false }
    try {
      const uri = await spotify.likeOnSpotify(settings().spotify_sp_dc, { title: String(track.title), artist: String(track.artist), album: String(track.album || '') })
      if (!uri) return { ok: false, error: 'Not found on Spotify' }
      pushed.set(uri, Date.now())
      return { ok: true, uri }
    } catch (error) {
      log(`spotify likes: couldn't like "${track.title}" on Spotify: ${error.message}`)
      return { ok: false, error: error.message }
    }
  })
}

module.exports = { registerSpotifyLikesHandlers }
