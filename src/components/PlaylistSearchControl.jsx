import { Search, X } from 'lucide-react'
import { useTranslation } from '../i18n'

export default function PlaylistSearchControl({ open, setOpen, query, setQuery, buttonClassName }) {
  const { t } = useTranslation()
  const label = t('Search this playlist')
  const close = () => { setOpen(false); setQuery('') }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label} className={buttonClassName}>
      <Search size={17} />
    </button>
  )
  return (
    <div className="mx-1 flex w-64 items-center gap-2 rounded-full border border-accent/40 bg-elevated px-3.5 py-2 text-sm text-white focus-within:border-accent">
      <Search size={15} className="shrink-0 text-muted" />
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') close() }}
        placeholder={label} aria-label={label} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
      <button type="button" onClick={close} aria-label={t('Close playlist search')} className="shrink-0 text-muted hover:text-white">
        <X size={15} />
      </button>
    </div>
  )
}
