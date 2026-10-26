import React, { useEffect, useRef, useState } from 'react'
import { trackArtURL, trackFullArtURL } from '../onlineTracks'

const WORKSHOP_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=2873513347'

// Wallpaper Engine's original composition is rendered from the user's own
// Workshop scene.pkg. No replacement artwork, custom room, or copyrighted
// textures are bundled with Lokal.
export default function FullscreenTurntable({ track, playing, progress = 0, duration = 0 }) {
  const stageRef = useRef(null)
  const sceneRef = useRef(null)
  const mediaRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  // Initial media object is created once per mount. Subsequent song switches
  // update the original scene's media listeners without remounting WebGL.
  useEffect(() => {
    let cancelled = false
    let scene = null
    const start = async () => {
      if (!stageRef.current || !window.electron?.wallpaperWorkshopGet) {
        setStatus('missing')
        return
      }
      setStatus('loading')
      setError('')
      try {
        const result = await window.electron.wallpaperWorkshopGet()
        if (cancelled) return
        if (!result?.bytes?.length) {
          setStatus('missing')
          return
        }
        const { mount, bytesSource, createMediaSource } = await import('webwallgl')
        if (cancelled) return
        const media = createMediaSource({
          hasMedia: !!track,
          title: track?.title || '',
          artist: track?.artist || '',
          album: track?.album || '',
          playing,
          position: Number(progress) || 0,
          duration: Number(duration) || 0,
          thumbnail: trackFullArtURL(track) || trackArtURL(track) || '',
        }, {
          skipNext: () => { window.dispatchEvent(new Event('lokal:wallpaper-next')) },
          skipPrevious: () => { window.dispatchEvent(new Event('lokal:wallpaper-prev')) },
          playPause: () => { window.dispatchEvent(new Event('lokal:wallpaper-toggle')) },
        })
        mediaRef.current = media
        scene = await mount(stageRef.current, {
          source: bytesSource(result.bytes, result.project || undefined, result.key),
          media,
          fps: 60,
          fit: 'cover',
          volume: 0,
          renderDpr: 1,
          autoplay: true,
        })
        if (cancelled) { scene.destroy(); return }
        sceneRef.current = scene
        setStatus('ready')
      } catch (cause) {
        if (!cancelled) {
          setStatus('failed')
          setError(cause?.message || 'The scene could not be rendered.')
        }
      }
    }
    start()
    return () => {
      cancelled = true
      mediaRef.current = null
      sceneRef.current = null
      try { scene?.destroy() } catch {}
    }
  // Mount on scene selection, not on changes in the song or progress.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  const artwork = trackFullArtURL(track) || trackArtURL(track) || ''
  useEffect(() => {
    mediaRef.current?.set({
      hasMedia: !!track,
      title: track?.title || '',
      artist: track?.artist || '',
      album: track?.album || '',
      playing,
      position: Number(progress) || 0,
      duration: Number(duration) || 0,
      thumbnail: artwork,
      hasThumbnail: !!artwork,
    })
  }, [track, playing, progress, duration, artwork])

  // Keep the scene visible while paused: unlike pausing WebGL itself, the
  // wallpaper receives the PAUSED media state and can lift its tonearm,
  // decelerate the platter and retain the original author animation.
  const selectOriginal = async () => {
    const result = await window.electron?.wallpaperWorkshopChoose?.()
    if (result?.installed) setRetry(v => v + 1)
    else if (result?.error) setError(result.error)
  }
  return (
    <div className="absolute inset-0 overflow-hidden" data-original-turntable="">
      <div ref={stageRef} className="absolute inset-0 pointer-events-none" />
      {status !== 'ready' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/90 text-white">
          <div className="max-w-md rounded-xl border border-white/15 bg-neutral-900/95 p-6 text-center shadow-2xl">
            <h3 className="mb-3 text-lg font-semibold">Original Vinyl Record Player</h3>
            {status === 'loading' ? (
              <p className="text-sm text-white/60">Loading the original wallpaper scene…</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-white/70">
                  {status === 'missing'
                    ? 'Install the original wallpaper through Steam Workshop, or select its scene.pkg file. Lokal does not redistribute the creator’s assets.'
                    : 'The wallpaper could not be opened. Confirm it is the original Wallpaper Engine scene.pkg.'}
                </p>
                {error && <p className="mb-4 text-xs text-red-300">{error}</p>}
                <div className="flex justify-center gap-3">
                  <button type="button" onClick={selectOriginal}
                    className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/80">
                    Select original scene.pkg
                  </button>
                  <button type="button" onClick={() => window.electron?.openExternal?.(WORKSHOP_URL)}
                    className="rounded-full border border-white/30 px-4 py-2 text-sm text-white hover:bg-white/10">
                    Steam Workshop
                  </button>
                </div>
                <button type="button" className="mt-4 text-xs text-white/50 hover:text-white" onClick={() => setRetry(v => v + 1)}>
                  Retry detection
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
