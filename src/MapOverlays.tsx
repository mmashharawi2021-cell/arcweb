import { AreaChart, Check, MousePointer2, Ruler, Trash2, Upload, X } from 'lucide-react'
import { distanceBetween, formatDistance, polygonArea } from './mapGeometry'

/** Floating cards drawn over the map canvas: progress, measurement, sketching and drop target. */

export function ImportProgress({ file, onCancel }: { file: { name: string; index: number; total: number }; onCancel: () => void }) {
  return (
    <div className="import-progress" role="status" aria-live="polite">
      <span className="import-spinner" aria-hidden="true" />
      <span className="import-progress-copy"><strong>Loading {file.name}</strong><small>Reading local data · file {file.index} of {file.total}</small></span>
      <button type="button" className="import-cancel" onClick={onCancel}>Cancel</button>
      <span className="import-progress-track"><span /></span>
    </div>
  )
}

export function ToolProgress({ progress }: { progress: { name: string; current: number; total: number; message: string } }) {
  return (
    <div className="tool-execution-progress" role="status" aria-live="polite">
      <span className="import-spinner" aria-hidden="true" />
      <span className="import-progress-copy"><strong>{progress.name}</strong><small>{progress.message} · {progress.current} of {progress.total}</small></span>
      <span className="tool-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, progress.current / Math.max(1, progress.total) * 100))}%` }} /></span>
    </div>
  )
}

interface MeasurementCardProps {
  mode: 'distance' | 'area'
  points: [number, number][]
  onClear: () => void
  onFinish: () => void
}

export function MeasurementCard({ mode, points, onClear, onFinish }: MeasurementCardProps) {
  const length = points.slice(1).reduce((sum, point, index) => sum + distanceBetween(points[index], point), 0)
  const area = polygonArea(points)
  return (
    <div className="measurement-card">
      <div className="measurement-icon">{mode === 'distance' ? <Ruler size={15} /> : <AreaChart size={15} />}</div>
      <div><strong>{mode === 'distance' ? 'Measure distance' : 'Measure area'}</strong><span>{points.length < (mode === 'area' ? 3 : 2) ? 'Click map to add vertices' : mode === 'distance' ? formatDistance(length) : `${(area / 1_000_000).toFixed(3)} km²`}</span></div>
      <button title="Clear measurement" onClick={onClear}><Trash2 size={14} /></button>
      <button title="Finish measurement" onClick={onFinish}><Check size={15} /></button>
    </div>
  )
}

interface SketchCardProps {
  mode: 'draw-line' | 'draw-polygon'
  vertexCount: number
  onCancel: () => void
  onFinish: () => void
}

export function SketchCard({ mode, vertexCount, onCancel, onFinish }: SketchCardProps) {
  return (
    <div className="measurement-card sketch-card">
      <div className="measurement-icon"><MousePointer2 size={15} /></div>
      <div><strong>{mode === 'draw-line' ? 'Sketch line' : 'Sketch polygon'}</strong><span>{vertexCount} vertices · double-click to finish</span></div>
      <button title="Cancel sketch" onClick={onCancel}><X size={14} /></button>
      <button title="Finish sketch" onClick={onFinish}><Check size={15} /></button>
    </div>
  )
}

export function DropOverlay() {
  return (
    <div className="drop-overlay">
      <div className="drop-card"><div className="drop-icon"><Upload size={23} /></div><strong>Drop your spatial data</strong><span>GeoJSON, Shapefile ZIP, KML, CSV or GeoTIFF</span><small>Files are processed locally in your browser</small></div>
    </div>
  )
}
