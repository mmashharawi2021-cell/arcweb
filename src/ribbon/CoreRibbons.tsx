import {
  CircleDot, Magnet, Move, Pentagon, PenTool, Redo2, RotateCcw, Save, Spline, Trash2, Undo2,
  Archive, CircleDashed, Download, FileOutput, Hammer, History as HistoryIcon, ImageDown, Info, Layers, Link, Merge, Scissors, SquaresIntersect, SquaresUnite, ChevronLeft, ChevronRight, Crosshair, FolderOpen, Layers3, Navigation, AreaChart, Bookmark as BookmarkIcon, Eraser, FileImage, FilePlus2, FileText, Focus, Globe2, LayoutTemplate, ListFilter, Map as MapIcon, Minus, MousePointer2, Plus, Ruler, ScanSearch, Sparkles, SquareDashedMousePointer, Table2,
} from 'lucide-react'
import { basemaps } from '../basemaps'
import type { LayoutExportFormat } from '../layout/exportLayout'
import type { BasemapId, ToolMode } from '../store'
import { RibbonButton, RibbonGallery, RibbonGroup, RibbonMenuButton } from './RibbonParts'
import { RibbonGroupBar } from './RibbonGroupBar'
import { LAYOUT_TEMPLATES, type LayoutTemplateId } from '../layout/templates'
import { toolboxTools } from '../toolboxes/registry'
import { ANALYSIS_GALLERY, galleryTools } from './analysisGallery'
import type { LucideIcon } from 'lucide-react'

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
  /** Identify (Inquiry group): click a feature to view its attributes. */
  onIdentify?: () => void
  /** Locate (Inquiry group): search for a place and zoom to it. */
  onLocate?: () => void
  /** Rectangle selection tool (Task 8); disabled until provided. */
  onSelectTool?: (mode: 'select-box') => void
  onOpenMapProperties: () => void
}

/** ArcGIS Pro's Map tab: Navigate, Layer, Selection, Inquiry and View groups. Groups collapse when space runs out. */
export function MapRibbon(props: MapRibbonProps) {
  const { tool, hasSelection, selectedCount } = props
  const measuring = tool === 'distance' || tool === 'area'
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Navigate" icon={Navigation}>
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
      <RibbonGroup label="Layer" icon={Layers3}>
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
      <RibbonGroup label="Selection" icon={SquareDashedMousePointer}
        caption={selectedCount ? `Selection · ${selectedCount.toLocaleString('en-US')} selected` : undefined}>
        <RibbonMenuButton id="select" label="Select" icon={SquareDashedMousePointer} size="large" split pressed={tool === 'select-box'} disabled={!props.onSelectTool || !props.hasLayers}
          onClick={() => props.onSelectTool?.('select-box')}
          items={[{ id: 'select-rectangle', label: 'Rectangle', icon: SquareDashedMousePointer, onSelect: () => props.onSelectTool?.('select-box') }]} />
        <RibbonButton id="select-by-attributes" label="Select By Attributes" icon={ListFilter} size="large" disabled={!props.hasLayers} onClick={props.onSelectByAttributes} />
        <RibbonButton id="select-by-location" label="Select By Location" icon={ScanSearch} size="large" disabled={!props.hasLayers} onClick={props.onSelectByLocation} />
        <div className="ribbon-stack">
          <RibbonButton id="clear-selection" label="Clear" icon={Eraser} size="small" disabled={!hasSelection} onClick={props.onClearSelection} />
          <RibbonButton id="zoom-to-selection" label="Zoom To" icon={Focus} size="small" disabled={!hasSelection} onClick={props.onZoomToSelected} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Inquiry" icon={Ruler}>
        <RibbonMenuButton id="measure" label="Measure" icon={Ruler} size="large" split pressed={measuring}
          onClick={() => props.onToggleMeasure('distance')}
          items={[
            { id: 'measure-distance', label: 'Distance', icon: Ruler, onSelect: () => props.onToggleMeasure('distance') },
            { id: 'measure-area', label: 'Area', icon: AreaChart, onSelect: () => props.onToggleMeasure('area') },
            { id: 'measure-feature', label: 'Feature', icon: MousePointer2, disabled: !props.onMeasureFeature, onSelect: () => props.onMeasureFeature?.() },
          ]} />
        <div className="ribbon-stack">
          <RibbonButton id="identify" label="Identify" icon={Info} size="small" disabled={!props.onIdentify} onClick={props.onIdentify} />
          <RibbonButton id="go-to-xy" label="Go To XY" icon={Crosshair} size="small" disabled={!props.onGoToXY} onClick={props.onGoToXY} />
          <RibbonButton id="locate" label="Locate" icon={Navigation} size="small" disabled={!props.onLocate} onClick={props.onLocate} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="View" icon={Globe2}>
        <RibbonButton id="map-properties" label="Properties" icon={Globe2} size="large"
          tooltip={{ title: 'Map Properties', body: 'Coordinate systems and map information.' }} onClick={props.onOpenMapProperties} />
      </RibbonGroup>
    </RibbonGroupBar>
  )
}

interface InsertRibbonProps {
  /** Insert › New Layout: replace the layout sheet with a template and show the layout. */
  onNewLayout: (template: LayoutTemplateId) => void
  /** Insert › New Layer: create an empty editable layer. */
  onNewLayer: () => void
  onAddData: () => void
}

/** ArcGIS Pro's Insert tab: Project (New Layout, New Layer) and Layer (Add Data). */
export function InsertRibbon({ onNewLayout, onNewLayer, onAddData }: InsertRibbonProps) {
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Project" icon={LayoutTemplate}>
        <RibbonMenuButton id="new-layout" label="New Layout" icon={LayoutTemplate} size="large"
          tooltip={{ title: 'New Layout', body: 'Replace the print layout with a template and open it.' }}
          items={LAYOUT_TEMPLATES.map((template) => ({ id: `layout-${template.id}`, label: template.name, onSelect: () => onNewLayout(template.id) }))} />
        <RibbonButton id="new-layer" label="New Layer" icon={Layers} size="large"
          tooltip={{ title: 'New Layer', body: 'Create an empty point, line or polygon layer to draw in.' }} onClick={onNewLayer} />
      </RibbonGroup>
      <RibbonGroup label="Layer" icon={FilePlus2}>
        <RibbonButton id="add-data" label="Add Data" icon={FilePlus2} size="large"
          tooltip={{ title: 'Add Data', body: 'GeoJSON, Shapefile ZIP, KML, CSV or GeoTIFF from this computer. You can also drop files on the map.' }} onClick={onAddData} />
      </RibbonGroup>
    </RibbonGroupBar>
  )
}

const GALLERY_ICONS: Record<string, LucideIcon> = {
  buffer: CircleDashed, clip: Scissors, intersect: SquaresIntersect, union: SquaresUnite, dissolve: Merge, 'spatial-join': Link,
}

interface AnalysisRibbonProps {
  onOpenTools: () => void
  onOpenHistory: () => void
  onOpenTool: (toolId: string) => void
}

/** ArcGIS Pro's Analysis tab: Geoprocessing (Tools, History) and the Tools gallery. */
export function AnalysisRibbon({ onOpenTools, onOpenHistory, onOpenTool }: AnalysisRibbonProps) {
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Geoprocessing" icon={Hammer}>
        <RibbonButton id="geoprocessing-tools" label="Tools" icon={Hammer} size="large"
          tooltip={{ title: 'Tools', body: 'Open the Geoprocessing pane to find and run any tool.' }} onClick={onOpenTools} />
        <RibbonButton id="geoprocessing-history" label="History" icon={HistoryIcon} size="large"
          tooltip={{ title: 'History', body: 'Tools run in this project; re-open one with its settings.' }} onClick={onOpenHistory} />
      </RibbonGroup>
      <RibbonGroup label="Tools" icon={Sparkles}>
        {galleryTools(ANALYSIS_GALLERY, toolboxTools).map((tool) => (
          <RibbonButton key={tool.id} id={`tool-${tool.id}`} label={tool.name} icon={GALLERY_ICONS[tool.id] ?? Hammer} size="large"
            tooltip={{ title: tool.name, body: tool.description }} onClick={() => onOpenTool(tool.id)} />
        ))}
      </RibbonGroup>
    </RibbonGroupBar>
  )
}

interface EditRibbonProps {
  tool: ToolMode
  hasLayer: boolean
  selectedFeatureIsEditable: boolean
  /** Some layer has edits since the session started. */
  pendingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  snapping: { enabled: boolean; tolerancePx: number }
  onSetTool: (tool: ToolMode) => void
  onSave: () => void
  onDiscard: () => void
  onUndo: () => void
  onRedo: () => void
  onSnapping: (snapping: { enabled: boolean; tolerancePx: number }) => void
  onDeleteSelected: () => void
  onSelectTool: () => void
  onClearSelection: () => void
}

const SNAP_TOLERANCES = [5, 10, 15, 20]

/** ArcGIS Pro's Edit tab: Manage Edits, Snapping, Features and Selection. */
export function EditRibbon(props: EditRibbonProps) {
  const { tool, snapping } = props
  const toggleTool = (mode: ToolMode) => props.onSetTool(tool === mode ? 'pan' : mode)
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Manage Edits" icon={Save}>
        <RibbonButton id="save-edits" label="Save" icon={Save} size="large" disabled={!props.pendingEdits}
          tooltip={{ title: 'Save Edits', body: 'Keep every edit made in this edit session.' }} onClick={props.onSave} />
        <RibbonButton id="discard-edits" label="Discard" icon={RotateCcw} size="large" disabled={!props.pendingEdits}
          tooltip={{ title: 'Discard Edits', body: 'Restore the layers as they were when editing started.' }} onClick={props.onDiscard} />
        <div className="ribbon-stack">
          <RibbonButton id="undo-edit" label="Undo" icon={Undo2} size="small" disabled={!props.canUndo} tooltip={{ title: 'Undo', shortcut: 'Ctrl+Z' }} onClick={props.onUndo} />
          <RibbonButton id="redo-edit" label="Redo" icon={Redo2} size="small" disabled={!props.canRedo} tooltip={{ title: 'Redo', shortcut: 'Ctrl+Y' }} onClick={props.onRedo} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="Snapping" icon={Magnet} caption={`Snapping · ${snapping.tolerancePx} px`}>
        <RibbonMenuButton id="snapping" label="Snapping" icon={Magnet} size="large" split pressed={snapping.enabled}
          tooltip={{ title: 'Snapping', body: 'Snap new vertices to existing vertices near the pointer.' }}
          onClick={() => props.onSnapping({ ...snapping, enabled: !snapping.enabled })}
          items={SNAP_TOLERANCES.map((tolerancePx) => ({
            id: `snap-${tolerancePx}`,
            label: `${tolerancePx} px${tolerancePx === snapping.tolerancePx ? ' ✓' : ''}`,
            onSelect: () => props.onSnapping({ enabled: true, tolerancePx }),
          }))} />
      </RibbonGroup>
      <RibbonGroup label="Features" icon={PenTool}>
        <RibbonMenuButton id="create-features" label="Create" icon={PenTool} size="large" disabled={!props.hasLayer}
          pressed={tool === 'draw-point' || tool === 'draw-line' || tool === 'draw-polygon'}
          items={([['draw-point', 'Point', CircleDot], ['draw-line', 'Line', Spline], ['draw-polygon', 'Polygon', Pentagon]] as const).map(([mode, label, icon]) => ({
            id: mode, label, icon, onSelect: () => props.onSetTool(mode),
          }))} />
        <RibbonButton id="move-vertex" label="Move Vertex" icon={Move} size="large" pressed={tool === 'move-vertex'}
          disabled={!props.selectedFeatureIsEditable && tool !== 'move-vertex'}
          tooltip={{ title: 'Move Vertex', body: 'Click a vertex of the selected feature, then click its new location.' }}
          onClick={() => toggleTool('move-vertex')} />
        <RibbonButton id="delete-features" label="Delete" icon={Trash2} size="large" disabled={!props.hasSelection}
          tooltip={{ title: 'Delete', body: 'Delete the selected features of the target layer.' }} onClick={props.onDeleteSelected} />
      </RibbonGroup>
      <RibbonGroup label="Selection" icon={SquareDashedMousePointer}>
        <RibbonButton id="edit-select" label="Select" icon={SquareDashedMousePointer} size="large" pressed={tool === 'select-box'} onClick={props.onSelectTool} />
        <RibbonButton id="edit-clear-selection" label="Clear" icon={Eraser} size="large" disabled={!props.hasSelection} onClick={props.onClearSelection} />
      </RibbonGroup>
    </RibbonGroupBar>
  )
}

interface ShareRibbonProps {
  hasLayer: boolean
  layoutExporting: boolean
  onExportMap: () => void
  onExportLayout: (format: LayoutExportFormat) => void
  onExportLayer: (format: 'geojson' | 'csv') => void
  /** Project › Download Project File (.arcweb.json). */
  onDownloadProject: () => void
  /** Project › Back Up Projects: opens Project › Projects & offline. */
  onBackupProjects: () => void
}

/** ArcGIS Pro's Share tab, for a local app: Output (map, layout, layer) and Project files. */
export function ShareRibbon({ hasLayer, layoutExporting, onExportMap, onExportLayout, onExportLayer, onDownloadProject, onBackupProjects }: ShareRibbonProps) {
  return (
    <RibbonGroupBar>
      <RibbonGroup label="Output" icon={FileOutput}>
        <RibbonButton id="export-map" label="Export Map" icon={ImageDown} size="large"
          tooltip={{ title: 'Export Map', body: 'Save the current map view as a PNG image.' }} onClick={onExportMap} />
        <RibbonMenuButton id="export-layout" label="Export Layout" icon={LayoutTemplate} size="large" disabled={layoutExporting}
          items={[
            { id: 'export-layout-png', label: 'PNG', icon: FileImage, onSelect: () => onExportLayout('png') },
            { id: 'export-layout-pdf', label: 'PDF', icon: FileText, onSelect: () => onExportLayout('pdf') },
          ]} />
        <RibbonMenuButton id="export-layer" label="Export Layer" icon={FileOutput} size="large" disabled={!hasLayer}
          items={[
            { id: 'export-layer-geojson', label: 'GeoJSON', icon: FilePlus2, onSelect: () => onExportLayer('geojson') },
            { id: 'export-layer-csv', label: 'CSV', icon: Table2, onSelect: () => onExportLayer('csv') },
          ]} />
      </RibbonGroup>
      <RibbonGroup label="Project" icon={Archive}>
        <RibbonButton id="download-project" label="Download Project File" icon={Download} size="large"
          tooltip={{ title: 'Download Project File', body: 'Save the whole workspace as an .arcweb.json file.' }} onClick={onDownloadProject} />
        <RibbonButton id="backup-projects" label="Back Up Projects" icon={Archive} size="large"
          tooltip={{ title: 'Back Up Projects', body: 'Export every project on this device, with recovery points and source files.' }} onClick={onBackupProjects} />
      </RibbonGroup>
    </RibbonGroupBar>
  )
}
