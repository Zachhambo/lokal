// Third-deck, prepared-stem transition for local tracks. Disabled unless the
// user explicitly enables the experimental setting. No model inference or
// network streaming happens here; missing clips retain AutoMix's two-deck mix.
const finite = value => typeof value === 'number' && Number.isFinite(value)

export function eligibleStemTransition(clip, plan, speed = 1) {
  if (!clip || !plan || plan.kind !== 'beatmatch' ||
      !finite(speed) || Math.abs(speed - 1) > 1e-4) return false
  if (!ArrayBuffer.isView(clip.audio) && !(clip.audio instanceof ArrayBuffer)) return false
  const bytes = clip.audio.byteLength
  if (!bytes || bytes < 128 || bytes > 100 * 1024 * 1024) return false
  const { outStart, inStart, resumeIn, durationSeconds, masterGain } = clip
  return [outStart,inStart,resumeIn,durationSeconds,masterGain].every(finite) &&
    outStart >= 15 && inStart >= 0 && resumeIn > inStart &&
    durationSeconds >= 6 && durationSeconds <= 45 &&
    masterGain > 0 && masterGain <= 1.05 &&
    // Source analysis can snap to a beat slightly before a model cue.
    Math.abs(plan.start - outStart) < 1.2 &&
    Math.abs(plan.length - durationSeconds) < 1.2 &&
    Math.abs(plan.inOffset - inStart) < 1.2
}

/** Owns a temporary, pauseable HTMLAudioElement routed through the existing
 * AudioContext analyser/output. The active deck remains the real next track,
 * so queue/seek events and media sessions retain their usual song identity.
 * The third deck is never created for remote, native Atmos or bit-perfect
 * routes by the caller.
 */
export function createStemPlayback({
  clip, ctx, analyser, outgoing, incoming,
  outFade, inFade, getVolume, onFinish, onAbort,
}) {
  if (!ctx || !analyser || !outgoing || !incoming || !outFade?.gain ||
      !inFade?.gain || !clip?.audio) return null
  const bytes = clip.audio instanceof ArrayBuffer
    ? clip.audio : clip.audio.buffer.slice(clip.audio.byteOffset,
      clip.audio.byteOffset + clip.audio.byteLength)
  const objectURL = URL.createObjectURL(new Blob([bytes], { type:'audio/wav' }))
  const element = new Audio(objectURL)
  element.preload = 'auto'
  const source = ctx.createMediaElementSource(element)
  const mixGain = ctx.createGain()
  source.connect(mixGain)
  mixGain.connect(analyser)
  let finished = false
  let preparedHandoff = false
  let pendingInternalSeek = 0
  let playing = false

  const silenceClip = () => {
    mixGain.gain.cancelScheduledValues(ctx.currentTime)
    mixGain.gain.setValueAtTime(0,ctx.currentTime)
    try { element.pause() } catch {}
  }
  const detach = () => {
    element.removeEventListener('timeupdate', onProgress)
    element.removeEventListener('ended', complete)
    element.removeEventListener('error', abort)
    incoming.removeEventListener('pause', mirrorPause)
    incoming.removeEventListener('play', mirrorPlay)
    incoming.removeEventListener('seeking', onSeek)
    silenceClip()
    try { element.removeAttribute('src'); element.load() } catch {}
    try { source.disconnect(); mixGain.disconnect() } catch {}
    URL.revokeObjectURL(objectURL)
  }
  const complete = () => {
    if (finished) return
    finished = true
    try {
      if (!preparedHandoff) {
        pendingInternalSeek++
        incoming.currentTime = clip.resumeIn
      }
      const t = ctx.currentTime
      for (const fade of [outFade.gain, inFade.gain]) fade.cancelScheduledValues(t)
      outFade.gain.setValueAtTime(0,t)
      inFade.gain.setValueAtTime(1,t)
      incoming.playbackRate = 1
      incoming.play().catch(() => {})
    } catch {}
    detach()
    onFinish?.()
  }
  const abort = () => {
    if (finished) return
    finished = true
    const t = ctx.currentTime
    try {
      for (const fade of [outFade.gain,inFade.gain]) fade.cancelScheduledValues(t)
      outFade.gain.setValueAtTime(0,t)
      inFade.gain.setValueAtTime(1,t)
      incoming.playbackRate = 1
      incoming.play().catch(() => {})
    } catch {}
    detach()
    onAbort?.()
  }
  function onProgress() {
    if (finished || !playing) return
    const duration = element.duration
    if (!Number.isFinite(duration)) return
    const left = duration - element.currentTime
    // The next track is pre-decoded and played quietly before the boundary,
    // then both decks are blended for 350 ms to hide codec seek jitter.
    if (left <= 0.45 && !preparedHandoff) {
      preparedHandoff = true
      try {
        pendingInternalSeek++
        incoming.currentTime = Math.max(0, clip.resumeIn - Math.max(0, left))
        incoming.play().catch(() => {})
      } catch {}
      const now = ctx.currentTime
      const fade = Math.max(0.04,left)
      inFade.gain.cancelScheduledValues(now)
      inFade.gain.setValueAtTime(0, now)
      inFade.gain.linearRampToValueAtTime(1, now + fade)
      mixGain.gain.cancelScheduledValues(now)
      mixGain.gain.setValueAtTime(Math.max(0,mixGain.gain.value),now)
      mixGain.gain.linearRampToValueAtTime(0,now+fade)
    } else if (!preparedHandoff) {
      const now = ctx.currentTime
      mixGain.gain.setTargetAtTime(Math.max(0, getVolume()),now,.08)
    }
  }
  function mirrorPause() { if (!finished) element.pause() }
  function mirrorPlay() {
    if (!finished && playing && element.paused) element.play().catch(abort)
  }
  function onSeek() {
    if (pendingInternalSeek > 0) { pendingInternalSeek--; return }
    abort()
  }
  element.addEventListener('timeupdate',onProgress)
  element.addEventListener('ended',complete)
  element.addEventListener('error',abort)
  incoming.addEventListener('pause',mirrorPause)
  incoming.addEventListener('play',mirrorPlay)
  incoming.addEventListener('seeking',onSeek)

  return {
    element,
    async start() {
      if (finished) return false
      try {
        await element.play() // Do not mute the real decks until audible.
        if (finished) return false
        playing = true
        const now = ctx.currentTime
        for(const fade of [outFade.gain,inFade.gain]) fade.cancelScheduledValues(now)
        outFade.gain.setValueAtTime(1,now)
        outFade.gain.linearRampToValueAtTime(0,now+.15)
        inFade.gain.setValueAtTime(0,now)
        mixGain.gain.setValueAtTime(0,now)
        mixGain.gain.linearRampToValueAtTime(Math.max(0,getVolume()),now+.15)
        return true
      } catch { abort(); return false }
    },
    stop() {
      if (finished) return
      finished = true
      detach()
    },
    complete, abort,
  }
}
