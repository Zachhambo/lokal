import React from 'react'
import { api } from '../api'
import { trackFullArtURL } from '../onlineTracks'
import FadeImg from './FadeImg'

export default function FolderArtwork({ folder, className = '' }) {
  const explicit = folder?.artwork_path
    ? (api.isElectron ? api.fileURL(folder.artwork_path) : api.folderArtworkURL(folder.artwork_path))
    : null
  const covers = explicit ? [] : (Array.isArray(folder?.artwork_tracks) ? folder.artwork_tracks : [])
    .map(track => trackFullArtURL(track) || (track.artwork_url || (track.id ? api.artworkURL(track.id) : null)))
    .filter(Boolean)
    .slice(0, 4)

  if (explicit) return <FadeImg src={explicit} alt="" className={`h-full w-full object-cover ${className}`} />
  if (!covers.length) return null
  if (covers.length === 1) return <FadeImg src={covers[0]} alt="" className={`h-full w-full object-cover ${className}`} />

  return (
    <div className={`grid h-full w-full overflow-hidden ${covers.length === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2'} ${className}`}>
      {covers.map((src, index) => (
        <FadeImg key={src + ':' + index} src={src} alt="" className="h-full w-full min-h-0 min-w-0 object-cover" />
      ))}
    </div>
  )
}
