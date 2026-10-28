const { trackKey } = require('./protocol')

// Reconcile the actual desktop playlists against the last synchronized desktop
// state. SQL triggers usually capture changes, but legacy imports, database
// restores and operations that bypass those triggers may leave the event log
// incomplete. An incremental cursor cannot recover those omissions alone.
function snapshotPlaylists(store, userId) {
  const db = store.db
  const result = {}
  const playlists = db.prepare('SELECT id,uuid,name FROM playlists WHERE user_id=?').all(userId)
  const members = db.prepare(
    'SELECT pt.position,t.* FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id WHERE pt.playlist_id=? ORDER BY pt.position,pt.id'
  )
  for (const playlist of playlists) {
    if (!playlist.uuid) continue
    result[playlist.uuid] = {
      name: playlist.name,
      members: members.all(playlist.id).map(row => {
        const path = String(row.file_path || '')
        const youtube = 'ghost://youtube/online/'
        const soundcloud = 'ghost://soundcloud/online/'
        return {
          track_key: trackKey(row),
          position: row.position,
          file_hash: row.file_hash,
          title: row.title,
          artist: row.artist,
          album: row.album,
          duration: row.duration,
          online_ref: path.startsWith('ghost://') && !path.startsWith('ghost://link/'),
          source_ref: path.startsWith(youtube) ? 'yt:' + path.slice(youtube.length)
            : path.startsWith(soundcloud) ? 'sc:' + path.slice(soundcloud.length) : null,
          artwork_url: row.artwork_url
        }
      })
    }
  }
  return result
}

// Pure difference so the mutation semantics can be regression-tested without
// requiring a running Electron instance or audio library.
function diffPlaylistSnapshots(previous, current) {
  const changes = []
  for (const [id, former] of Object.entries(previous)) {
    if (!(id in current)) changes.push({ entity: 'playlist', entity_id: id, op: 'playlist.delete', fields: {} })
  }
  for (const [id, playlist] of Object.entries(current)) {
    const former = previous[id]
    if (!former) {
      changes.push({ entity: 'playlist', entity_id: id, op: 'playlist.create', fields: { name: playlist.name } })
    } else if (former.name !== playlist.name) {
      changes.push({ entity: 'playlist', entity_id: id, op: 'playlist.rename', fields: { name: playlist.name } })
    }
    const oldMembers = new Map((former?.members || []).map(member => [member.track_key, member]))
    const newMembers = new Map(playlist.members.map(member => [member.track_key, member]))
    for (const old of oldMembers.values()) {
      if (!newMembers.has(old.track_key)) {
        changes.push({ entity: 'playlist', entity_id: id, op: 'playlist.remove', fields: { track_key: old.track_key } })
      }
    }
    for (const member of playlist.members) {
      const old = oldMembers.get(member.track_key)
      if (!old || old.position !== member.position ||
          old.title !== member.title || old.artist !== member.artist ||
          old.album !== member.album || old.duration !== member.duration ||
          old.file_hash !== member.file_hash ||
          old.source_ref !== member.source_ref ||
          old.artwork_url !== member.artwork_url) {
        changes.push({
          entity: 'playlist', entity_id: id,
          op: old ? 'playlist.move' : 'playlist.add',
          fields: member
        })
      }
    }
  }
  return changes
}

function _key(userId) {
  return 'link_playlist_reconciliation_v1:' + userId
}

function savePlaylistSnapshot(store, userId) {
  const snapshot = snapshotPlaylists(store, userId)
  store.db.prepare('INSERT OR REPLACE INTO link_meta (key,value) VALUES (?,?)')
    .run(_key(userId), JSON.stringify(snapshot))
  return snapshot
}

function reconcilePlaylists(store, userId) {
  const raw = store.db.prepare('SELECT value FROM link_meta WHERE key=?').get(_key(userId))?.value
  let previous = {}
  if (raw) {
    try {
      const decoded = JSON.parse(raw)
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) previous = decoded
    } catch {}
  }
  const current = snapshotPlaylists(store, userId)
  const changes = diffPlaylistSnapshots(previous, current)
  // All operations are append-only: no playlist/audio file is removed here.
  // Desktop edits already journalled by triggers may be repeated harmlessly;
  // the phone's replay uses the later operation as the same desired state.
  for (const change of changes) store.appendOp(change, userId)
  savePlaylistSnapshot(store, userId)
  return changes.length
}

module.exports = { snapshotPlaylists, diffPlaylistSnapshots, savePlaylistSnapshot, reconcilePlaylists }
