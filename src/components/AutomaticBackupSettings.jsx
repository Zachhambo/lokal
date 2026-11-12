import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useTranslation } from '../i18n'

export default function AutomaticBackupSettings() {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.automaticBackupStatus().then(value => {
      if (active) setStatus(value)
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  async function action(callback) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await callback()
      if (result?.error) throw new Error(result.error)
      setStatus(result)
    } catch (e) { setError(e.message || 'Automatic backup failed.') }
    finally { setBusy(false) }
  }
  const date = ms => ms ? new Date(ms).toLocaleString() : t('Never')
  return (
    <div className="space-y-3" data-testid="automatic-backups">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-white">{t('Automatic backups')}</p>
          <p className="text-xs text-muted mt-1">{t('Save settings, profiles, playlists and listening history while Lokal runs. Keep the 10 newest automatic backups.')}</p>
        </div>
        <select aria-label={t('Automatic backup frequency')} disabled={!status || busy}
          value={status?.frequency || 'off'}
          onChange={e => action(() => api.automaticBackupConfigure({ frequency: e.target.value }))}
          className="px-3 py-2 bg-card border border-border rounded-lg text-sm">
          <option value="off">{t('Off')}</option>
          <option value="daily">{t('Daily')}</option>
          <option value="weekly">{t('Weekly')}</option>
        </select>
      </div>
      <div className="text-xs text-muted break-all">
        {t('Backup location')}: {status?.directory || '…'}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!status || busy} className="px-3 py-2 bg-card border border-border rounded-lg text-sm disabled:opacity-50"
          onClick={() => action(() => api.automaticBackupChooseFolder())}>{t('Choose folder')}</button>
        <button disabled={!status || busy} className="px-3 py-2 bg-card border border-border rounded-lg text-sm disabled:opacity-50"
          onClick={() => action(() => api.automaticBackupRunNow())}>{busy ? t('Working…') : t('Back up now')}</button>
        <button disabled={!status || busy} className="px-3 py-2 bg-card border border-border rounded-lg text-sm disabled:opacity-50"
          onClick={() => action(async () => { const result = await api.automaticBackupOpenFolder(); if (result?.error) throw new Error(result.error); return api.automaticBackupStatus() })}>{t('Open backup folder')}</button>
      </div>
      <p className="text-xs text-muted">{t('Last successful backup')}: {date(status?.lastSuccess)}</p>
      <p className="text-xs text-muted">{t('Backups are local, and run when the desktop app is open. They are not encrypted; use a private folder and keep a copy outside the device. Restore through Import Backup above.')}</p>
      {!!status?.lastError && <p role="alert" className="text-xs text-red-400">
        {t('Last scheduled backup failed')}: {status.lastError}
      </p>}
      {!!error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
