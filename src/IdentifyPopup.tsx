import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Feature } from 'geojson'
import { ChevronLeft, ChevronRight, LocateFixed, SquareStack, Table2, X } from 'lucide-react'
import type { MapLayer } from './store'
import { useFadeExit } from './ui/useFadeExit'

export interface IdentifyHit {
  layer: MapLayer
  feature: Feature
}

interface IdentifyPopupProps {
  hits: IdentifyHit[]
  index: number
  /** Preferred top-left corner inside the map workspace, in pixels. */
  position: { x: number; y: number }
  /** Where the map was clicked, formatted in the display coordinate system. */
  location: string
  selected: boolean
  onIndexChange: (index: number) => void
  onZoom: (hit: IdentifyHit) => void
  onOpenTable: (hit: IdentifyHit) => void
  onToggleSelected: (hit: IdentifyHit) => void
  onClose: () => void
}

const titleFields = ['name', 'Name', 'NAME', 'title', 'Title', 'label', 'Label']

function displayValue(value: unknown): { text: string; kind: 'empty' | 'number' | 'link' | 'text' } {
  if (value === null || value === undefined || value === '') return { text: '<Null>', kind: 'empty' }
  if (typeof value === 'number') return { text: value.toLocaleString('en-US', { maximumFractionDigits: 6 }), kind: 'number' }
  if (typeof value === 'object') return { text: JSON.stringify(value), kind: 'text' }
  const text = String(value)
  return { text, kind: /^https?:\/\/\S+$/i.test(text) ? 'link' : 'text' }
}

/** Floating ArcGIS Pro-style pop-up listing every attribute of the identified feature. */
export default function IdentifyPopup({
  hits, index, position, location, selected, onIndexChange, onZoom, onOpenTable, onToggleSelected, onClose,
}: IdentifyPopupProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const fadeRef = useFadeExit<HTMLElement>()
  const hit = hits[index]
  if (!hit) return null
  const properties = hit.feature.properties ?? {}
  const titleField = hit.layer.labelField && properties[hit.layer.labelField] !== undefined
    ? hit.layer.labelField
    : titleFields.find((field) => properties[field] !== undefined && properties[field] !== '')
  const row = hit.layer.data.features.indexOf(hit.feature) + 1
  const title = titleField ? String(properties[titleField]) : `Feature ${row}`
  const entries = Object.entries(properties)

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const start = { x: event.clientX - offset.x, y: event.clientY - offset.y }
    const onMove = (moveEvent: PointerEvent) => setOffset({ x: moveEvent.clientX - start.x, y: moveEvent.clientY - start.y })
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <aside ref={fadeRef} className="identify-popup" role="dialog" aria-label={`Pop-up for ${title}`} style={{ left: position.x + offset.x, top: position.y + offset.y }}>
      <header onPointerDown={beginDrag} title="Drag to move">
        <span className={`geometry-icon geometry-${hit.layer.geometry.toLowerCase()}`}><span className="identify-dot" /></span>
        <div><strong dir="auto" title={title}>{title}</strong><small dir="auto" title={hit.layer.name}>{hit.layer.name}</small></div>
        {hits.length > 1 && (
          <div className="identify-pager">
            <button title="Previous feature" disabled={index === 0} onClick={() => onIndexChange(index - 1)}><ChevronLeft size={13} /></button>
            <span>{index + 1} of {hits.length}</span>
            <button title="Next feature" disabled={index === hits.length - 1} onClick={() => onIndexChange(index + 1)}><ChevronRight size={13} /></button>
          </div>
        )}
        <button className="identify-close" title="Close pop-up" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="identify-body">
        {entries.length ? (
          <dl>
            {entries.map(([field, value]) => {
              const shown = displayValue(value)
              return (
                <div key={field}>
                  <dt title={field}>{field}</dt>
                  <dd className={shown.kind} dir="auto" title={shown.text}>
                    {shown.kind === 'link' ? <a href={shown.text} target="_blank" rel="noreferrer noopener">{shown.text}</a> : shown.text}
                  </dd>
                </div>
              )
            })}
          </dl>
        ) : <div className="identify-empty">This feature has no attributes.</div>}
      </div>
      <footer>
        <span title="Clicked location">{location}</span>
        <button title="Zoom to this feature" onClick={() => onZoom(hit)}><LocateFixed size={13} /></button>
        <button className={selected ? 'active' : ''} title={selected ? 'Remove from selection' : 'Add to selection'} onClick={() => onToggleSelected(hit)}><SquareStack size={13} /></button>
        <button title="Show in attribute table" onClick={() => onOpenTable(hit)}><Table2 size={13} /></button>
      </footer>
    </aside>
  )
}
