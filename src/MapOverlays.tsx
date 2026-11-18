import { Upload } from 'lucide-react'

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

export function DropOverlay() {
  return (
    <div className="drop-overlay">
      <div className="drop-card"><div className="drop-icon"><Upload size={23} /></div><strong>Drop your spatial data</strong><span>GeoJSON, Shapefile ZIP, KML, CSV or GeoTIFF</span><small>Files are processed locally in your browser</small></div>
    </div>
  )
}
