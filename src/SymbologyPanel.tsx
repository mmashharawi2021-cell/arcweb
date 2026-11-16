import { useMemo, useState } from 'react'
import { ChevronDown, Circle, FolderOpen, Layers3, Move, MoveRight, PanelRightClose, Table2, Triangle } from 'lucide-react'
import { getCrs } from './crs'
import type { CategoricalRampId, ClassificationMethod, ContinuousRampId, MapLayer, PointShape, RendererConfig, StrokeDash } from './store'
import {
  buildGraduatedRenderer,
  buildUniqueRenderer,
  CATEGORICAL_RAMPS,
  CONTINUOUS_RAMPS,
  getFeatureFields,
  getGraduatedClasses,
  getGraduatedClassCounts,
  getNumericFields,
  getUniqueValueClasses,
  SINGLE_SYMBOL_PRESETS,
  sampleContinuousRamp,
} from './symbology'

interface SymbologyPanelProps {
  selectedLayer: MapLayer | null
  floating: boolean
  onToggleFloat: () => void
  onUpdate: (updates: Partial<MapLayer>) => void
  onAddData: () => void
}

const pointShapes: { value: PointShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
]

const classificationMethods: { value: ClassificationMethod; label: string }[] = [
  { value: 'equal-interval', label: 'Equal Interval' },
  { value: 'quantile', label: 'Quantile' },
  { value: 'natural-breaks', label: 'Natural Breaks (Jenks)' },
]

function GeometryIcon({ geometry }: { geometry: MapLayer['geometry'] }) {
  if (geometry === 'Point') return <Circle size={15} strokeWidth={2.2} />
  if (geometry === 'Line') return <MoveRight size={16} strokeWidth={2.2} />
  if (geometry === 'Polygon') return <Triangle size={15} strokeWidth={2.2} />
  if (geometry === 'Unknown') return <Table2 size={15} />
  return <Layers3 size={15} />
}

export function SymbologyPanel({ selectedLayer, floating, onToggleFloat, onUpdate, onAddData }: SymbologyPanelProps) {
  const [classificationErrorState, setClassificationErrorState] = useState<{ layerId: string; message: string } | null>(null)
  const classificationError = classificationErrorState && classificationErrorState.layerId === selectedLayer?.id
    ? classificationErrorState.message
    : ''
  const fields = useMemo(() => selectedLayer ? getFeatureFields(selectedLayer) : [], [selectedLayer])
  const numericFields = useMemo(() => selectedLayer ? getNumericFields(selectedLayer) : [], [selectedLayer])
  const uniqueRenderer = selectedLayer?.renderer.type === 'unique' ? selectedLayer.renderer : null
  const graduatedRenderer = selectedLayer?.renderer.type === 'graduated' ? selectedLayer.renderer : null

  function updateRenderer(renderer: RendererConfig) {
    onUpdate({ renderer })
  }

  function updateLabelStyle(update: Partial<MapLayer['labelStyle']>) {
    if (!selectedLayer) return
    onUpdate({ labelStyle: { ...selectedLayer.labelStyle, ...update } })
  }

  function classify(field: string, method: ClassificationMethod, count: number, ramp: ContinuousRampId) {
    if (!selectedLayer || !field) return
    try {
      updateRenderer(buildGraduatedRenderer(selectedLayer, field, method, count, ramp))
      setClassificationErrorState(null)
    } catch (error) {
      setClassificationErrorState({
        layerId: selectedLayer.id,
        message: error instanceof Error ? error.message : 'Could not classify this field.',
      })
    }
  }

  function setMode(mode: RendererConfig['type']) {
    if (!selectedLayer) return
    if (mode === 'single') {
      updateRenderer({ type: 'single' })
      setClassificationErrorState(null)
    } else if (mode === 'unique') {
      // Build the class colours now; an empty colour map drew every class in the layer's single fill colour.
      updateRenderer(buildUniqueRenderer(selectedLayer, fields[0] ?? '', 'vivid'))
    } else {
      const field = numericFields[0] ?? ''
      classify(field, 'quantile', 5, 'viridis')
      if (!field) updateRenderer({ type: 'graduated', field: '', method: 'quantile', breaks: [], colors: [], ramp: 'viridis', classCount: 5 })
    }
  }

  return (
    <aside className="dock symbology-dock">
      <div className="dock-heading">
        <div><PanelRightClose size={16} /><strong>Symbology</strong></div>
        <div className="dock-heading-actions">
          <button className="panel-float-toggle" title={floating ? 'Dock Symbology panel' : 'Float Symbology panel'} aria-label={floating ? 'Dock Symbology panel' : 'Float Symbology panel'} onClick={onToggleFloat}><Move size={13} /><span>{floating ? 'Dock' : 'Float'}</span></button>
        </div>
      </div>
      {selectedLayer ? (
        <div className="symbology-content">
          <div className="selected-layer-card">
            <span className={`geometry-icon geometry-${selectedLayer.geometry.toLowerCase()}`} aria-hidden="true"><GeometryIcon geometry={selectedLayer.geometry} /></span>
            <div><strong dir="auto">{selectedLayer.name}</strong><span>{selectedLayer.geometry === 'Unknown' ? 'Standalone table' : `${selectedLayer.geometry} features`} · {selectedLayer.data.features.length.toLocaleString()} records</span></div>
            <ChevronDown size={14} />
          </div>

          <div className="sym-section">
            <div className="section-title"><span>Symbology type</span></div>
            <div className="select-wrap"><select aria-label="Symbology type" value={selectedLayer.renderer.type} onChange={(event) => setMode(event.target.value as RendererConfig['type'])}>
              <option value="single">Single Symbol</option>
              <option value="unique">Unique Values</option>
              <option value="graduated">Graduated Colors</option>
            </select><ChevronDown size={14} /></div>
          </div>

          {selectedLayer.renderer.type === 'single' && (
            <div className="sym-section">
              <div className="section-title"><span>Single symbol</span><button title="Reset symbol" onClick={() => onUpdate({ fillColor: '#f5a623', strokeColor: '#ffe0a3', strokeWidth: 2, strokeDash: 'solid', fillOpacity: 1, pointRadius: 6, pointShape: 'circle' })}>Reset</button></div>
              <div className="single-palette-list" aria-label="Preset cartographic palettes">
                {SINGLE_SYMBOL_PRESETS.map((preset) => <button key={preset.name} className="single-palette" aria-label={`Apply ${preset.name} palette`} title={preset.name} onClick={() => onUpdate({ fillColor: preset.fillColor, strokeColor: preset.strokeColor })}><span style={{ backgroundColor: preset.fillColor, borderColor: preset.strokeColor }} /></button>)}
              </div>
              {selectedLayer.geometry !== 'Line' && <label className="color-control"><span>Fill color</span><span className="color-input"><input aria-label="Fill color" type="color" value={selectedLayer.fillColor} onChange={(event) => onUpdate({ fillColor: event.target.value })} /><code>{selectedLayer.fillColor.toUpperCase()}</code></span></label>}
              <label className="color-control"><span>{selectedLayer.geometry === 'Line' ? 'Line color' : 'Outline color'}</span><span className="color-input"><input aria-label={selectedLayer.geometry === 'Line' ? 'Line color' : 'Outline color'} type="color" value={selectedLayer.strokeColor} onChange={(event) => onUpdate({ strokeColor: event.target.value })} /><code>{selectedLayer.strokeColor.toUpperCase()}</code></span></label>
              <label className="range-control"><span>{selectedLayer.geometry === 'Line' ? 'Line width' : 'Outline width'} <b>{selectedLayer.strokeWidth.toFixed(1)} px</b></span><input aria-label={selectedLayer.geometry === 'Line' ? 'Line width' : 'Outline width'} type="range" min="0.5" max="8" step="0.5" value={selectedLayer.strokeWidth} onChange={(event) => onUpdate({ strokeWidth: Number(event.target.value) })} /></label>
              <label className="select-label" htmlFor="stroke-dash">Outline pattern</label>
              <div className="select-wrap"><select id="stroke-dash" value={selectedLayer.strokeDash} onChange={(event) => onUpdate({ strokeDash: event.target.value as StrokeDash })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select><ChevronDown size={14} /></div>
              {(selectedLayer.geometry === 'Polygon' || selectedLayer.geometry === 'Mixed') && <label className="range-control"><span>Fill opacity <b>{Math.round(selectedLayer.fillOpacity * 100)}%</b></span><input aria-label="Fill opacity" type="range" min="0" max="1" step="0.05" value={selectedLayer.fillOpacity} onChange={(event) => onUpdate({ fillOpacity: Number(event.target.value) })} /></label>}
              {(selectedLayer.geometry === 'Point' || selectedLayer.geometry === 'Mixed') && <>
                <label className="range-control"><span>Marker size <b>{selectedLayer.pointRadius} px</b></span><input aria-label="Marker size" type="range" min="2" max="18" step="1" value={selectedLayer.pointRadius} onChange={(event) => onUpdate({ pointRadius: Number(event.target.value) })} /></label>
                <label className="select-label" htmlFor="point-shape">Marker shape</label>
                <div className="select-wrap"><select id="point-shape" value={selectedLayer.pointShape} onChange={(event) => onUpdate({ pointShape: event.target.value as PointShape })}>{pointShapes.map((shape) => <option key={shape.value} value={shape.value}>{shape.label}</option>)}</select><ChevronDown size={14} /></div>
              </>}
            </div>
          )}

          {selectedLayer.renderer.type === 'unique' && (
            <div className="sym-section">
              <div className="section-title"><span>Unique values</span></div>
              <label className="select-label" htmlFor="unique-field">Value field</label>
              <div className="select-wrap"><select id="unique-field" value={uniqueRenderer?.field ?? ''} onChange={(event) => updateRenderer(buildUniqueRenderer(selectedLayer, event.target.value, uniqueRenderer?.ramp ?? 'vivid'))}>
                {fields.map((field) => <option key={field} value={field}>{field}</option>)}
              </select><ChevronDown size={14} /></div>
              <label className="select-label" htmlFor="categorical-ramp">Color palette</label>
              <div className="select-wrap"><select id="categorical-ramp" value={uniqueRenderer?.ramp ?? 'vivid'} onChange={(event) => {
                if (!uniqueRenderer?.field) return
                updateRenderer(buildUniqueRenderer(selectedLayer, uniqueRenderer.field, event.target.value as CategoricalRampId, uniqueRenderer))
              }}>
                {Object.entries(CATEGORICAL_RAMPS).map(([id, ramp]) => <option key={id} value={id}>{ramp.name}</option>)}
              </select><ChevronDown size={14} /></div>
              <button className="sym-action-button" disabled={!uniqueRenderer?.field} onClick={() => {
                if (!uniqueRenderer?.field) return
                updateRenderer(buildUniqueRenderer(selectedLayer, uniqueRenderer.field, uniqueRenderer.ramp ?? 'vivid', uniqueRenderer))
              }}>Generate / Add All Values</button>
              {uniqueRenderer?.field && <div className="class-list">
                {getUniqueValueClasses(selectedLayer, uniqueRenderer.field, uniqueRenderer).map((item) => <label className="class-row" key={item.value}>
                  <input aria-label={`Color for ${item.label}`} type="color" value={item.color} onChange={(event) => updateRenderer({
                    ...uniqueRenderer,
                    colors: { ...uniqueRenderer.colors, [item.value]: event.target.value },
                    overrides: [...new Set([...(uniqueRenderer.overrides ?? []), item.value])],
                  })} />
                  <span className="class-label" title={item.label}>{item.label}</span><small>{item.count.toLocaleString()}</small>
                </label>)}
                {!getUniqueValueClasses(selectedLayer, uniqueRenderer.field).length && <span className="class-empty">No values in this field.</span>}
              </div>}
            </div>
          )}

          {selectedLayer.renderer.type === 'graduated' && (
            <div className="sym-section">
              <div className="section-title"><span>Graduated colors</span></div>
              <label className="select-label" htmlFor="graduated-field">Numeric field</label>
              <div className="select-wrap"><select id="graduated-field" value={graduatedRenderer?.field ?? ''} onChange={(event) => classify(event.target.value, graduatedRenderer?.method ?? 'quantile', graduatedRenderer?.classCount ?? 5, graduatedRenderer?.ramp ?? 'viridis')}>
                {numericFields.map((field) => <option key={field} value={field}>{field}</option>)}
                {!numericFields.length && <option value="">No numeric fields</option>}
              </select><ChevronDown size={14} /></div>
              <label className="select-label" htmlFor="classification-method">Classification method</label>
              <div className="select-wrap"><select id="classification-method" value={graduatedRenderer?.method ?? 'quantile'} onChange={(event) => classify(graduatedRenderer?.field ?? '', event.target.value as ClassificationMethod, graduatedRenderer?.classCount ?? 5, graduatedRenderer?.ramp ?? 'viridis')}>
                {classificationMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
              </select><ChevronDown size={14} /></div>
              <label className="select-label" htmlFor="graduated-count">Number of classes</label>
              <div className="select-wrap"><select id="graduated-count" value={graduatedRenderer?.classCount ?? Math.max(3, graduatedRenderer?.colors.length ?? 5)} onChange={(event) => classify(graduatedRenderer?.field ?? '', graduatedRenderer?.method ?? 'quantile', Number(event.target.value), graduatedRenderer?.ramp ?? 'viridis')}>
                {[3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count}</option>)}
              </select><ChevronDown size={14} /></div>
              <label className="select-label" htmlFor="continuous-ramp">Color ramp</label>
              <div className="select-wrap"><select id="continuous-ramp" value={graduatedRenderer?.ramp ?? 'viridis'} onChange={(event) => {
                if (!graduatedRenderer) return
                const ramp = event.target.value as ContinuousRampId
                updateRenderer({ ...graduatedRenderer, ramp, colors: sampleContinuousRamp(ramp, graduatedRenderer.breaks.length + 1) })
              }}>
                {Object.entries(CONTINUOUS_RAMPS).map(([id, ramp]) => <option key={id} value={id}>{ramp.name}</option>)}
              </select><ChevronDown size={14} /></div>
              {classificationError && <p className="classification-error" role="alert">{classificationError}</p>}
              {graduatedRenderer && graduatedRenderer.breaks.length > 0 && <div className="class-list graduated-class-list">
                {getGraduatedClasses(graduatedRenderer).map((item, index) => <label className="class-row graduated-class-row" key={item.value}>
                  <input aria-label={`Color for class ${index + 1}`} type="color" value={item.color} onChange={(event) => {
                    const colors = [...graduatedRenderer.colors]
                    colors[index] = event.target.value
                    updateRenderer({ ...graduatedRenderer, colors })
                  }} />
                  <input className="class-label-input" aria-label={`Label for class ${index + 1}`} value={item.label} onChange={(event) => {
                    const labels = getGraduatedClasses(graduatedRenderer).map((entry) => entry.label)
                    labels[index] = event.target.value
                    updateRenderer({ ...graduatedRenderer, labels })
                  }} />
                  <small>{getGraduatedClassCounts(selectedLayer, graduatedRenderer)[index].toLocaleString()}</small>
                </label>)}
              </div>}
            </div>
          )}

          <div className="sym-section labels-section">
            <div className="section-title"><span>Label manager</span><label className="label-toggle"><input type="checkbox" checked={selectedLayer.labelStyle.enabled} onChange={(event) => updateLabelStyle({ enabled: event.target.checked })} /><span>Labels</span></label></div>
            <label className="select-label" htmlFor="label-field">Label field</label>
            <div className="select-wrap"><select id="label-field" value={selectedLayer.labelField} onChange={(event) => {
              onUpdate({ labelField: event.target.value, labelStyle: { ...selectedLayer.labelStyle, enabled: Boolean(event.target.value) || selectedLayer.labelStyle.enabled } })
            }}><option value="">Choose a field</option>{fields.map((field) => <option key={field} value={field}>{field}</option>)}</select><ChevronDown size={14} /></div>
            <label className="select-label" htmlFor="label-expression">Custom expression</label>
            <input id="label-expression" className="sym-text-input" placeholder="{NAME} ({POP})" value={selectedLayer.labelStyle.expression} onChange={(event) => updateLabelStyle({ expression: event.target.value })} />
            <div className="label-style-grid">
              <label className="label-style-control"><span>Text size</span><input aria-label="Label font size" type="number" min="6" max="48" value={selectedLayer.labelStyle.fontSize} onChange={(event) => updateLabelStyle({ fontSize: Math.max(6, Math.min(48, Number(event.target.value) || 11)) })} /></label>
              <label className="label-style-control"><span>Placement</span><select aria-label="Label placement" value={selectedLayer.labelStyle.placement} onChange={(event) => updateLabelStyle({ placement: event.target.value as 'point' | 'line' })}><option value="point">Point / area</option><option value="line">Along line</option></select></label>
              <label className="color-control"><span>Text color</span><input aria-label="Label text color" type="color" value={selectedLayer.labelStyle.color} onChange={(event) => updateLabelStyle({ color: event.target.value })} /></label>
              <label className="color-control"><span>Halo color</span><input aria-label="Label halo color" type="color" value={selectedLayer.labelStyle.haloColor.startsWith('#') ? selectedLayer.labelStyle.haloColor : '#12161e'} onChange={(event) => updateLabelStyle({ haloColor: event.target.value })} /></label>
              <label className="label-style-control"><span>Halo width</span><input aria-label="Label halo width" type="number" min="0" max="8" step="0.2" value={selectedLayer.labelStyle.haloWidth} onChange={(event) => updateLabelStyle({ haloWidth: Math.max(0, Math.min(8, Number(event.target.value) || 0)) })} /></label>
              <label className="label-style-control"><span>Offset</span><input aria-label="Label offset" type="number" min="-5" max="5" step="0.1" value={selectedLayer.labelStyle.offset} onChange={(event) => updateLabelStyle({ offset: Math.max(-5, Math.min(5, Number(event.target.value) || 0)) })} /></label>
            </div>
            <div className="label-note"><span className="label-preview">Aa</span><span>MapLibre shapes Arabic glyphs when the active glyph source includes Arabic characters.</span></div>
          </div>

          <div className="layer-info">
            <div><span>Source</span><strong>Local file</strong></div>
            <div><span>Spatial reference</span><strong title="Source spatial reference; geometry is stored in WGS 84">{getCrs(selectedLayer.sourceCrs)?.name ?? selectedLayer.sourceCrs} {getCrs(selectedLayer.sourceCrs) && <small>{getCrs(selectedLayer.sourceCrs)?.code}</small>}</strong></div>
            <div><span>Features</span><strong>{selectedLayer.data.features.length.toLocaleString()}</strong></div>
          </div>
        </div>
      ) : (
        <div className="symbology-empty"><div className="empty-glyph"><PanelRightClose size={20} /></div><strong>Select a layer</strong><span>Choose a layer in Contents to edit its appearance and labels.</span><button onClick={onAddData}><FolderOpen size={14} /> Add data</button></div>
      )}
      <div className="symbology-footer"><span>Layer properties</span><span className="properties-status"><span />Ready</span></div>
    </aside>
  )
}
