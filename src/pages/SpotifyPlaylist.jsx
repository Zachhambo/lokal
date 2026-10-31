import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ListMusic, Play, RefreshCw } from 'lucide-react'
import { api } from '../api'
import TrackList from '../components/TrackList'
import { playRecommendationPool } from '../recommendationPlayback'
import { resolveRecommendationTracks } from '../recommendations'
import { showLoadingToast } from '../components/Toaster'

/** A read-only view of the saved Spotify playlist, resolved using Lokal's
 * configured local and online playback sources, not Spotify audio streams. */
export default function SpotifyPlaylist() {
  const { id } = useParams()
  const [playlist, setPlaylist] = useState({ title: '', tracks: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const valid = /^[A-Za-z0-9]{22}$/.test(id || '')

  useEffect(() => {
    if (!valid) { setError('Invalid Spotify playlist.'); setLoading(false); return }
    let active = true
    setLoading(true)
    setError('')
    // Force the IPC cache on explicit refresh only.
    api.spotifyLibraryPlaylistTracks(`spotify:playlist:${id}`, revision > 0).then(result => {
      if (!active) return
      if (result?.error) { setError(result.error); setPlaylist({ title: '', tracks: [] }) }
      else setPlaylist({
        title: result?.title || 'Spotify playlist',
        tracks: (result?.tracks || []).map((row, i) => ({
          ...row, id: row.spotifyUri || `spotify-row:${id}:${i}`,
        })),
      })
    }).catch(err => { if (active) setError(err.message || 'Could not load this playlist.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, revision, valid])

  const context = { type: 'discovery', name: playlist.title || 'Spotify playlist' }
  const playAll = async () => {
    if (!playlist.tracks.length) return
    const toast = showLoadingToast('Preparing Spotify playlist…')
    try {
      const started = await playRecommendationPool(playlist.tracks, {
        firstPlayable: true, context, returnAfterStart: true,
        onProgress: message => toast.update(message),
      })
      toast.close(started === false ? 'No playable matches were found.' : '')
    } catch (err) { toast.close(err.message || 'Could not start this playlist.') }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <ListMusic size={28} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-xs font-display uppercase tracking-widest text-muted">Spotify playlist</p>
            <h1 className="truncate text-2xl font-semibold text-white">{playlist.title || 'Spotify playlist'}</h1>
            {!loading && !error && <p className="text-xs text-muted">{playlist.tracks.length} songs available in this view · Played through Lokal sources</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={loading} onClick={() => setRevision(n => n + 1)}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-white disabled:opacity-50"
            aria-label="Refresh Spotify playlist" title="Refresh"><RefreshCw size={17} /></button>
          <button type="button" disabled={loading || !playlist.tracks.length} onClick={playAll}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-base disabled:opacity-50">
            <Play size={15} fill="currentColor" /> Play all
          </button>
        </div>
      </div>
      {loading ? <p className="py-10 text-center text-sm text-muted">Loading Spotify playlist…</p>
        : error ? <p className="py-10 text-center text-sm text-muted" role="alert">{error}</p>
        : playlist.tracks.length
          ? <TrackList tracks={playlist.tracks} resolveTracks={(rows, options) => resolveRecommendationTracks(rows, api, options)} context={context} reduceMotion />
          : <p className="py-10 text-center text-sm text-muted">This playlist has no available songs.</p>}
    </div>
  )
}
