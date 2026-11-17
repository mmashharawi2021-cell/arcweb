import { useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Crosshair, FolderOpen, Layers3, Navigation, AreaChart, Bookmark as BookmarkIcon, CloudUpload, Eraser, FileImage, FilePlus2, FileText, Focus, Globe2, LayoutTemplate, ListFilter, Map as MapIcon, Minus, MousePointer2, Plus, Ruler, ScanSearch, Sparkles, SquareDashedMousePointer, Table2, Upload,
} from 'lucide-react'
import { basemaps } from '../basemaps'
import { insertableElements } from '../layout/catalog'
import { elementLabels, type LayoutElementType } from '../layout/layoutStore'
import type { LayoutExportFormat } from '../layout/exportLayout'
import type { BasemapId, ToolMode, ViewMode } from '../store'
import { addRibbonTooltips } from './ribbonTooltips'
import { RibbonButton, RibbonGallery, RibbonGroup, RibbonMenuButton } from './RibbonParts'
import { useRibbonCollapse } from './useRibbonCollapse'

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
  hasSelection: boolean
  selectedCount: number
  bookmarks: { id: string; name: string }[]
  canGoBack: boolean
  canGoForward: boolean
  onSelectBasemap: (id: BasemapId) => void
  onExplore: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFullExtent: () => void
  onBack: () => void
  onForward: () => void
  onGoToBookmark: (id: string) => void
  /** New Bookmark… / Manage Bookmarks…: opens the bookmarks panel. */
  onManageBookmarks: () => void
  onAddData: () => void
  onOpenProjectFile: () => void
  onSelectByAttributes: () => void
  onSelectByLocation: () => void
  onZoomToSelected: () => void
  onClearSelection: () => void
  onToggleMeasure: (mode: 'distance' | 'area') => void
  /** Measure › Feature (Task 24); disabled until provided. */
  onMeasureFeature?: () => void
  /** Go To XY (Task 7); disabled until provided. */
  onGoToXY?: () => void
  /** Rectangle selection tool (Task 8); disabled until provided. */
  onSelectTool?: (mode: 'select-box') => void
  onOpenMapProperties: () => void
}

/** ArcGIS Pro's Map tab: Navigate, Layer, Selection, Inquiry and View groups. Groups collapse when space runs out. */
export function MapRibbon(props: MapRibbonProps) {
  const { tool, hasSelection, selectedCount } = props
  const ref = useRef<HTMLDivElement>(null)
  const collapsed = useRibbonCollapse(ref)
  const measuring = tool === 'distance' || tool === 'area'
  return (
    <div ref={ref} className="ribbon-groups">
      <RibbonGroup label="Navigate" icon={Navigation} collapsed={collapsed.Navigate}>
        <RibbonButton id="explore" label="Explore" icon={MousePointer2} size="large" pressed={tool === 'pan'}
          tooltip={{ title: 'Explore', body: 'Pan the map and click a feature to open its pop-up (Ctrl+click adds it to the selection).' }}
          onClick={props.onExplore} />
        <div className="ribbon-stack">
          <RibbonButton id="full-extent" label="Full Extent" icon={Focus} size="small" onClick={props.onFullExtent} />
          <RibbonButton id="zoom-in" label="Fixed Zoom In" icon={Plus} size="small" onClick={props.onZoomIn} />
          <RibbonButton id="zoom-out" label="Fixed Zoom Out" icon={Minus} size="small" onClick={props.onZoomOut} />
        </div>
        <div className="ribbon-stack">
          <RibbonButton id="previous-extent" label="Previous" icon={ChevronLeft} size="small" disabled={!props.canGoBack} onClick={props.onBack} />
          <RibbonButton id="next-extent" label="Next" icon={ChevronRight} size="small" disabled={!props.canGoForward} onClick={props.onForward} />
        </div>
        <RibbonMenuButton id="bookmarks" label="Bookmarks" icon={BookmarkIcon} size="large"
          items={[
            ...props.bookmarks.map((bookmark) => ({ id: `bookmark-${bookmark.id}`, label: bookmark.name, onSelect: () => props.onGoToBookmark(bookmark.id) })),
            { id: 'new-bookmark', label: 'New Bookmark…', icon: Plus, onSelect: props.onManageBookmarks },
            { id: 'manage-bookmarks', label: 'Manage Bookmarks…', icon: BookmarkIcon, onSelect: props.onManageBookmarks },
          ]} />
      </RibbonGroup>
      <RibbonGroup label="Layer" icon={Layers3} collapsed={collapsed.Layer}>
        <RibbonGallery id="basemap" label="Basemap" icon={MapIcon} onSelect={(id) => props.onSelectBasemap(id as BasemapId)}
          items={basemaps.map((item) => ({
            id: item.id,
            label: item.name,
            preview: <span className={`basemap-preview ${item.preview}`} />,
            selected: !props.offlineBasemapActive && props.basemap === item.id,
          }))} />
        <RibbonMenuButton id="add-data" label="Add Data" icon={FilePlus2} size="large" split onClick={props.onAddData}
          items={[
            { id: 'add-data-file', label: 'Data…', icon: FilePlus2, onSelect: props.onAddData },
            { id: 'add-project-file', label: 'Project file…', icon: FolderOpen, onSelect: props.onOpenProjectFile },
          ]} />
      </RibbonGroup>
      <RibbonGroup label="Selection" icon={SquareDashedMousePointer} collapsed={collapsed.Selection}
        caption={selectedCount ? `Selection · ${selectedCount.toLocaleString('en-US')} selected` : undefined}>
        <RibbonMenuButton id="select" label="Select" icon={SquareDashedMousePointer} size="large" split disabled={!props.onSelectTool || !props.hasLayers}
          onClick={() => props.onSelectTool?.('select-box')}
          items={[{ id: 'select-rectangle', label: 'Rectangle', icon: SquareDashedMousePointer, onSelect: () => props.onSelectTool?.('select-box') }]} />
        <RibbonButton id="select-by-attributes" label="Select By Attributes" icon={ListFilter} size="large" disabled={!props.hasLayers} onClick={props.onSelectByAttributes} />
        <RibbonButton id="select-by-location" label="Select By Location" icon={ScanSearch} size="large" disabled={!props.hasLayers} onClick={props.onSelectByLocation} />
        <div className="ribbon-stack">
          <RibbonButton id="clear-selection" label="Clear" icon={Eraser} size="small" disabled={!hasSelection} onClick={props.onClearSelection} />
          <RibbonButton id="zoom-to-selection" label="Zoom To" icon={Focus} size="small" disabled={!hasSelection} onClick={props.onZoomToSelected} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Inquiry" icon={Ruler} collapsed={collapsed.Inquiry}>
        <RibbonMenuButton id="measure" label="Measure" icon={Ruler} size="large" split pressed={measuring}
          onClick={() => props.onToggleMeasure('distance')}
          items={[
            { id: 'measure-distance', label: 'Distance', icon: Ruler, onSelect: () => props.onToggleMeasure('distance') },
            { id: 'measure-area', label: 'Area', icon: AreaChart, onSelect: () => props.onToggleMeasure('area') },
            { id: 'measure-feature', label: 'Feature', icon: MousePointer2, disabled: !props.onMeasureFeature, onSelect: () => props.onMeasureFeature?.() },
          ]} />
        <div className="ribbon-stack">
          <RibbonButton id="go-to-xy" label="Go To XY" icon={Crosshair} size="small" disabled={!props.onGoToXY} onClick={props.onGoToXY} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="View" icon={Globe2} collapsed={collapsed.View}>
        <RibbonButton id="map-properties" label="Properties" icon={Globe2} size="large"
          tooltip={{ title: 'Map Properties', body: 'Coordinate systems and map information.' }} onClick={props.onOpenMapProperties} />
      </RibbonGroup>
    </div>
  )
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
