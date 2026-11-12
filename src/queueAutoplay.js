import { isStationTrack, RADIO_CONTEXT } from './radio/stations.js'

/** Autoplay extends an exhausted queue; it never controls queued songs. */
export function autoplayEnabled() {
  try { return localStorage.getItem('lokal-autoplay') !== '0' } catch { return true }
}

export function shouldTopUpRelated(state) {
  const shuffled = state.shuffle && state.shuffleQueue.length > 0
  const remaining = shuffled ? state.shuffleQueue.length - state.shuffleIndex - 1
    : state.queue.length - state.queueIndex - 1
  return autoplayEnabled() && state.repeat === 'none' &&
    !!state.currentTrack && !isStationTrack(state.currentTrack) &&
    !['flow', 'discovery', 'mix', 'library-folder', 'radio', RADIO_CONTEXT].includes(state.playbackContext?.type) &&
    !state._fetchingRelated && remaining < 3
}
