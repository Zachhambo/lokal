import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ListPlus, Play, Share2, Shuffle } from 'lucide-react'
import { useTranslation } from '../i18n'
import { api } from '../api'
import { useAppStore, usePlayerStore } from '../store/player'
import { usePlaylistSortStore, playlistSortPreference } from '../store/playlistSort'
import { sortPlaylistTracks } from '../playlistSorting'
import { filterPlaylistTracks } from '../playlistSearch'
import { resolveRecommendationTracks, songKey } from '../recommendations'
import { playRecommendationPool } from '../recommendationPlayback'
import { isPlayable } from '../onlineTracks'
import { saveAsPlaylist } from '../trackActions'
import { coversOf, openShareCard } from '../shareCard'
import { showLoadingToast } from './Toaster'
import PlaylistSearchControl from './PlaylistSearchControl'
import TrackList from './TrackList'

const ICON_BUTTON = 'flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/[0.06] hover:text-white disabled:opacity-40'
const resolveRecommendations = (rows, options) => resolveRecommendationTracks(rows, api, options)

export default function PlaylistCollection({ tracks, context, resolveTracks, cover, extraColumns = [] }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const userId = useAppStore(state => state.user?.id)
  const sortKey = `collection:${userId || 'guest'}:${context.path}`
  const sort = usePlaylistSortStore(state => playlistSortPreference(state.sorts[sortKey]))
  const setSort = usePlaylistSortStore(state => state.setSort)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const resolver = resolveTracks === true ? resolveRecommendations : resolveTracks
  const sorted = useMemo(() => sortPlaylistTracks(tracks, sort), [tracks, sort])
  const visible = useMemo(() => filterPlaylistTracks(sorted, query), [sorted, query])
  const trackNumbers = useMemo(() => new Map(tracks.map((track, index) => [track.id, index + 1])), [tracks])
  const playable = resolver ? sorted : sorted.filter(isPlayable)
  const highlight = (location.state?.highlightTrackId && tracks.find(track => String(track.id) === String(location.state.highlightTrackId)))
    || (location.state?.highlightSongKey && tracks.find(track => songKey(track) === location.state.highlightSongKey))

  useEffect(() => {
    if (location.state?.highlightTrackId || location.state?.highlightSongKey) {
      setSearchOpen(false)
      setQuery('')
    }
  }, [location.key, location.state])

  const play = async (shuffle = false) => {
    const rows = shuffle ? [...playable] : playable
    if (shuffle) {
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rows[i], rows[j]] = [rows[j], rows[i]]
      }
    }
    if (!rows.length) return
    if (!resolver) { usePlayerStore.getState().playQueue(rows, 0, context); return }
    const toast = showLoadingToast(t('Finding the selected songs…'))
    try {
      const started = await playRecommendationPool(rows, {
        firstPlayable: true, context, resolve: resolver, returnAfterStart: true,
        onProgress: message => toast.update(message),
      })
      toast.close(started === false ? t('No playable matches were found.') : '')
    } catch (error) { toast.close(error.message || t('Could not resolve the selected tracks.')) }
  }

  const save = async () => {
    setSaving(true)
    const toast = showLoadingToast(t('Saving playlist…'))
    try {
      const rows = resolver ? await resolver(sorted, { prepareStreams: false, onProgress: message => toast.update(message) }) : sorted
      if (!rows.length) { toast.close(t('No playable matches were found.')); return }
      const playlist = await saveAsPlaylist(context.name, rows, { userId, coverURL: cover })
      toast.close(playlist ? '' : t('Could not create playlist'))
      if (playlist) navigate(`/playlist/${encodeURIComponent(playlist.id)}`)
    } catch (error) { toast.close(error.message || t('Could not create playlist')) }
    finally { setSaving(false) }
  }

  const share = () => openShareCard({
    kind: t('Playlist'), title: context.name,
    art: cover ? [{ url: cover }] : coversOf(tracks, 4),
    stats: [[t('Songs'), tracks.length.toLocaleString()]],
    list: { title: t('Songs'), items: tracks.slice(0, 5).map(track => [track.title, track.artist]) },
  })

  return <>
    <TrackList tracks={visible} context={context} resolveTracks={resolver} extraColumns={extraColumns}
      sort={sort} onSortChange={next => setSort(sortKey, next)} trackNumbers={trackNumbers}
      highlightTrackId={highlight?.id} highlightRequestKey={location.key}
      showQuality reduceMotion
      toolbarStart={<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-1 [&>*]:shrink-0">
        <button type="button" onClick={() => play()} disabled={!playable.length}
          aria-label={t('Play All')} title={t('Play All')}
          className="mr-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-base disabled:opacity-40">
          <Play size={17} fill="currentColor" />
        </button>
        <PlaylistSearchControl open={searchOpen} setOpen={setSearchOpen} query={query} setQuery={setQuery} buttonClassName={ICON_BUTTON} />
        <button type="button" onClick={() => play(true)} disabled={!playable.length}
          aria-label={t('Shuffle')} title={t('Shuffle')} className={ICON_BUTTON}><Shuffle size={17} /></button>
        <button type="button" onClick={save} disabled={saving || !tracks.length}
          aria-label={t('Save as playlist')} title={t('Save as playlist')} className={ICON_BUTTON}><ListPlus size={17} /></button>
        <button type="button" onClick={share} disabled={!tracks.length}
          aria-label={t('Share as a picture')} title={t('Share as a picture')} className={ICON_BUTTON}><Share2 size={17} /></button>
      </div>}
    />
    {query.trim() && !visible.length && <p role="status" className="py-12 text-center text-sm text-muted">
      {t('No songs match “{query}”.', { query })}
    </p>}
  </>
}
