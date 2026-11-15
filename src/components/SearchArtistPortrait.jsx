import React, { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { api } from '../api'
import QualityImage from './QualityImage'

import { peekSearchArtistPortrait, resolveSearchArtistPortrait } from '../artistPortraitLookup'

/** Prefer stored artist portrait, then exact-name Deezer artist image.
 * Fetches are cached, bounded and do not block listing the text results. */
export default function SearchArtistPortrait({ name, localPath, imageUrl, className = 'w-full h-full object-cover', allowNameLookup = true, preferNameLookup = false, fallback = null }) {
  const [external, setExternal] = useState(() => peekSearchArtistPortrait(name))
  const [brokenLocal, setBrokenLocal] = useState(false)
  const [brokenRemoteUrl, setBrokenRemoteUrl] = useState('')
  const local = localPath && !brokenLocal
    ? (api.isElectron ? `file://${localPath}` : null) : null
  const known = /^https:\/\//.test(String(imageUrl || '')) ? imageUrl : ''
  useEffect(() => {
    setExternal(peekSearchArtistPortrait(name)); setBrokenLocal(false); setBrokenRemoteUrl('')
  }, [name, localPath, known])
  useEffect(() => {
    let alive = true
    if (allowNameLookup && (!known || preferNameLookup) && (!localPath || !api.isElectron || brokenLocal)) {
      resolveSearchArtistPortrait(name).then(value => { if (alive) setExternal(value) })
    }
    return () => { alive = false }
  }, [name, known, localPath, brokenLocal, allowNameLookup, preferNameLookup])
  if (local) return <img src={local} alt={name} className={className} onError={() => setBrokenLocal(true)} />
  // Apple Search usually has no native portrait. Previously saved Apple
  // artwork may not match the Deezer portrait displayed in Search.
  const url = preferNameLookup && allowNameLookup ? (external || known) : (known || external)
  return url && url !== brokenRemoteUrl
    ? <QualityImage src={url} alt={name} className={className} onError={() => setBrokenRemoteUrl(url)} />
    : (fallback || <User size={20} aria-label={name} />)
}
