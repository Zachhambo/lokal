import { usePlayerStore } from './store/player.js'
import { resolveRecommendationTracks } from './recommendations.js'

/** Queue the entire online selection, keeping local copies in album order. */
export async function queueOnlineTracks(tracks, {
  next = false, resolve = resolveRecommendationTracks, store = usePlayerStore,
  isCurrent = () => true, onProgress, onProviderFailure,
} = {}) {
  const rows = await resolve(tracks, undefined, {
    prepareStreams: false, isCurrent, onProgress, onProviderFailure,
  })
  if (!isCurrent()) return []
  const player = store.getState()
  if (next) {
    for (let at = rows.length - 1; at >= 0; at--) player.playNext(rows[at])
  } else {
    for (const row of rows) player.addToQueue(row)
  }
  return rows
}
