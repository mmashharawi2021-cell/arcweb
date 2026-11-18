import { RibbonGroup } from './RibbonParts'
import { RibbonGroupBar } from './RibbonGroupBar'
import {
  Check, LocateFixed, PenLine, Redo2, Save, Spline, Trash2, Undo, Undo2,
} from 'lucide-react'
import type { ClassificationMethod, ContinuousRampId, MapLayer, ToolMode } from '../store'
import { buildGraduatedRenderer, CONTINUOUS_RAMPS } from '../symbology'

type LayerUpdate = (updates: Partial<MapLayer>) => void

function OpacityControl({ layer, onUpdate }: { layer: MapLayer; onUpdate: LayerUpdate }) {
  const percent = Math.round(layer.opacity * 100)
  return (
    <label className="ctx-field">
      <span className="ctx-field-label">Layer opacity <output>{percent}%</output></span>
      <input
        type="range" min={0} max={100} step={5} value={percent}
        aria-label={`Opacity of ${layer.name}`}
        onChange={(event) => onUpdate({ opacity: Number(event.target.value) / 100 })}
      />
    </label>
  )
}

const STRETCH_TYPES: { id: ClassificationMethod; label: string }[] = [
  { id: 'equal-interval', label: 'Minimum–maximum' },
  { id: 'quantile', label: 'Histogram equalize' },
  { id: 'natural-breaks', label: 'Natural breaks (Jenks)' },
]

interface RasterLayerRibbonProps {
  layer: MapLayer
  onUpdate: LayerUpdate
  onZoomToLayer: () => void
  onError: (message: string) => void
}

/** Raster Layer ▸ Appearance: band, stretch, colormap and transparency. */
export function RasterLayerRibbon({ layer, onUpdate, onZoomToLayer, onError }: RasterLayerRibbonProps) {
  const renderer = layer.renderer.type === 'graduated' ? layer.renderer : null
  const method = renderer?.method ?? 'quantile'
  const ramp = renderer?.ramp ?? 'viridis'
  const classCount = renderer?.classCount ?? (renderer ? renderer.breaks.length + 1 : 7)
  const restyle = (next: { method?: ClassificationMethod; ramp?: ContinuousRampId; classCount?: number }) => {
    try {
      onUpdate({ renderer: buildGraduatedRenderer(layer, 'value', next.method ?? method, next.classCount ?? classCount, next.ramp ?? ramp) })
    } catch (error) {
      onError(`Could not apply the raster stretch: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Rendering" icon={LocateFixed}>
        <label className="ctx-field">
          <span className="ctx-field-label">Band</span>
          {/* GeoTIFFs are read as single-band grids, so band 1 is the only band available to display. */}
          <select value="1" disabled aria-label="Displayed band" title="ArcWeb reads band 1 of each GeoTIFF"><option value="1">Band 1 (gray)</option></select>
        </label>
        <label className="ctx-field">
          <span className="ctx-field-label">Stretch type</span>
          <select value={method} aria-label="Stretch type" onChange={(event) => restyle({ method: event.target.value as ClassificationMethod })}>
            {STRETCH_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="ctx-field ctx-field-narrow">
          <span className="ctx-field-label">Classes</span>
          <select value={classCount} aria-label="Number of stretch classes" onChange={(event) => restyle({ classCount: Number(event.target.value) })}>
            {[3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </RibbonGroup>
      <RibbonGroup label="Colormap" icon={LocateFixed}>
        <div className="ctx-ramps" role="radiogroup" aria-label="Color scheme">
          {(Object.keys(CONTINUOUS_RAMPS) as ContinuousRampId[]).map((id) => (
            <button
              key={id} role="radio" aria-checked={ramp === id}
              className={`ctx-ramp ${ramp === id ? 'chosen' : ''}`}
              title={`${CONTINUOUS_RAMPS[id].name} color scheme`}
              onClick={() => restyle({ ramp: id })}
            >
              <span className="ctx-ramp-swatch" style={{ background: `linear-gradient(90deg, ${CONTINUOUS_RAMPS[id].colors.join(', ')})` }} />
              <span>{CONTINUOUS_RAMPS[id].name}</span>
            </button>
          ))}
        </div>
      </RibbonGroup>
      <RibbonGroup label="Effects & navigate" icon={LocateFixed}>
        <OpacityControl layer={layer} onUpdate={onUpdate} />
        <button className="ribbon-action" title="Zoom to raster extent" onClick={onZoomToLayer}><LocateFixed size={17} /><span>Zoom to layer</span></button>
      </RibbonGroup>
    </RibbonGroupBar>
  )
}

const CREATE_TOOL: Partial<Record<MapLayer['geometry'], ToolMode>> = {
  Point: 'draw-point',
  Line: 'draw-line',
  Polygon: 'draw-polygon',
}

interface EditSessionRibbonProps {
  layer: MapLayer | null
  tool: ToolMode
  selectedFeatureIsEditable: boolean
  selectedCount: number
  pendingLayerNames: string[]
  onSetTool: (tool: ToolMode) => void
  onFinishSketch: () => void
  onDeleteSelected: () => void
  onSave: () => void
  onDiscard: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** Editing ▸ Edit Tools: sketch, reshape, delete, then commit or roll back the session. */
export function EditSessionRibbon({
  layer, tool, selectedFeatureIsEditable, selectedCount, pendingLayerNames,
  onSetTool, onFinishSketch, onDeleteSelected, onSave, onDiscard, canUndo, canRedo, onUndo, onRedo,
}: EditSessionRibbonProps) {
  const createTool = layer ? CREATE_TOOL[layer.geometry] : undefined
  const pending = pendingLayerNames.length > 0
  const pendingCaption = pending
    ? `Unsaved edits: ${pendingLayerNames.join(', ')}`
    : 'No unsaved edits'
  return (
    <>
      <div className="phase-ribbon-actions ctx-group">
        <button
          className={`ribbon-action ${createTool && tool === createTool ? 'tool-selected' : ''}`}
          title={createTool ? `Create a new ${layer?.geometry.toLowerCase()} feature in ${layer?.name}` : 'Select a point, line or polygon layer to create features'}
          disabled={!createTool}
          onClick={() => createTool && onSetTool(tool === createTool ? 'pan' : createTool)}
        ><PenLine size={17} /><span>Create</span></button>
        <button className={`ribbon-action ${tool === 'move-vertex' ? 'tool-selected' : ''}`} title="Drag vertices of the selected feature" disabled={!selectedFeatureIsEditable} onClick={() => onSetTool(tool === 'move-vertex' ? 'pan' : 'move-vertex')}><Spline size={17} /><span>Vertices</span></button>
        <button className="ribbon-action" title="Finish the current line or polygon sketch" disabled={tool !== 'draw-line' && tool !== 'draw-polygon'} onClick={onFinishSketch}><Check size={17} /><span>Finish</span></button>
        <button className="ribbon-action ctx-danger" title="Delete the selected features" disabled={!selectedCount} onClick={onDeleteSelected}><Trash2 size={17} /><span>Delete{selectedCount > 1 ? ` (${selectedCount})` : ''}</span></button>
        <div className="group-caption">{layer ? `Features · ${layer.name}` : 'Features'}</div>
      </div>
      <div className="ribbon-separator" />
      <div className="phase-ribbon-actions ctx-group">
        <button className="ribbon-action" title="Undo the last edit (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Undo size={17} /><span>Undo</span></button>
        <button className="ribbon-action" title="Redo the last undone edit (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}><Redo2 size={17} /><span>Redo</span></button>
        <div className="group-caption">History</div>
      </div>
      <div className="ribbon-separator" />
      <div className="phase-ribbon-actions ctx-group">
        <button className="ribbon-action ctx-commit" title="Save all edits made in this session" disabled={!pending} onClick={onSave}><Save size={17} /><span>Save</span></button>
        <button className="ribbon-action" title="Discard all edits made in this session and restore the original features" disabled={!pending} onClick={onDiscard}><Undo2 size={17} /><span>Discard</span></button>
        <div className="group-caption ctx-pending" title={pendingCaption}>{pendingCaption}</div>
      </div>
    </>
  )
}
