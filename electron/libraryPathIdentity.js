const path = require('path')
const fs = require('fs')
const expression = process.platform === 'win32' ? "LOWER(REPLACE(file_path, char(92), '/'))" : 'file_path'
function pathKey(file) {
  const resolved = path.resolve(file)
  // SQLite's built-in LOWER() only folds ASCII, so keep the lookup key in
  // sync instead of lowercasing non-ASCII path characters in JavaScript.
  return process.platform === 'win32'
    ? resolved.replace(/\\/g, '/').replace(/[A-Z]/g, character => character.toLowerCase())
    : resolved
}
function findByPath(db, file) {
  // The overwhelmingly common case is an exact stored path. SQLite's unique
  // index handles it without probing the filesystem (which can hang when a
  // previously indexed NAS path is offline). It also prevents an unnecessary
  // INSERT that would violate tracks.file_path if the stat-based alias check
  // cannot access the file.
  const exact = db.prepare('SELECT * FROM tracks WHERE file_path = ?').get(file)
  if (exact) return exact
  return db.prepare(`SELECT * FROM tracks WHERE ${expression} = ? ORDER BY (download_source IS NOT NULL) DESC`).all(pathKey(file))
    .find(row => sameFile(row.file_path, file))
}
function sameFile(left, right) {
  if (path.resolve(left) === path.resolve(right)) return true
  // Windows directories can explicitly enable case sensitivity. Case-folded
  // spelling alone must never merge two distinct files in those directories.
  try {
    const a = fs.statSync(left, { bigint: true }), b = fs.statSync(right, { bigint: true })
    return a.ino !== 0n && a.ino === b.ino && a.dev === b.dev
  } catch { return false }
}
function ensureIndex(db) { db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_physical_path ON tracks (${expression})`) }
function findVerifiedSameFileMerges(db) {
  // File identities (including disconnected NAS aliases) are resolved BEFORE
  // taking any write lock, and entirely off the Electron main thread.
  const merges = []
  const groups = db.prepare(`SELECT ${expression} AS identity FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND file_path NOT LIKE 'stream://%' GROUP BY ${expression} HAVING COUNT(*)>1`).all()
  for (const group of groups) {
    const rows = db.prepare(`SELECT * FROM tracks WHERE ${expression}=? ORDER BY (download_source IS NOT NULL) DESC, COALESCE(play_count,0) DESC`).all(group.identity)
    const keeper = rows[0]
    for (const loser of rows.slice(1)) {
      if (sameFile(keeper.file_path, loser.file_path)) {
        merges.push({ keeperId: keeper.id, keeperPath: keeper.file_path, loserId: loser.id, loserPath: loser.file_path })
      }
    }
  }
  return merges
}

function mergeVerifiedRows(db, merges) {
  const currentKeeper = db.prepare('SELECT file_path FROM tracks WHERE id=?')
  const currentLoser = db.prepare('SELECT * FROM tracks WHERE id=?')
  let repaired = 0
  for (const item of merges) {
    // Never merge rows replaced by the scanner after identity verification.
    if (currentKeeper.get(item.keeperId)?.file_path !== item.keeperPath) continue
    const loser = currentLoser.get(item.loserId)
    if (!loser || loser.file_path !== item.loserPath) continue
    require('./mergeTrackReferences').mergeTrackReferences(db, item.keeperId, loser)
    repaired++
  }
  return repaired
}

function staleAliasIds(db) {
  return db.prepare('SELECT a.old_id FROM track_aliases a WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id=a.old_id)').all().map(row => row.old_id)
}

function reconcileAliasRows(db, ids) {
  // Older merges can retain references in newer account/extension tables.
  for (const oldId of ids) {
    const keeper = require('./trackAlias').trackById(db, oldId)
    if (keeper) require('./mergeTrackReferences').mergeTrackReferences(db, keeper.id, { id: oldId })
  }
}

function repairSameFileRows(db) {
  const merges = findVerifiedSameFileMerges(db)
  let repaired = 0
  db.transaction(() => {
    repaired = mergeVerifiedRows(db, merges)
    reconcileAliasRows(db, staleAliasIds(db))
    ensureIndex(db)
  })()
  return repaired
}

/** The worker's cooperative variant never holds a library-wide write lock.
 * A single transaction covering thousands of aliases can block main-process
 * SQLite IPC for several seconds even when that transaction runs in a worker.
 * Keep each transaction short and leave a scheduling gap for foreground IO.
 */
async function repairSameFileRowsCooperative(db, { batchSize = 5, pauseMs = 15 } = {}) {
  const merges = findVerifiedSameFileMerges(db)
  const size = Math.max(1, Math.min(20, Math.floor(batchSize) || 5))
  let repaired = 0
  const yieldToForeground = () => new Promise(resolve => setTimeout(resolve, pauseMs))
  for (let offset = 0; offset < merges.length; offset += size) {
    repaired += db.transaction(() => mergeVerifiedRows(db, merges.slice(offset, offset + size)))()
    await yieldToForeground()
  }
  const ids = staleAliasIds(db)
  for (let offset = 0; offset < ids.length; offset += size) {
    db.transaction(() => reconcileAliasRows(db, ids.slice(offset, offset + size)))()
    await yieldToForeground()
  }
  ensureIndex(db)
  return repaired
}
module.exports = { pathKey, expression, findByPath, ensureIndex, repairSameFileRows, repairSameFileRowsCooperative, sameFile }
