import { Calculator, Download, Eye, Layers, Paintbrush, Tag, Table2, ScanSearch, Eraser, Focus, Box } from 'lucide-react'
import type { MapLayer, RendererConfig } from '../store'
import { getFeatureFields, getNumericFields } from '../symbology'
import { RibbonButton, RibbonGroup, RibbonMenuButton } from './RibbonParts'
import { RibbonGroupBar } from './RibbonGroupBar'
export { RasterLayerRibbon } from './ContextualRibbons'

interface Props {
  tab: 'FeatureAppearance' | 'FeatureLabeling' | 'FeatureData'
  layer: MapLayer
  currentScale: () => number | undefined
  onUpdate: (update: Partial<MapLayer>) => void
  onSymbology: (renderer?: RendererConfig['type'], labels?: boolean) => void
  onTable: () => void
  onCalculate: () => void
  onSelect: () => void
  onZoomSelection: () => void
  onClear: () => void
  hasSelection: boolean
  onExport: (format: 'geojson' | 'csv') => void
}
const SCALES = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000, 50000000]

export function FeatureLayerRibbon({ tab, layer, currentScale, onUpdate, onSymbology, onTable, onCalculate, onSelect, onZoomSelection, onClear, hasSelection, onExport }: Props) {
  const fields = getFeatureFields(layer)
  const numeric = getNumericFields(layer)
  const style = layer.labelStyle
  const label = (update: Partial<MapLayer['labelStyle']>) => onUpdate({ labelStyle: { ...style, ...update } })
  const range = (key: 'minScale' | 'maxScale', value: number | undefined) => {
    // Each menu keeps the opposite limit valid rather than creating an empty range.
    const other = key === 'minScale' ? 'maxScale' : 'minScale'
    const conflict = value !== undefined && layer[other] !== undefined && (key === 'minScale' ? value <= layer[other]! : value >= layer[other]!)
    onUpdate({ [key]: value, ...(conflict ? { [other]: undefined } : {}) })
  }
  if (tab === 'FeatureAppearance') return <RibbonGroupBar>
    <RibbonGroup label="Visibility Range" icon={Eye}>
      {(['minScale', 'maxScale'] as const).map(key => <label className="ctx-field" key={key}>
        <span>{key === 'minScale' ? 'Out Beyond' : 'In Beyond'}</span>
        <select aria-label={key === 'minScale' ? 'Out Beyond' : 'In Beyond'} value={layer[key] ?? ''} onChange={e => { const value = e.target.value === 'current' ? currentScale() : e.target.value ? Number(e.target.value) : undefined; range(key, value) }}>
          <option value="">None</option><option value="current">Current</option>
          {layer[key] !== undefined && !SCALES.includes(layer[key]!) && <option value={layer[key]}>1:{Math.round(layer[key]!).toLocaleString()}</option>}
          {SCALES.map(scale => <option key={scale} value={scale}>1:{scale.toLocaleString()}</option>)}
        </select>
      </label>)}
    </RibbonGroup>
    <RibbonGroup label="Effects" icon={Eye}>
      <label className="ctx-field"><span>Transparency <output>{Math.round((1 - layer.opacity) * 100)}%</output></span><input aria-label="Transparency" type="range" min="0" max="100" value={Math.round((1 - layer.opacity) * 100)} onChange={e => onUpdate({ opacity: 1 - Number(e.target.value) / 100 })} /></label>
    </RibbonGroup>
    <RibbonGroup label="Drawing" icon={Paintbrush}>
      <RibbonMenuButton id="layer-symbology" label="Symbology" icon={Paintbrush} size="large" items={[
        { id: 'single', label: 'Single Symbol', onSelect: () => onSymbology('single') },
        { id: 'unique', label: 'Unique Values', disabled: !fields.length, onSelect: () => onSymbology('unique') },
        { id: 'graduated', label: 'Graduated Colors', disabled: !numeric.length, onSelect: () => onSymbology('graduated') },
      ]} />
    </RibbonGroup>
    <RibbonGroup label="Extrusion" icon={Box}>
      <label className="ctx-field"><span>Height field</span><select aria-label="Extrusion field" disabled={!['Polygon', 'Mixed'].includes(layer.geometry)} value={layer.extrusion?.field ?? ''} onChange={e => onUpdate({ extrusion: e.target.value ? { field: e.target.value, multiplier: layer.extrusion?.multiplier ?? 1 } : null })}><option value="">None</option>{numeric.map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="ctx-field ctx-field-narrow"><span>Multiplier</span><input aria-label="Extrusion multiplier" type="number" min="0" step="0.1" disabled={!layer.extrusion} value={layer.extrusion?.multiplier ?? 1} onChange={e => { if (layer.extrusion && e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onUpdate({ extrusion: { ...layer.extrusion, multiplier: Math.max(0, e.target.valueAsNumber) } }) }} /></label>
    </RibbonGroup>
  </RibbonGroupBar>
  if (tab === 'FeatureLabeling') return <RibbonGroupBar>
    <RibbonGroup label="Layer" icon={Tag}><RibbonButton id="layer-labels" label="Label" icon={Tag} size="large" pressed={style.enabled} disabled={!fields.length && !style.expression} onClick={() => onUpdate({ labelField: layer.labelField || fields[0] || '', labelStyle: { ...style, enabled: !style.enabled } })} /></RibbonGroup>
    <RibbonGroup label="Label Class" icon={Tag}>
      <label className="ctx-field"><span>Field</span><select aria-label="Label field" value={layer.labelField} onChange={e => onUpdate({ labelField: e.target.value })}><option value="">None</option>{fields.map(f => <option key={f} value={f}>{layer.fieldAliases?.[f] || f}</option>)}</select></label>
      <RibbonButton id="label-expression" label="Expression..." icon={Calculator} size="small" onClick={() => onSymbology(undefined, true)} />
    </RibbonGroup>
    <RibbonGroup label="Text Symbol" icon={Tag}>
      <label className="ctx-field ctx-field-narrow"><span>Size</span><input aria-label="Label size" type="number" min="6" max="48" value={style.fontSize} onChange={e => { if (e.target.value) label({ fontSize: Math.max(6, Math.min(48, Number(e.target.value))) }) }} /></label>
      <label className="ctx-field ctx-field-narrow"><span>Color</span><input aria-label="Label color" type="color" value={style.color} onChange={e => label({ color: e.target.value })} /></label>
      <label className="ctx-field ctx-field-narrow"><span>Halo</span><input aria-label="Halo color" type="color" value={style.haloColor.startsWith('#') ? style.haloColor : '#12161e'} onChange={e => label({ haloColor: e.target.value })} /></label>
      <label className="ctx-field ctx-field-narrow"><span>Halo width</span><input aria-label="Halo width" type="number" min="0" max="8" step="0.1" value={style.haloWidth} onChange={e => { if (e.target.value) label({ haloWidth: Math.max(0, Math.min(8, Number(e.target.value))) }) }} /></label>
    </RibbonGroup>
    <RibbonGroup label="Placement" icon={Layers}>
      <label className="ctx-field"><span>Placement</span><select aria-label="Label placement" value={style.placement} onChange={e => label({ placement: e.target.value as 'point' | 'line' })}><option value="point">Point / area</option><option value="line">Along line</option></select></label>
      <label className="ctx-field ctx-field-narrow"><span>Offset</span><input aria-label="Label offset" type="number" min="-10" max="10" step="0.1" value={style.offset} onChange={e => { if (e.target.value) label({ offset: Math.max(-10, Math.min(10, Number(e.target.value))) }) }} /></label>
    </RibbonGroup>
  </RibbonGroupBar>
  return <RibbonGroupBar>
    <RibbonGroup label="Table" icon={Table2}><RibbonButton id="layer-table" label="Attribute Table" icon={Table2} size="large" onClick={onTable} /></RibbonGroup>
    <RibbonGroup label="Selection" icon={ScanSearch}>
      <RibbonButton id="layer-select-attributes" label="Select By Attributes" icon={ScanSearch} size="small" onClick={onSelect} />
      <RibbonButton id="layer-zoom-selection" label="Zoom To Selection" icon={Focus} size="small" disabled={!hasSelection} onClick={onZoomSelection} />
      <RibbonButton id="layer-clear-selection" label="Clear" icon={Eraser} size="small" disabled={!hasSelection} onClick={onClear} />
    </RibbonGroup>
    <RibbonGroup label="Export" icon={Download}><RibbonMenuButton id="layer-export" label="Export Features" icon={Download} size="large" items={(['geojson', 'csv'] as const).map(format => ({ id: format, label: format === 'csv' ? 'CSV' : 'GeoJSON', onSelect: () => onExport(format) }))} /></RibbonGroup>
    <RibbonGroup label="Calculate" icon={Calculator}><RibbonButton id="layer-calculate" label="Calculate Field" icon={Calculator} size="large" onClick={onCalculate} /></RibbonGroup>
  </RibbonGroupBar>
}
