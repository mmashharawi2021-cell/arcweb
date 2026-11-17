import { useEffect, useRef, useState } from 'react'
import { downloadArea, planArea, type AreaBounds, type AreaPlan } from './areaDownload'
import { importOfflineBasemap, type OfflineBasemap } from './offlineBasemap'

interface Props {
  busy: boolean
  getBounds: () => AreaBounds | null
  onRun: (action: () => Promise<void>) => Promise<void>
  onDownloaded: (basemap: OfflineBasemap) => Promise<void>
}
const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })
export default function OfflineAreaDownload({ busy, getBounds, onRun, onDownloaded }: Props) {
  const [bounds, setBounds] = useState({ west: '-180', south: '-85', east: '180', north: '85' })
  const [minZoom, setMinZoom] = useState(0), [maxZoom, setMaxZoom] = useState(3)
  const [progress, setProgress] = useState<{ done: number; total: number; bytes: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  let plan: AreaPlan | undefined, problem = ''
  try { plan = planArea(Object.values(bounds).map(value => value.trim() ? Number(value) : NaN) as AreaBounds, minZoom, maxZoom) }
  catch (error) { problem = error instanceof Error ? error.message : 'Invalid area.' }
  const currentArea = () => {
    const area = getBounds()
    if (!area) return
    setBounds({ west: String(area[0]), south: String(area[1]), east: String(area[2]), north: String(area[3]) })
  }
  return <details className="offline-area-download">
    <summary>Download an area · NASA Blue Marble</summary>
    <p className="modal-note">Regional imagery, zoom 0–8; not detailed street maps. Pan/zoom the map before opening Projects, then use its current area. No API key is needed.</p>
    <button className="phase-secondary-button" disabled={busy} onClick={currentArea}>Use current map area</button>
    <div className="offline-area-fields">
      {(['west', 'south', 'east', 'north'] as const).map(key => <label key={key}><span>{key}</span><input type="number" step="any" aria-label={`Offline area ${key}`} disabled={busy} value={bounds[key]} onChange={event => setBounds(prior => ({ ...prior, [key]: event.target.value }))} /></label>)}
      <label><span>Minimum zoom</span><select aria-label="Offline minimum zoom" disabled={busy} value={minZoom} onChange={event => setMinZoom(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option key={index}>{index}</option>)}</select></label>
      <label><span>Maximum zoom</span><select aria-label="Offline maximum zoom" disabled={busy} value={maxZoom} onChange={event => setMaxZoom(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option key={index}>{index}</option>)}</select></label>
    </div>
    {plan ? <p>{plan.tiles.length.toLocaleString('en-US')} tiles · about {mb(plan.estimatedBytes)} MB (estimate). Limits: 2,000 tiles / 50 MB.</p> : <p role="status">{problem}</p>}
    <div className="library-actions">
      <button className="phase-primary-button" disabled={busy || !plan} onClick={() => {
        if (!plan || controller.current) return
        const selected = plan
        void onRun(async () => {
          const abort = new AbortController(); controller.current = abort
          setProgress({ done: 0, total: selected.tiles.length, bytes: 0 })
          try {
            const estimate = await navigator.storage?.estimate?.()
            if (estimate?.quota !== undefined && selected.estimatedBytes > estimate.quota - (estimate.usage ?? 0)) throw new Error('The estimated download exceeds available browser storage.')
            const file = await downloadArea(selected, abort.signal, (done, total, bytes) => setProgress({ done, total, bytes }))
            if (abort.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
            setSaving(true)
            const basemap = await importOfflineBasemap(file)
            if (abort.signal.aborted) throw new DOMException('Download cancelled.', 'AbortError')
            await onDownloaded(basemap)
          } finally { controller.current = null; setProgress(null); setSaving(false) }
        })
      }}>Download and save area</button>
      {progress && !saving && <button className="phase-secondary-button" onClick={() => controller.current?.abort()}>Cancel download</button>}
    </div>
    {progress && <p role="status">{saving ? 'Saving downloaded basemap…' : `Downloading ${progress.done} / ${progress.total} · ${mb(progress.bytes)} MB`}</p>}
  </details>
}
