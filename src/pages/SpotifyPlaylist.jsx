import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { Download, ListMusic, RefreshCw } from 'lucide-react'
import { api } from '../api'
import PlaylistCollection from '../components/PlaylistCollection'
import { showLoadingToast } from '../components/Toaster'
import { downloadMissingProviderTracks, ghostDownloadMessage } from '../ghostDownloads'
import { useTranslation } from '../i18n'
import { usePageReady } from '../pageCache'

/** Read-only provider playlist detail, resolved using Lokal's
 * configured local and online playback sources, not Spotify audio streams. */
export default function SpotifyPlaylist({ provider = 'spotify', discovery = false }) {
  const { id } = useParams()
  const location = useLocation()
  const { t } = useTranslation()
  const [playlist, setPlaylist] = useState({ title: '', tracks: [] })
  const [loading, setLoading] = useState(true)
  usePageReady(!loading)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const downloadingRef = useRef(false)
  const forceNext = useRef(false)
  const loadedKey = useRef('')
  const youtube = provider === 'youtube'
  const label = youtube ? 'YouTube Music' : 'Spotify'
  const valid = youtube ? /^[A-Za-z0-9_.-]{1,120}$/.test(id || '') : /^[A-Za-z0-9]{22}$/.test(id || '')

  useEffect(() => {
    const refresh = () => { setPlaylist({ title: '', tracks: [] }); setRevision(n => n + 1) }
    window.addEventListener('lokal:recommendation-access-changed', refresh)
    return () => window.removeEventListener('lokal:recommendation-access-changed', refresh)
  }, [])

  useEffect(() => {
    if (!valid) { setError(`Invalid ${label} playlist.`); setLoading(false); return }
    let active = true
    const key = `${provider}:${id}`
    if (loadedKey.current !== key) {
      setPlaylist({ title: '', tracks: [] })
      loadedKey.current = key
    }
    setLoading(true)
    setError('')
    const load = async (force = false) => {
      try {
        const uri = `spotify:playlist:${id}`
        const result = discovery
          ? await (youtube ? api.youtubeAccountPlaylist(id) : api.spotifyPlaylist(uri, force))
          : await (youtube ? api.youtubeLibraryPlaylistTracks(id, force) : api.spotifyLibraryPlaylistTracks(uri, force))
        if (!active) return
        if (Array.isArray(result?.tracks) && (!result.error || result.tracks.length)) setPlaylist({
          title: result.title || '',
          cover: result.thumbnail || '',
          total: result.total ?? result.count,
          tracks: result.tracks.map((row, i) => ({
            ...row, id: `${row.spotifyUri || row.videoId || row.id || `${provider}-row:${id}`}:${i}`,
            source: row.source || provider,
            artist: row.artist || row.author || '',
            artwork_url: row.artwork_url || row.thumbnail || '',
          })),
        })
        setError(result?.error || '')
        // A cached view paints first. If the user enabled daily updates,
        // quietly refresh outdated content after it is already available.
        if (!force && result?.refreshDue) void load(true)
      } catch (err) {
        if (active) setError(err.message || 'Could not load this playlist.')
      } finally { if (active) setLoading(false) }
    }
    const force = forceNext.current
    forceNext.current = false
    void load(force)
    return () => { active = false }
  }, [id, revision, valid, youtube, provider, label, discovery])

  const title = playlist.title || location.state?.title || t('{provider} playlist', { provider: label })
  const context = { type: discovery ? 'mix' : 'discovery', name: title, path: location.pathname }
  const cover = playlist.cover || location.state?.cover
  const downloadMissing = async () => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setDownloading(true)
    const toast = showLoadingToast('Finding songs to download…')
    try {
      const result = await downloadMissingProviderTracks(playlist.tracks, {
        onProgress: (message, progress) => toast.update(message, progress),
      })
      toast.close(ghostDownloadMessage(result))
    } catch (error) { toast.close(error.message || 'Could not download the missing songs.') }
    finally { downloadingRef.current = false; setDownloading(false) }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {cover ? <img src={cover} alt="" className="h-14 w-14 rounded-lg object-cover" />
            : <ListMusic size={28} className="shrink-0 text-accent" />}
          <div className="min-w-0">
            <p className="text-xs font-display uppercase tracking-widest text-muted">{t('{provider} playlist', { provider: label })}</p>
            <h1 className="truncate text-2xl font-semibold text-white">{title}</h1>
            {!loading && !error && <p className="text-xs text-muted">
              {t('{count} songs available', { count: playlist.tracks.length })}
              {playlist.total > playlist.tracks.length && ` · ${t('{count} entries unavailable from {provider}', { count: playlist.total - playlist.tracks.length, provider: label })}`}
            </p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={loading || downloading || !playlist.tracks.length} onClick={downloadMissing}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-white disabled:opacity-50">
            <Download size={15} /> {t(downloading ? 'Preparing downloads…' : 'Download missing songs')}
          </button>
          <button type="button" disabled={loading || !valid} onClick={() => { forceNext.current = true; setRevision(n => n + 1) }}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-white disabled:opacity-50"
            aria-label={t('Refresh playlist')} title={t('Refresh playlist')}><RefreshCw size={17} /></button>
        </div>
      </div>
      {error && playlist.tracks.length > 0 && <p className="text-xs text-muted" role="status">{t('Update failed. Showing the saved playlist.')} {error}</p>}
      {loading && !playlist.tracks.length ? <p role="status" className="py-10 text-center text-sm text-muted">{t('Loading playlist…')}</p>
        : error && !playlist.tracks.length ? <p className="py-10 text-center text-sm text-muted" role="alert">{error}</p>
        : playlist.tracks.length
          ? <PlaylistCollection tracks={playlist.tracks} context={context} cover={cover} resolveTracks />
          : <p className="py-10 text-center text-sm text-muted">{t('This playlist has no available songs.')}</p>}
    </div>
  )
}
