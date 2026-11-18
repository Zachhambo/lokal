// A bounded history and five random buckets: O(n + 200), no playback timer,
// database writes, or per-track queries. Every queue occurrence is retained.
export const SHUFFLE_HISTORY_LIMIT = 200

export function fewerRepeatsShuffle(items, recentIds = [], random = Math.random) {
  const ranks = new Map()
  for (const id of recentIds.slice(0, SHUFFLE_HISTORY_LIMIT)) {
    const key = String(id)
    if (!ranks.has(key)) ranks.set(key, ranks.size)
  }
  const buckets = [[], [], [], [], []]
  for (const item of items) {
    const rank = ranks.get(String(item.id))
    buckets[rank == null ? 0 : rank >= 100 ? 1 : rank >= 20 ? 2 : rank > 0 ? 3 : 4].push(item)
  }
  for (const bucket of buckets) {
    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[bucket[i], bucket[j]] = [bucket[j], bucket[i]]
    }
  }
  return buckets.flat()
}

export class ShuffleHistory {
  ids = []
  currentId = null
  get recentIds() {
    return this.currentId == null ? this.ids
      : [String(this.currentId), ...this.ids.filter(id => id !== String(this.currentId))].slice(0, SHUFFLE_HISTORY_LIMIT)
  }
  generation = 0
  async load(fetchIds) {
    const generation = ++this.generation
    this.ids = []
    try {
      const ids = await fetchIds()
      if (generation !== this.generation) return
      // Keep plays recorded while the initial history request was in flight.
      this.ids = [...new Set([...this.ids, ...ids].map(String))].slice(0, SHUFFLE_HISTORY_LIMIT)
    } catch { /* History is optional: ordinary shuffle remains available. */ }
  }
  remember(id) {
    if (id == null) return
    const key = String(id)
    this.ids = [key, ...this.ids.filter(value => value !== key)].slice(0, SHUFFLE_HISTORY_LIMIT)
  }
}

export const shuffleHistory = new ShuffleHistory()
