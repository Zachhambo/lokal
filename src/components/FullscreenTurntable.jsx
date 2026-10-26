import React, { useEffect, useRef, useState } from 'react'
import { trackArtURL, trackFullArtURL } from '../onlineTracks'

const WORKSHOP_URL = 'https://steamcommunity.com/sharedfiles/filedetails/?id=2873513347'

// Wallpaper Engine's original composition is rendered from the user's own
// Workshop scene.pkg. No replacement artwork, custom room, or copyrighted
// textures are bundled with Lokal.
export default function FullscreenTurntable({ track, playing, progress = 0, duration = 0, onNext, onPrevious, onPlayPause }) {
  const stageRef = useRef(null)
  const sceneRef = useRef(null)
  const commandsRef = useRef({ onNext, onPrevious, onPlayPause })
  commandsRef.current = { onNext, onPrevious, onPlayPause }
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
          skipNext: () => commandsRef.current.onNext?.(),
          skipPrevious: () => commandsRef.current.onPrevious?.(),
          playPause: () => commandsRef.current.onPlayPause?.(),
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

  // These measured coordinates correspond to the original 1920x1080 scene.
  // The backdrop remains the creator's actual texture; only the media-driven
  // sleeve and vinyl label are replaced with Lokal's high-resolution artwork.
  const [bounds, setBounds] = useState({ width: 1920, height: 1080 })
  useEffect(() => {
    if (!stageRef.current) return undefined
    const update = () => setBounds({
      width: stageRef.current?.clientWidth || 1920,
      height: stageRef.current?.clientHeight || 1080,
    })
    const observer = new ResizeObserver(update)
    observer.observe(stageRef.current)
    update()
    return () => observer.disconnect()
  }, [])
  const scale = Math.max(bounds.width / 1920, bounds.height / 1080)
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
      {status === 'ready' && artwork && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1]"
          style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center' }}>
          {/* Perspective-correct replacement for the LP sleeve in the source scene.
              The surrounding blinds, lighting, turntable, dust cover and wood
              remain original pixels rendered from the Workshop package. */}
          <img src={artwork} alt="" draggable={false}
            className="absolute h-[512px] w-[512px] object-cover"
            style={{
              left: 0, top: 0,
              transformOrigin: '0 0',
              transform: 'matrix3d(1.01199238,-0.08786886,0,0.00002078,0.13195849,1.01258253,0,0.00004894,0,0,1,0,160,236,0,1)',
              filter: 'brightness(.88) saturate(.92)',
            }} />
          {/* The original disc remains physically present; its small printed
              centre label reflects the same cover rather than a default logo. */}
          <div className="absolute overflow-hidden rounded-full"
            style={{
              left: 1184, top: 570, width: 160, height: 160,
              transform: 'rotate(-7deg) scaleY(.53)',
              boxShadow: '0 0 0 3px rgba(0,0,0,.16), inset 0 0 15px rgba(0,0,0,.25)',
            }}>
            <img src={artwork} alt="" draggable={false} className="h-full w-full rounded-full object-cover fullscreen-turntable-label"
              style={{ animationPlayState: playing ? 'running' : 'paused', filter: 'brightness(.84)' }}/>
            <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#a4a09b] shadow-inner"/>
          </div>
        </div>
      )}
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
