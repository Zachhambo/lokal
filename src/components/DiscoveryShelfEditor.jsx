import React, { useRef } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import Modal from './Modal'
import { DISCOVERY_SHELF_TITLES, moveShelf, showShelf } from '../discoveryShelfLayout.mjs'
import { useTranslation } from '../i18n'

/** Desktop counterpart of Mobile's provider-specific ReorderableListView.
 * Drag and drop plus keyboard-accessible Move Up/Down; hidden shelves remain
 * available here so users can always restore them.
 */
export default function DiscoveryShelfEditor({ open, provider, layout, onChange, onClose }) {
  const { t } = useTranslation()
  const dragged = useRef(null)
  if (!layout) return null
  return (
    <Modal open={open} onClose={onClose} title={t('Edit Discovery sections')} width="max-w-lg">
      <p className="mb-4 text-sm text-muted">{t('Choose sections to show and drag to reorder. Each provider has its own saved layout.')}</p>
      <div className="space-y-2" data-discovery-layout-editor={provider}>
        {layout.order.map((id, index) => {
          const visible = !layout.hidden.includes(id)
          return (
            <div key={id} draggable
              onDragStart={event => { dragged.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) }}
              onDragOver={event => { if (dragged.current) event.preventDefault() }}
              onDrop={event => {
                event.preventDefault()
                const from = layout.order.indexOf(dragged.current)
                dragged.current = null
                if (from >= 0) onChange(moveShelf(layout, from, index))
              }}
              onDragEnd={() => { dragged.current = null }}
              className="flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2">
              <GripVertical size={17} className="shrink-0 cursor-grab text-muted" aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate text-sm ${visible ? 'text-white' : 'text-muted'}`}>{t(DISCOVERY_SHELF_TITLES[id] || id)}</span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={visible} onChange={event => onChange(showShelf(layout, id, event.target.checked))}
                  aria-label={t('Show {name}', { name: t(DISCOVERY_SHELF_TITLES[id] || id) })} className="accent-accent" />
                {t('Show')}
              </label>
              <div className="flex items-center gap-1">
                <button type="button" aria-label={t('Move {name} up', { name: t(DISCOVERY_SHELF_TITLES[id] || id) })}
                  disabled={index === 0} onClick={() => onChange(moveShelf(layout, index, index - 1))}
                  className="rounded-md p-1.5 text-muted hover:bg-white/10 hover:text-white disabled:opacity-30"><ArrowUp size={15} /></button>
                <button type="button" aria-label={t('Move {name} down', { name: t(DISCOVERY_SHELF_TITLES[id] || id) })}
                  disabled={index === layout.order.length - 1} onClick={() => onChange(moveShelf(layout, index, index + 1))}
                  className="rounded-md p-1.5 text-muted hover:bg-white/10 hover:text-white disabled:opacity-30"><ArrowDown size={15} /></button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-base">{t('Done')}</button>
      </div>
    </Modal>
  )
}
