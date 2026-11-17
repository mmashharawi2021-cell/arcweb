import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  AreaChart, Bookmark as BookmarkIcon, Box, CloudUpload, Eraser, FileImage, FilePlus2, FileText, Focus, Globe2,
  LayoutTemplate, ListFilter, Map as MapIcon, Minus, MousePointer2, Plus, Ruler, ScanSearch, Sparkles,
  SquareDashedMousePointer, Table2, Upload,
} from 'lucide-react'
import { basemaps } from '../basemaps'
import { insertableElements } from '../layout/catalog'
import { elementLabels, type LayoutElementType } from '../layout/layoutStore'
import type { LayoutExportFormat } from '../layout/exportLayout'
import type { BasemapId, ToolMode, ViewMode } from '../store'
import { addRibbonTooltips } from './ribbonTooltips'

/** Which canvas the workspace shows. */
export type WorkspaceView = '2d' | '3d' | 'layout'

/*
 * The core (non-contextual) ribbon tabs. Each tab decorates its own buttons with ribbon
 * tooltips, because the decorator only walks elements written inline, not component output.
 */

interface MapRibbonProps {
  basemap: BasemapId
  offlineBasemapActive: boolean
  tool: ToolMode
  hasLayers: boolean
  hasTableLayer: boolean
  hasSelection: boolean
  selectedCount: number
  tableOpen: boolean
  bookmarksOpen: boolean
  view: WorkspaceView
  onSelectBasemap: (id: BasemapId) => void
  onExplore: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFullExtent: () => void
  onToggleBookmarks: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onSelectByAttributes: () => void
  onSelectByLocation: () => void
  onZoomToSelected: () => void
  onClearSelection: () => void
  onToggleMeasure: (mode: 'distance' | 'area') => void
  onToggleTable: () => void
  onOpenMapProperties: () => void
  onShowView: (view: WorkspaceView) => void
  /** The Layout button leaves layout view when it is already active. */
  onToggleLayout: () => void
}

export function MapRibbon(props: MapRibbonProps) {
  const { tool, view, hasSelection, selectedCount } = props
  return addRibbonTooltips(<>
    <div className="tool-group basemap-group">
      <div className="basemap-options">
        {basemaps.map((item) => (
          <button key={item.id} className={`basemap-button ${!props.offlineBasemapActive && props.basemap === item.id ? 'chosen' : ''}`} onClick={() => props.onSelectBasemap(item.id)} title={`${item.name} basemap`}>
            <span className={`basemap-preview ${item.preview}`} />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <div className="group-caption">Basemap gallery</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions map-ribbon">
      <button className={`ribbon-action ${tool === 'pan' ? 'tool-selected' : ''}`} title="Explore: pan the map and click a feature to open its pop-up (Ctrl+click adds it to the selection)" onClick={props.onExplore}><MousePointer2 size={17} /><span>Explore</span></button>
      <button className="ribbon-action" title="Zoom in" onClick={props.onZoomIn}><Plus size={17} /><span>Zoom in</span></button>
      <button className="ribbon-action" title="Zoom out" onClick={props.onZoomOut}><Minus size={17} /><span>Zoom out</span></button>
      <button className="ribbon-action" title="Full extent" onClick={props.onFullExtent}><Focus size={17} /><span>Full extent</span></button>
      <button className={`ribbon-action ${props.bookmarksOpen ? 'tool-selected' : ''}`} title="Spatial bookmarks" onPointerDown={(event) => event.stopPropagation()} onClick={props.onToggleBookmarks}><BookmarkIcon size={17} /><span>Bookmarks</span></button>
      <div className="group-caption">Navigate</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions map-ribbon">
      <button className="ribbon-action" title="Select By Attributes" disabled={!props.hasLayers} onClick={props.onSelectByAttributes}><ListFilter size={17} /><span>By attributes</span></button>
      <button className="ribbon-action" title="Select By Location" disabled={!props.hasLayers} onClick={props.onSelectByLocation}><SquareDashedMousePointer size={17} /><span>By location</span></button>
      <button className="ribbon-action" title="Zoom to selected features" disabled={!hasSelection} onClick={props.onZoomToSelected}><ScanSearch size={17} /><span>Zoom to</span></button>
      <button className="ribbon-action" title="Clear selection" disabled={!hasSelection} onClick={props.onClearSelection}><Eraser size={17} /><span>Clear</span></button>
      <div className="group-caption">Selection{selectedCount ? ` · ${selectedCount.toLocaleString('en-US')} selected` : ''}</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions map-ribbon">
      <button className={`ribbon-action ${tool === 'distance' ? 'tool-selected' : ''}`} title="Measure distance" onClick={() => props.onToggleMeasure('distance')}><Ruler size={17} /><span>Distance</span></button>
      <button className={`ribbon-action ${tool === 'area' ? 'tool-selected' : ''}`} title="Measure area" onClick={() => props.onToggleMeasure('area')}><AreaChart size={17} /><span>Area</span></button>
      <div className="group-caption">Measure</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions map-ribbon">
      <button className={`ribbon-action ${props.tableOpen ? 'tool-selected' : ''}`} title="Open attribute table" disabled={!props.hasTableLayer} onClick={props.onToggleTable}><Table2 size={17} /><span>Table</span></button>
      <button className="ribbon-action" title="Map properties and coordinate systems" onClick={props.onOpenMapProperties}><Globe2 size={17} /><span>Properties</span></button>
      <button className={`ribbon-action ${view === '2d' ? 'tool-selected' : ''}`} title="Switch to 2D Map" onClick={() => props.onShowView('2d')}><MapIcon size={17} /><span>2D Map</span></button>
      <button className={`ribbon-action ${view === '3d' ? 'tool-selected' : ''}`} title="Switch to 3D Scene; right-drag to rotate and tilt" onClick={() => props.onShowView('3d')}><Box size={17} /><span>3D Scene</span></button>
      <button className={`ribbon-action ${view === 'layout' ? 'tool-selected' : ''}`} title="Switch to print layout view" onClick={props.onToggleLayout}><LayoutTemplate size={17} /><span>Layout</span></button>
      <div className="group-caption">Map</div>
    </div>
  </>)
}

export function InsertRibbon({ onAddData }: { onAddData: () => void }) {
  return addRibbonTooltips(<>
    <div className="tool-group add-data-group">
      <button className="add-data-button" onClick={onAddData}><FilePlus2 size={19} /><span>Add data</span></button>
      <div className="group-caption">Import local data</div>
    </div>
    <div className="ribbon-separator" />
    <div className="supported-files"><CloudUpload size={19} /><div><strong>Drop a file onto the map</strong><span>GeoJSON · Shapefile ZIP · KML · CSV · GeoTIFF</span></div></div>
  </>)
}

export function AnalysisRibbon() {
  return <div className="ribbon-contextual-copy"><Sparkles size={17} /><div><strong>Spatial analysis</strong><span>Choose an operation and input layers in the Geoprocessing pane.</span></div></div>
}

interface LayoutRibbonProps {
  viewMode: ViewMode
  exporting: boolean
  onShowView: (view: WorkspaceView) => void
  onInsert: (type: LayoutElementType) => void
  onExport: (format: LayoutExportFormat) => void
}

export function LayoutRibbon({ viewMode, exporting, onShowView, onInsert, onExport }: LayoutRibbonProps) {
  return addRibbonTooltips(<>
    <div className="phase-ribbon-actions layout-ribbon">
      <button className={`ribbon-action ${viewMode === 'map' ? 'tool-selected' : ''}`} onClick={() => onShowView('2d')}><MapIcon size={17} /><span>Map view</span></button>
      <button className={`ribbon-action ${viewMode === 'layout' ? 'tool-selected' : ''}`} onClick={() => onShowView('layout')}><LayoutTemplate size={17} /><span>Layout view</span></button>
      <div className="group-caption">View</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions layout-ribbon">
      {insertableElements.map(({ type, icon: Icon }) => (
        <button key={type} className="ribbon-action" title={`Insert ${elementLabels[type].toLowerCase()}`} onClick={() => onInsert(type)}><Icon size={17} /><span>{elementLabels[type]}</span></button>
      ))}
      <div className="group-caption">Insert map elements</div>
    </div>
    <div className="ribbon-separator" />
    <div className="phase-ribbon-actions layout-ribbon">
      <button className="ribbon-action" disabled={exporting} onClick={() => onExport('png')}><FileImage size={17} /><span>PNG</span></button>
      <button className="ribbon-action" disabled={exporting} onClick={() => onExport('pdf')}><FileText size={17} /><span>PDF</span></button>
      <div className="group-caption">Export layout</div>
    </div>
  </>)
}

interface EditRibbonProps {
  tool: ToolMode
  hasLayer: boolean
  selectedFeatureIsEditable: boolean
  onSetTool: (tool: ToolMode) => void
}

export function EditRibbon({ tool, hasLayer, selectedFeatureIsEditable, onSetTool }: EditRibbonProps) {
  return addRibbonTooltips(
    <div className="phase-ribbon-actions">
      {([
        ['draw-point', 'Point'],
        ['draw-line', 'Line'],
        ['draw-polygon', 'Polygon'],
        ['move-vertex', 'Move vertex'],
      ] as const).map(([mode, label]) => (
        <button key={mode} className={`ribbon-action ${tool === mode ? 'tool-selected' : ''}`} disabled={mode === 'move-vertex' ? !selectedFeatureIsEditable : !hasLayer} onClick={() => onSetTool(tool === mode ? 'pan' : mode)}><MousePointer2 size={17} /><span>{label}</span></button>
      ))}
      <div className="group-caption">Feature tools · snapping enabled</div>
    </div>,
  )
}

interface ShareRibbonProps {
  hasLayer: boolean
  layoutExporting: boolean
  onExportLayer: (format: 'geojson' | 'csv') => void
  onExportMap: () => void
  onExportLayout: (format: LayoutExportFormat) => void
}

export function ShareRibbon({ hasLayer, layoutExporting, onExportLayer, onExportMap, onExportLayout }: ShareRibbonProps) {
  return addRibbonTooltips(
    <div className="phase-ribbon-actions">
      <button className="ribbon-action" disabled={!hasLayer} onClick={() => onExportLayer('geojson')}><FilePlus2 size={17} /><span>GeoJSON</span></button>
      <button className="ribbon-action" disabled={!hasLayer} onClick={() => onExportLayer('csv')}><Table2 size={17} /><span>CSV</span></button>
      <button className="ribbon-action" onClick={onExportMap}><Upload size={17} /><span>Map PNG</span></button>
      <button className="ribbon-action" disabled={layoutExporting} title="Export the print layout sheet as a high-resolution PNG" onClick={() => onExportLayout('png')}><FileImage size={17} /><span>Layout PNG</span></button>
      <button className="ribbon-action" disabled={layoutExporting} title="Export the print layout sheet as a PDF" onClick={() => onExportLayout('pdf')}><FileText size={17} /><span>Layout PDF</span></button>
      <div className="group-caption">Export locally</div>
    </div>,
  )
}
