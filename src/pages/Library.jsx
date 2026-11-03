import React, { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List, Search, X, Clock, Shuffle, Play, FolderPlus, Loader2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import LibraryFolderBrowser from '../components/LibraryFolderBrowser'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { useTranslation } from '../i18n'
import { playNextMany } from '../trackActions'
import { shuffledLibraryTracks } from '../libraryHelpers'

function configuredRoots(settings) {
  let roots = []
  try {
    const parsed = JSON.parse(settings?.music_folders || 'null')
    if (Array.isArray(parsed)) roots = parsed
  } catch {}
  if (!roots.length && typeof settings?.music_folder === 'string' && settings.music_folder.trim()) roots = [settings.music_folder]
  const seen = new Set()
  return roots.filter(value => {
    if (typeof value !== 'string' || !value.trim()) return false
    const key = value.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(value => value.trim())
}

export default function Library() {
  const { t } = useTranslation()
  const [sort, setSort] = useCachedState('library:sort', 'added_at DESC')
  // Where the songs came from (see sourceFilter in electron/ipc/scanner.js).
  const [source, setSource] = useCachedState('library:source', 'all')
  // One genre, or '' for all (matches a song's main genre or any of its genres).
  const [genre, setGenre] = useCachedState('library:genre', '')
  const [genres, setGenres] = useCachedState('library:genres', [])
  // One audio quality tier, or '' for all (the Audio Quality page's tiers).
  const [quality, setQuality] = useCachedState('library:quality', '')
  const [format, setFormat] = useCachedState('library:format', '')
  const [view, setView] = useCachedState('library:view', 'list')
  const [folderPath, setFolderPath] = useCachedState('library:folderPath', '')
  const [folderSearch, setFolderSearch] = useState('')
  const [folderData, setFolderData] = useState(null)
  const [folderViewOverride, setFolderViewOverride] = useState(null)
  const [musicRoots, setMusicRoots] = useState([])
  const [activeMusicRoot, setActiveMusicRoot] = useCachedState('library:activeMusicRoot', '')
  const [addingMusicFolder, setAddingMusicFolder] = useState(false)
  const [musicRootError, setMusicRootError] = useState('')

  useEffect(() => {
    let live = true
    api.getSettings().then(settings => {
      if (!live) return
      const roots = configuredRoots(settings || {})
      setMusicRoots(roots)
      setActiveMusicRoot(current => roots.includes(current) ? current : (roots[0] || ''))
    }).catch(() => {})
    return () => { live = false }
  }, [])
  usePageReady(folderData !== null)
  const playQueue = usePlayerStore(s => s.playQueue)
  const navigate = useNavigate()
  const location = useLocation()
  const isTrackOnlyFolder = !!folderData?.relativePath &&
    folderData.relativePath === folderPath &&
    folderData.folders?.length === 0 &&
    folderData.tracks?.length > 0
  const activeView = isTrackOnlyFolder
    ? (folderViewOverride?.path === folderPath ? folderViewOverride.view : 'list')
    : view

  /** Update the shared view and preserve an explicit choice for the current folder. */
  const changeView = nextView => {
    setView(nextView)
    setFolderViewOverride({ path: folderPath, view: nextView })
  }

  const addMusicFolder = async () => {
    if (!api.isElectron || addingMusicFolder) return
    setMusicRootError('')
    const selected = await api.openFolder()
    if (!selected || typeof selected !== 'string') return
    if (musicRoots.some(root => root.toLowerCase() === selected.toLowerCase())) {
      setActiveMusicRoot(selected)
      setFolderPath('')
      setFolderData(null)
      setFolderSearch('')
      return
    }
    const nextRoots = [...musicRoots, selected]
    setAddingMusicFolder(true)
    try {
      const result = await api.scanFolders(nextRoots)
      if (result?.error) throw new Error(result.error)
      const savedRoots = Array.isArray(result?.folders) && result.folders.length ? result.folders : nextRoots
      setMusicRoots(savedRoots)
      setActiveMusicRoot(selected)
      setFolderPath('')
      setFolderData(null)
      setFolderSearch('')
      await api.saveSettings({ music_folders: JSON.stringify(savedRoots), music_folder: savedRoots[0] || '' })
      window.dispatchEvent(new Event('lokal:refresh'))
    } catch (error) {
      setMusicRootError(error?.message === 'Choose at least one existing music folder' ? t(error.message) : t('Could not add this music folder'))
    } finally {
      setAddingMusicFolder(false)
    }
  }
  const playAllTracks = folderData?.filteredTracks || (folderData?.tracks?.length ? folderData.tracks : folderData?.allTracks) || []
  const folderFilters = useMemo(() => ({ source, genre, format: quality ? '' : format, quality, sort }), [source, genre, format, quality, sort])

  useEffect(() => {
    if (typeof location.state?.openFolder !== 'string') return
    setFolderPath(location.state.openFolder)
    setFolderSearch('')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  // The genres to pick from: every one in the library, on opening and after a refresh.
  const loadGenres = () => Promise.resolve(api.getAllGenres())
    .then(list => { if (Array.isArray(list)) setGenres(list.filter(g => typeof g === 'string' && g.trim())) })
    .catch(() => {})
  useEffect(() => { loadGenres() }, [])
  useEffect(() => {
    window.addEventListener('lokal:refresh', loadGenres)
    return () => window.removeEventListener('lokal:refresh', loadGenres)
  }, [])

  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? api.fileURL(t.artwork_path) : api.artworkURL(t.id))
    : null

  return (
    <div className="p-6 space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <h1 className="font-display text-lg uppercase tracking-widest text-white">{t("Library")}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select value={source} onChange={e => setSource(e.target.value)} aria-label={t("Source")}
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="all">{t("All sources")}</option>
            <option value="local">{t("Music folder")}</option>
            <option value="mobile">{t("Mobile")}</option>
            <option value="yt">{t("YouTube")}</option>
            <option value="sc">{t("SoundCloud")}</option>
            <option value="addon">{t("Addons")}</option>
            <option value="soulseek">{t("Soulseek")}</option>
            <option value="web">{t("Other sites")}</option>
            <option value="errors">{t("Errors")}</option>
          </select>
          <select value={genre} onChange={e => setGenre(e.target.value)} aria-label={t("Genres")}
            className={`max-w-[11rem] truncate bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${genre ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            <option value="">{t("All genres")}</option>
            {genre && !genres.some(g => g.toLowerCase() === genre.toLowerCase()) && <option value={genre}>{genre}</option>}
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select
            value={quality ? `quality:${quality}` : format ? `format:${format}` : ''}
            onChange={e => {
              const value = e.target.value
              if (value.startsWith('quality:')) { setQuality(value.slice(8)); setFormat('') }
              else if (value.startsWith('format:')) { setFormat(value.slice(7)); setQuality('') }
              else { setQuality(''); setFormat('') }
            }}
            aria-label={t("Format and quality")}
            className={`bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${quality || format ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}
          >
            <option value="">{t("All formats and qualities")}</option>
            <optgroup label={t("Quality")}>
              <option value="quality:hires">{t("Hi-res")}</option>
              <option value="quality:lossless">{t("Lossless")}</option>
              <option value="quality:high">{t("High")}</option>
              <option value="quality:low">{t("Low")}</option>
              <option value="quality:suspect">{t("Suspect")}</option>
            </optgroup>
            <optgroup label={t("Format")}>
              <option value="format:16-44100">16-bit / 44.1 kHz</option>
              <option value="format:16-48000">16-bit / 48 kHz</option>
              <option value="format:16-88200">16-bit / 88.2 kHz</option>
              <option value="format:16-96000">16-bit / 96 kHz</option>
              <option value="format:16-192000">16-bit / 192 kHz</option>
              <option value="format:24-44100">24-bit / 44.1 kHz</option>
              <option value="format:24-48000">24-bit / 48 kHz</option>
              <option value="format:24-88200">24-bit / 88.2 kHz</option>
              <option value="format:24-96000">24-bit / 96 kHz</option>
              <option value="format:24-176400">24-bit / 176.4 kHz</option>
              <option value="format:24-192000">24-bit / 192 kHz</option>
              <option value="format:32-44100">32-bit / 44.1 kHz</option>
              <option value="format:32-48000">32-bit / 48 kHz</option>
              <option value="format:32-88200">32-bit / 88.2 kHz</option>
              <option value="format:32-96000">32-bit / 96 kHz</option>
              <option value="format:32-192000">32-bit / 192 kHz</option>
            </optgroup>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label={t("Sort")}
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="added_at DESC">{t("Recently Added")}</option>
            <option value="title ASC">{t("Title A-Z")}</option>
            <option value="artist ASC">{t("Artist A-Z")}</option>
            <option value="play_count DESC">{t("Most Played")}</option>
            <option value="duration DESC">{t("Longest")}</option>
          </select>
          <div className="flex bg-elevated border border-border rounded-lg overflow-hidden">
            <button onClick={() => changeView('list')} aria-label={t("List view")} className={`p-1.5 transition-colors ${activeView === 'list' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><List size={14} /></button>
            <button onClick={() => changeView('grid')} aria-label={t("Grid view")} className={`p-1.5 transition-colors ${activeView === 'grid' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><LayoutGrid size={14} /></button>
          </div>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2">
        {playAllTracks.length > 0 && (
          <>
            <button onClick={() => playQueue(playAllTracks, 0, { type: 'library-folder' })} className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90"><Play size={15} fill="currentColor" /> {t('Play')}</button>
            <button onClick={() => playNextMany(playAllTracks)} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50"><Clock size={15} /> {t('Play next')}</button>
            <button onClick={() => { const list = shuffledLibraryTracks(playAllTracks); if (list.length) playQueue(list, 0, { type: 'library-folder' }) }} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50"><Shuffle size={15} /> {t('Shuffle')}</button>
          </>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-white">
            <Search size={14} className="flex-shrink-0 text-muted" />
            <input
              type="text"
              value={folderSearch}
              onChange={e => setFolderSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setFolderSearch('') }}
              placeholder={t("Search folders & tracks…")}
              aria-label={t("Search folders and tracks")}
              className="w-36 bg-transparent text-xs text-white outline-none placeholder:text-muted focus:w-48 transition-all @sm:w-44"
            />
            {folderSearch && (
              <button
                type="button"
                onClick={() => setFolderSearch('')}
                aria-label={t("Clear search")}
                className="flex-shrink-0 text-muted transition-colors hover:text-white"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {api.isElectron && (
            <button type="button" onClick={addMusicFolder} disabled={addingMusicFolder}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-muted transition-colors hover:text-white disabled:opacity-50">
              {addingMusicFolder ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
              {addingMusicFolder ? t('Adding folder…') : t('Add music folder')}
            </button>
          )}
        </div>
      </div>

      {musicRootError && <p className="text-xs text-red-400" role="alert">{musicRootError}</p>}
      <LibraryFolderBrowser
        folderPath={folderPath}
        onFolderChange={setFolderPath}
        onDataChange={setFolderData}
        view={activeView}
        playQueue={playQueue}
        artSrc={artSrc}
        searchQuery={folderSearch}
        onSearchQueryChange={setFolderSearch}
        rootPath={activeMusicRoot}
        filters={folderFilters}
      />
    </div>
  )
}
