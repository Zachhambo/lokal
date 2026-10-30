import React, { useState } from 'react'
import { api } from '../api'

/// Import a NAS through an OS-mounted library root. Windows accepts smb://
/// and UNC directly; other platforms accept a mounted absolute path. The
/// operating system handles credentials — Lokal never captures passwords.
export default function NetworkShareSettings({ onConnected }) {
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  if (!api.isElectron) return null

  async function connect(event) {
    event.preventDefault()
    if (!location.trim() || busy) return
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const result = await api.connectNetworkShare(location.trim())
      if (result?.error) throw new Error(result.error)
      if (!result?.folders?.length) throw new Error('No accessible music folder was added.')
      setMessage('Network library added. The share remains in your Library roots; rescan after reconnecting if the NAS goes offline.')
      setLocation('')
      onConnected?.(result)
    } catch (error) {
      setFailed(true)
      setMessage(error?.message || 'Could not open this share.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={connect} className="space-y-3">
      <p className="text-xs text-muted leading-relaxed">
        Add music from an SMB or WebDAV share via the operating system.
        Windows accepts <code>smb://server/share</code> or an HTTPS WebDAV
        URL such as <code>https://192.168.8.1:6008/disk1_part1</code>.
        SMB uses Windows credentials; HTTPS WebDAV uses Windows WebClient
        and requires the NAS certificate to be trusted by Windows. For
        password-protected WebDAV, first open the WebDAV location in Windows
        File Explorer and sign in with your NAS account, then add it here.
        On macOS/Linux, mount the share first and enter its absolute folder
        path. Lokal does not store network passwords.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          value={location}
          onChange={event => setLocation(event.target.value)}
          placeholder="smb://nas/share, https://nas:6008/share or /mnt/music"
          aria-label="Network library location"
          className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-white"
        />
        <button type="submit" disabled={!location.trim() || busy}
          className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-white disabled:opacity-50">
          {busy ? 'Connecting…' : 'Add network library'}
        </button>
      </div>
      {message && <p role={failed ? 'alert' : 'status'}
        className={failed ? 'text-xs text-red-400' : 'text-xs text-muted'}>{message}</p>}
    </form>
  )
}
