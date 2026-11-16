import { useState } from 'react'
import { Download, FileImage, FileJson2, Layers3, MousePointer2, Plus, Trash2 } from 'lucide-react'
import type { MapLayer, ToolMode } from './store'

interface EditPanelProps {
  layers: MapLayer[]
  selectedLayer: MapLayer | null
  selectedFeatureIsEditable: boolean
  tool: ToolMode
  onCreateLayer: (name: string, geometry: 'Point' | 'Line' | 'Polygon', fields: string[]) => void
  onSetTool: (tool: ToolMode) => void
  onDeleteFeature: () => void
  onOpenTable: () => void
  onFinishSketch: () => void
}

const drawTools: { id: ToolMode; label: string }[] = [
  { id: 'draw-point', label: 'Point' },
  { id: 'draw-line', label: 'Line' },
  { id: 'draw-polygon', label: 'Polygon' },
  { id: 'move-vertex', label: 'Move vertex' },
]

export function EditPanel({
  layers, selectedLayer, selectedFeatureIsEditable, tool, onCreateLayer, onSetTool, onDeleteFeature, onOpenTable, onFinishSketch,
}: EditPanelProps) {
  const [name, setName] = useState('')
  const [geometry, setGeometry] = useState<'Point' | 'Line' | 'Polygon'>('Point')
  const [fieldList, setFieldList] = useState('')

  const create = () => {
    const fields = [...new Set(fieldList.split(',').map((field) => field.trim()).filter(Boolean))]
    onCreateLayer(name, geometry, fields)
    setName('')
    setFieldList('')
  }

  return (
    <div className="phase-panel edit-panel">
      <header className="phase-panel-heading">
        <div className="phase-panel-icon"><MousePointer2 size={17} /></div>
        <div><strong>Feature editing</strong><span>Sketch and modify vector features</span></div>
      </header>
      <div className="phase-panel-body">
        <div className="phase-section-title">Create an editable layer</div>
        <label className="phase-field-label" htmlFor="new-layer-name">Layer name</label>
        <input id="new-layer-name" className="phase-text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Field observations" />
        <label className="phase-field-label" htmlFor="new-layer-geometry">Geometry type</label>
        <div className="phase-select-wrap">
          <select id="new-layer-geometry" value={geometry} onChange={(event) => setGeometry(event.target.value as 'Point' | 'Line' | 'Polygon')}>
            <option value="Point">Point</option><option value="Line">Line</option><option value="Polygon">Polygon</option>
          </select>
        </div>
        <label className="phase-field-label" htmlFor="new-layer-fields">Attribute fields <span>(comma separated)</span></label>
        <input id="new-layer-fields" className="phase-text-input" value={fieldList} onChange={(event) => setFieldList(event.target.value)} placeholder="name, category, notes" />
        <button className="phase-secondary-button" disabled={!name.trim()} onClick={create}><Plus size={14} />Create layer</button>

        <div className="phase-panel-separator" />
        <div className="phase-section-title">Sketch features</div>
        <label className="phase-field-label" htmlFor="editing-layer">Target layer</label>
        <div className="phase-selected-layer" id="editing-layer">
          <Layers3 size={14} />
          <strong>{selectedLayer?.name ?? 'Select a layer in Contents'}</strong>
          <span>{selectedLayer?.geometry ?? '—'}</span>
        </div>
        <div className="draw-tool-grid">
          {drawTools.map((item) => (
            <button key={item.id} className={tool === item.id ? 'active' : ''} disabled={!selectedLayer || (item.id === 'move-vertex' && !selectedFeatureIsEditable)} onClick={() => onSetTool(tool === item.id ? 'pan' : item.id)}>
              <span className={`draw-tool-symbol draw-${item.label.toLowerCase()}`} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="tool-hint"><MousePointer2 size={13} /><span>{tool === 'move-vertex' ? 'Click within 18 px of a vertex, then click its new location. Vertices snap within 10 px.' : 'Click to add vertices; double-click to finish lines and polygons. Vertices snap within 10 px.'}</span></div>
        {tool === 'draw-line' || tool === 'draw-polygon' ? <button className="phase-secondary-button" onClick={onFinishSketch}>Finish sketch</button> : null}
        <button className="phase-secondary-button" disabled={!selectedFeatureIsEditable} onClick={onOpenTable}>Edit selected attributes</button>
        <button className="phase-danger-button" disabled={!selectedFeatureIsEditable} onClick={onDeleteFeature}><Trash2 size={13} />Delete selected feature</button>
      </div>
      <footer className="phase-panel-footer"><span>{layers.length} layers</span><span className="panel-status-dot" />Edits saved locally</footer>
    </div>
  )
}

interface SharePanelProps {
  layers: MapLayer[]
  selectedLayerId: string | null
  layoutExporting: boolean
  onExportLayer: (layer: MapLayer, format: 'geojson' | 'csv') => void
  onExportImage: () => void
  onExportLayout: (format: 'png' | 'pdf', dpi: number) => void
}

export function SharePanel({ layers, selectedLayerId, layoutExporting, onExportLayer, onExportImage, onExportLayout }: SharePanelProps) {
  const [layerId, setLayerId] = useState(selectedLayerId ?? '')
  const [dpi, setDpi] = useState(200)
  const layer = layers.find((item) => item.id === layerId)

  return (
    <div className="phase-panel share-panel">
      <header className="phase-panel-heading">
        <div className="phase-panel-icon"><Download size={17} /></div>
        <div><strong>Export and share</strong><span>Save browser-created outputs</span></div>
      </header>
      <div className="phase-panel-body">
        <div className="phase-section-title">Export a layer</div>
        <label className="phase-field-label" htmlFor="export-layer">Layer</label>
        <div className="phase-select-wrap">
          <select id="export-layer" value={layerId} onChange={(event) => setLayerId(event.target.value)}>
            <option value="">Choose a layer</option>
            {layers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="export-choice-list">
          <button disabled={!layer} onClick={() => layer && onExportLayer(layer, 'geojson')}><FileJson2 size={17} /><span><strong>GeoJSON</strong><small>Features with geometry and properties</small></span><Download size={13} /></button>
          <button disabled={!layer} onClick={() => layer && onExportLayer(layer, 'csv')}><span className="csv-file-icon">CSV</span><span><strong>CSV</strong><small>Attribute columns and geometry JSON</small></span><Download size={13} /></button>
        </div>
        <div className="phase-panel-separator" />
        <div className="phase-section-title">Export map view</div>
        <button className="layout-export-card" onClick={onExportImage}><span className="layout-preview"><FileImage size={20} /></span><span><strong>Map canvas · PNG</strong><small>Export the current canvas at 2× output dimensions.</small></span><Download size={14} /></button>
        <div className="phase-panel-separator" />
        <div className="phase-section-title">Export Layout</div>
        <label className="phase-field-label" htmlFor="share-layout-dpi">Resolution</label>
        <div className="phase-select-wrap">
          <select id="share-layout-dpi" value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
            <option value={150}>150 dpi — draft</option>
            <option value={200}>200 dpi</option>
            <option value={300}>300 dpi — print quality</option>
          </select>
        </div>
        <div className="export-choice-list">
          <button disabled={layoutExporting} onClick={() => onExportLayout('png', dpi)}><FileImage size={17} /><span><strong>Layout · PNG</strong><small>The composed sheet with title, legend, north arrow and scale bar</small></span><Download size={13} /></button>
          <button disabled={layoutExporting} onClick={() => onExportLayout('pdf', dpi)}><span className="csv-file-icon">PDF</span><span><strong>Layout · PDF</strong><small>Single page at true paper size, ready to print</small></span><Download size={13} /></button>
        </div>
        <div className="tool-hint"><MousePointer2 size={13} /><span>Exports are generated locally; no data is uploaded.</span></div>
      </div>
      <footer className="phase-panel-footer"><span>{layers.length} exportable layers</span><span className="panel-status-dot" />Local export</footer>
    </div>
  )
}
