import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { coordinateReadout, crsLabel, getCrs, requireCrs, scaleDenominator, utmCodeFor, WGS84 } from './crs'
import {
  AreaChart, ArrowDown, ArrowUp, Check, ChevronDown, Circle, CloudUpload, Compass,
  Database, Eye, EyeOff, FilePlus2, Focus, FolderOpen, Layers3, LocateFixed, Map as MapIcon,
  Moon, Minus, MousePointer2, MoveRight, PanelRightClose, Plus, Ruler, Search, Settings2,
  Sun, Sparkles, Table2, Trash2, Triangle, Upload, X, FileImage, FileText, Globe2, LayoutTemplate, Box, Move,
  Bookmark as BookmarkIcon, Eraser, ListFilter, Save, ScanSearch, SquareDashedMousePointer,
} from 'lucide-react'
import { del, get, set } from 'idb-keyval'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import AttributeTable from './AttributeTable'
import DockablePanel from './DockablePanel'
import { SymbologyPanel } from './SymbologyPanel'
import { calculateField } from './fieldCalculator'
import { createMapLayer, getCollectionBounds, readGeospatialFile } from './geo'
import { rasterToFeatureCollection } from './rasterEngine'
import { runInWorker, type WorkerLike } from './workers/runInWorker'
import type { ToolRequest } from './workers/toolProtocol'
import { needsMainThread } from './workers/importHandler'
import type { ImportRequest, ImportResult } from './workers/importProtocol'
import { exportLayer, exportMapCanvas } from './exportData'
import { EditPanel, SharePanel } from './PhasePanels'
import MapProperties, { type MapViewInfo } from './MapProperties'
import { exportLayoutSheet, type LayoutExportFormat } from './layout/exportLayout'
import { insertableElements } from './layout/catalog'
import LayoutPanel from './layout/LayoutPanel'
import LayoutView from './layout/LayoutView'
import { elementLabels, pageSize, useLayoutStore, type LayoutDocument, type LayoutElementType } from './layout/layoutStore'
import {
  ensureMapOverlays, geometryBounds, getLayerIds, getRenderedFeatureLayerIds,
  setMeasureOverlay, setSelectionOverlay, setSketchOverlay, syncMapLayers,
} from './mapRendering'
import {
  useArcWebStore, type AnalysisRecord, type BasemapId, type Bookmark, type ContextualTab, type FeatureId, type FeatureSelection, type MapLayer,
  type SelectionMethod, type TableView, type ToolMode,
} from './store'
import { setFeatureAttribute } from './table/tableQuery'
import SceneNavigator from './scene/SceneNavigator'
import { applySceneTerrain, type TerrainState } from './scene/terrain'
import {
  CONTEXTUAL_TAB_META, CONTEXTUAL_TABS, CORE_TABS, getVisibleContextualTabs, hasPendingEdits, isContextualTab,
  isEditingTool, isRasterLayer, reconcileRibbonTabs,
} from './ribbon/contextualTabs'
import ContextMenu from './contextMenu/ContextMenu'
import {
  buildLayerMenu, buildMapCanvasMenu, formatLngLat, isRightClickGesture, runLayerMenuAction, runMapCanvasMenuAction,
  type MenuEntry,
} from './contextMenu/menuModel'
import { ViewRibbon } from './ribbon/ViewRibbon'
import { EditSessionRibbon, FeatureLayerRibbon, RasterLayerRibbon } from './ribbon/ContextualRibbons'
import BookmarksPopover from './BookmarksPopover'
import IdentifyPopup, { type IdentifyHit } from './IdentifyPopup'
import {
  buildProject, isProjectFile, parseAnalysisHistory, parseProject, parseSceneSettings, parseTableViews, projectFileName, type ArcWebProject,
} from './project'
import { applyWorkspacePreset, normalizeWorkspaceLayout } from './workspaceLayout'
import type { PanelFrame, WorkspacePanelId, WorkspacePreset } from './workspaceLayout'
import { getGraduatedClasses, getGraduatedClassCounts, getUniqueValueClasses } from './symbology'
import { trapTabKey } from './a11y/modalFocus'
import { SelectByAttributesDialog, SelectByLocationDialog } from './selection/SelectionDialogs'
import ToolboxPanel from './toolboxes/ToolboxPanel'
import type { ToolboxParameters, ToolboxTool, ToolExecutionResult } from './toolboxes/types'
import { mergeScopedData, scopeLayersToSelection, selectedFeatureCount } from './toolboxes/selectionScope'
import { describeToolRun } from './toolboxes/history'
import './App.css'
import { isolate } from './bidi'
import { changedLayerIds } from './toolboxes/staleUpdates'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

const STORAGE_KEY = 'arcweb-session-v1'
/** Pre-edit snapshots of layers with unsaved edits, so a reload resumes the edit session instead of silently committing it. */
const EDIT_SESSION_KEY = 'arcweb-edit-session-v1'
const SETTINGS_KEY = 'arcweb-settings-v1'
const WORKSPACE_LAYOUT_STORAGE_KEY = 'arcweb-workspace-layout-v1'

interface SavedSettings {
  displayCrs?: string
  layout?: LayoutDocument
  bookmarks?: Bookmark[]
  projectName?: string
  sceneSettings?: unknown
  analysisHistory?: unknown
  tableViews?: unknown
}

/** Features identified by the last Explore click and where to float their pop-up. */
interface IdentifyState {
  key: number
  hits: FeatureSelection[]
  index: number
  x: number
  y: number
  lngLat: [number, number]
}

const EMPTY_TABLE_VIEW: TableView = { sort: null, filters: {} }

/**
 * Moves keyboard focus to a layer's name in Contents — or the first layer, or "Add data" when the map
 * is empty — once React has updated the list. Used when a dialog about that layer closes.
 */
function focusLayerInContents(layerId: string | null) {
  window.requestAnimationFrame(() => {
    const target = (layerId ? document.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layerId)}"] .layer-name-button`) : null) ??
      document.querySelector<HTMLElement>('.layer-name-button') ??
      document.querySelector<HTMLElement>('.contents-dock [aria-label="Add data"]')
    target?.focus()
  })
}

/** The open right-click menu, with the viewport point it was opened at. */
type ContextMenuState =
  | { kind: 'map-root'; x: number; y: number }
  | { kind: 'layer'; layerId: string; x: number; y: number }
  | { kind: 'canvas'; x: number; y: number; point: { x: number; y: number }; lngLat: [number, number]; canIdentify: boolean }

const basemaps: { id: BasemapId; name: string; note: string; preview: string }[] = [
  { id: 'osm', name: 'OpenStreetMap', note: 'Streets', preview: 'map-preview-osm' },
  { id: 'satellite', name: 'World Imagery', note: 'Satellite', preview: 'map-preview-satellite' },
  { id: 'dark', name: 'Dark Matter', note: 'Carto', preview: 'map-preview-dark' },
  { id: 'light', name: 'Positron Light', note: 'Carto', preview: 'map-preview-light' },
]

function baseStyle(id: BasemapId): StyleSpecification | string {
  if (id === 'dark') return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
  if (id === 'light') return 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
  const configs = {
    osm: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    },
  } satisfies Record<'osm' | 'satellite', { url: string; attribution: string }>
  const selected = configs[id]
  return {
    version: 8,
    sources: {
      'arcweb-basemap': {
        type: 'raster',
        tiles: [selected.url],
        tileSize: 256,
        attribution: selected.attribution,
      },
    },
    layers: [{ id: 'arcweb-basemap', type: 'raster', source: 'arcweb-basemap' }],
  }
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function distanceBetween(a: [number, number], b: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const [lat1, lat2] = [radians(a[1]), radians(b[1])]
  const deltaLat = lat2 - lat1
  const deltaLon = radians(b[0] - a[0])
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function polygonArea(points: [number, number][]) {
  if (points.length < 3) return 0
  const radius = 6371008.8
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    total += (next[0] - current[0]) * Math.PI / 180 *
      (2 + Math.sin(current[1] * Math.PI / 180) + Math.sin(next[1] * Math.PI / 180))
  }
  return Math.abs(total * radius * radius / 2)
}

function LayerIcon({ geometry }: { geometry: MapLayer['geometry'] }) {
  if (geometry === 'Point') return <Circle size={15} strokeWidth={2.2} />
  if (geometry === 'Line') return <MoveRight size={16} strokeWidth={2.2} />
  if (geometry === 'Polygon') return <Triangle size={15} strokeWidth={2.2} />
  if (geometry === 'Unknown') return <Table2 size={15} />
  return <Layers3 size={15} />
}

function ContentsRendererLegend({ layer }: { layer: MapLayer }) {
  if (layer.renderer.type === 'single') return null
  const graduatedCounts = layer.renderer.type === 'graduated' ? getGraduatedClassCounts(layer, layer.renderer) : []
  const classes = layer.renderer.type === 'unique'
    ? getUniqueValueClasses(layer, layer.renderer.field, layer.renderer)
    : getGraduatedClasses(layer.renderer).map((item, index) => ({
      ...item,
      count: graduatedCounts[index],
    }))
  return (
    <div className="contents-class-list">
      {classes.map((item) => <div className="contents-class-row" key={item.value} title={item.label}>
        <span className={`contents-class-swatch geometry-${layer.geometry.toLowerCase()} shape-${layer.pointShape}`} style={{ backgroundColor: item.color, borderColor: layer.geometry === 'Point' ? layer.strokeColor : item.color, opacity: layer.opacity * layer.fillOpacity }} />
        <span className="contents-class-label">{item.label}</span>
        <span className="contents-class-count">{item.count.toLocaleString()}</span>
      </div>)}
    </div>
  )
}

function ribbonText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement(child)) return ribbonText((child.props as { children?: ReactNode }).children)
    return ''
  }).join(' ').replace(/\s+/g, ' ').trim()
}

function addRibbonTooltips(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child
    const props = child.props as { title?: string; 'aria-label'?: string; children?: ReactNode }
    const children = addRibbonTooltips(props.children)
    if (child.type === 'button') {
      const label = props.title?.trim() || props['aria-label']?.trim() || ribbonText(props.children)
      if (!label) return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, children)
      return cloneElement(child as ReactElement<Record<string, unknown>>, {
        title: undefined,
        'data-ribbon-tooltip': label,
        'aria-label': props['aria-label'] ?? label,
      }, children)
    }
    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, children)
  })
}

function getPositions(value: unknown, path: number[] = [], result: { coordinate: Position; path: number[] }[] = []) {
  if (!Array.isArray(value)) return result
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    result.push({ coordinate: value as Position, path })
    return result
  }
  value.forEach((child, index) => getPositions(child, [...path, index], result))
  return result
}

function snapCoordinate(
  map: MapLibreMap,
  event: maplibregl.MapMouseEvent,
  layers: MapLayer[],
  exclude?: FeatureSelection | null,
): [number, number] {
  const renderedLayers = getRenderedFeatureLayerIds(map, layers)
  if (!renderedLayers.length) return [event.lngLat.lng, event.lngLat.lat]
  const point = event.point
  const rendered = map.queryRenderedFeatures([
    [point.x - 10, point.y - 10],
    [point.x + 10, point.y + 10],
  ], { layers: renderedLayers })
  let closest: { coordinate: Position; distance: number } | null = null
  for (const candidate of rendered) {
    if (!candidate.geometry) continue
    const candidateLayer = layers.find((layer) => getLayerIds(layer.id).source === candidate.source)
    if (exclude && candidateLayer?.id === exclude.layerId && candidate.id === exclude.featureId) continue
    if (!('coordinates' in candidate.geometry)) continue
    for (const vertex of getPositions(candidate.geometry.coordinates)) {
      const projected = map.project([vertex.coordinate[0], vertex.coordinate[1]])
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
      if (distance <= 10 && (!closest || distance < closest.distance)) closest = { coordinate: vertex.coordinate, distance }
    }
  }
  return closest
    ? [closest.coordinate[0], closest.coordinate[1]]
    : [event.lngLat.lng, event.lngLat.lat]
}

/** Every feature drawn within a few pixels of `point` (the tolerance makes points and thin lines easy to hit). */
function queryFeaturesAt(map: MapLibreMap, point: { x: number; y: number }, layers: MapLayer[]): FeatureSelection[] {
  const visibleLayerIds = getRenderedFeatureLayerIds(map, layers)
  if (!visibleLayerIds.length) return []
  const rendered = map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers: visibleLayerIds })
  const hits: FeatureSelection[] = []
  for (const candidate of rendered) {
    const layer = layers.find((item) => getLayerIds(item.id).source === candidate.source)
    if (!layer || candidate.id === undefined) continue
    // A feature drawn across several tiles is reported once per tile.
    if (!hits.some((hit) => hit.layerId === layer.id && hit.featureId === candidate.id)) {
      hits.push({ layerId: layer.id, featureId: candidate.id as FeatureId })
    }
  }
  return hits
}

function nearestVertexPath(map: MapLibreMap, feature: Feature<Geometry>, position: maplibregl.Point) {
  if (feature.geometry.type === 'GeometryCollection') return null
  let nearest: { path: number[]; distance: number } | null = null
  for (const vertex of getPositions(feature.geometry.coordinates)) {
    const projected = map.project([vertex.coordinate[0], vertex.coordinate[1]])
    const distance = Math.hypot(projected.x - position.x, projected.y - position.y)
    if (!nearest || distance < nearest.distance) nearest = { path: vertex.path, distance }
  }
  return nearest && nearest.distance <= 18 ? nearest : null
}

function replaceCoordinate(value: unknown, path: number[], coordinate: [number, number]): unknown {
  if (!path.length) return coordinate
  if (!Array.isArray(value)) return value
  const [index, ...remaining] = path
  const copy = [...value]
  copy[index] = replaceCoordinate(copy[index], remaining, coordinate)
  return copy
}

function createSketchFeature(layer: MapLayer, geometry: Geometry) {
  const properties = Object.fromEntries((layer.customFields ?? []).map((field) => [field, '']))
  return {
    type: 'Feature' as const,
    id: `${layer.id}:${crypto.randomUUID()}`,
    properties,
    geometry,
  }
}

function styleRasterCells(layer: MapLayer): MapLayer {
  const values = layer.data.features
    .map((feature) => feature.properties?.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (!values.length) return layer
  const breaks: number[] = []
  for (let index = 1; index < 8; index += 1) {
    const value = values[Math.floor(index * values.length / 8)]
    if (value !== undefined && value > (breaks[breaks.length - 1] ?? -Infinity)) breaks.push(value)
  }
  const palette = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#a50026']
  const colors = Array.from({ length: breaks.length + 1 }, (_, index) =>
    palette[Math.round(index * (palette.length - 1) / Math.max(1, breaks.length))],
  )
  return {
    ...layer,
    opacity: 1,
    strokeWidth: 0,
    fillColor: colors[0] ?? layer.fillColor,
    strokeColor: colors[0] ?? layer.strokeColor,
    renderer: { type: 'graduated', field: 'value', method: 'quantile', breaks, colors },
  }
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapHostRef = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const layoutPageRef = useRef<HTMLDivElement>(null)
  const settingsHydratedRef = useRef(false)
  const workspaceHydratedRef = useRef(false)
  const skipWorkspacePersistRef = useRef(false)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const [identify, setIdentify] = useState<IdentifyState | null>(null)
  const [selectionDialog, setSelectionDialog] = useState<'attributes' | 'location' | null>(null)
  const [bookmarkAnchor, setBookmarkAnchor] = useState<{ left: number; top: number } | null>(null)
  const [pendingProject, setPendingProject] = useState<ArcWebProject | null>(null)
  const hydratedRef = useRef(false)
  const toastTimerRef = useRef<number | null>(null)
  const toolExecutionIdRef = useRef(0)
  const previousBasemapRef = useRef<BasemapId>('osm')
  const measurePointsRef = useRef<[number, number][]>([])
  const sketchPointsRef = useRef<[number, number][]>([])
  const movingVertexRef = useRef<{ layerId: string; featureId: string | number; path: number[] } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'warning' } | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const [sketchPoints, setSketchPoints] = useState<[number, number][]>([])
  const [mapLoaded, setMapLoaded] = useState(false)
  const [sceneView, setSceneView] = useState(false)
  const sceneViewRef = useRef(false)
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null)
  const [zoom, setZoom] = useState(3.15)
  const [layerSearch, setLayerSearch] = useState('')
  const [importingFile, setImportingFile] = useState<{ name: string; index: number; total: number } | null>(null)
  const [toolExecutionProgress, setToolExecutionProgress] = useState<{ name: string; current: number; total: number; message: string } | null>(null)
  const [mapFrameHost, setMapFrameHost] = useState<HTMLDivElement | null>(null)
  const [layoutExporting, setLayoutExporting] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const quickMarkersRef = useRef<maplibregl.Marker[]>([])
  const [quickMarkerCount, setQuickMarkerCount] = useState(0)
  const [mapViewInfo, setMapViewInfo] = useState<MapViewInfo | null>(null)

  const layers = useArcWebStore((state) => state.layers)
  const selectedLayerId = useArcWebStore((state) => state.selectedLayerId)
  const selectedFeature = useArcWebStore((state) => state.selectedFeature)
  const selections = useArcWebStore((state) => state.selections)
  const bookmarks = useArcWebStore((state) => state.bookmarks)
  const projectName = useArcWebStore((state) => state.projectName)
  const tableOpen = useArcWebStore((state) => state.tableOpen)
  const workspaceLayout = useArcWebStore((state) => state.workspaceLayout)
  const basemap = useArcWebStore((state) => state.basemap)
  const theme = useArcWebStore((state) => state.theme)
  const activeTab = useArcWebStore((state) => state.activeTab)
  const tool = useArcWebStore((state) => state.tool)
  const displayCrs = useArcWebStore((state) => state.displayCrs)
  const viewMode = useArcWebStore((state) => state.viewMode)
  const mapPropertiesOpen = useArcWebStore((state) => state.mapPropertiesOpen)
  const layoutPaper = useLayoutStore((state) => state.paper)
  const layoutOrientation = useLayoutStore((state) => state.orientation)
  const layoutElements = useLayoutStore((state) => state.elements)
  const tableHeight = workspaceLayout.panels.attributeTable.frame.height
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null
  const selectedFeatureIsEditable = Boolean(
    selectedLayer &&
    selectedFeature?.layerId === selectedLayer.id &&
    selectedLayer.data.features.some((feature) => feature.id === selectedFeature.featureId),
  )
  const filteredLayers = useMemo(() => layers.filter((layer) => layer.name.toLowerCase().includes(layerSearch.toLowerCase())), [layers, layerSearch])

  // Contextual ribbon tabs follow the selected layer type and the edit session.
  const editSnapshots = useArcWebStore((state) => state.editSnapshots)
  const analysisHistory = useArcWebStore((state) => state.analysisHistory)
  const undoStack = useArcWebStore((state) => state.undoStack)
  const redoStack = useArcWebStore((state) => state.redoStack)
  const tableViews = useArcWebStore((state) => state.tableViews)
  const sceneSettings = useArcWebStore((state) => state.sceneSettings)
  const [terrainState, setTerrainState] = useState<TerrainState>({ warning: null, range: null })
  const pendingEditLayerNames = useMemo(() => layers
    .filter((layer) => editSnapshots[layer.id] !== undefined && editSnapshots[layer.id] !== layer.data)
    .map((layer) => layer.name), [layers, editSnapshots])
  const visibleContextualTabs = getVisibleContextualTabs({ selectedLayer, tool, pendingEdits: pendingEditLayerNames.length > 0 })
  const visibleContextualKey = visibleContextualTabs.join('|')
  const previousContextualTabsRef = useRef<ContextualTab[]>([])
  /** Treats the current context as already seen, so restoring a session does not hijack the ribbon. */
  const adoptRibbonContext = useCallback(() => {
    const state = useArcWebStore.getState()
    previousContextualTabsRef.current = getVisibleContextualTabs({
      selectedLayer: state.layers.find((layer) => layer.id === state.selectedLayerId) ?? null,
      tool: state.tool,
      pendingEdits: hasPendingEdits(state.layers, state.editSnapshots),
    })
  }, [])
  useEffect(() => {
    const next = visibleContextualKey ? visibleContextualKey.split('|') as ContextualTab[] : []
    const state = useArcWebStore.getState()
    const result = reconcileRibbonTabs({ activeTab: state.activeTab, returnTab: state.ribbonReturnTab }, previousContextualTabsRef.current, next)
    previousContextualTabsRef.current = next
    if (result.activeTab !== state.activeTab || result.returnTab !== state.ribbonReturnTab) state.setRibbonTabs(result.activeTab, result.returnTab)
  }, [visibleContextualKey])

  const notify = useCallback((message: string, kind: 'success' | 'error' | 'warning' = 'success') => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    setToast({ message, kind })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const updatePanelFrame = useCallback((panelId: WorkspacePanelId, frame: PanelFrame) => {
    const state = useArcWebStore.getState()
    const current = state.workspaceLayout
    state.setWorkspaceLayout({
      ...current,
      panels: { ...current.panels, [panelId]: { ...current.panels[panelId], frame } },
    })
  }, [])
  const updateContentsFrame = useCallback((frame: PanelFrame) => updatePanelFrame('contents', frame), [updatePanelFrame])
  const updateGeoprocessingFrame = useCallback((frame: PanelFrame) => updatePanelFrame('geoprocessing', frame), [updatePanelFrame])
  const updateAttributeTableFrame = useCallback((frame: PanelFrame) => updatePanelFrame('attributeTable', frame), [updatePanelFrame])
  const updateSymbologyFrame = useCallback((frame: PanelFrame) => updatePanelFrame('symbology', frame), [updatePanelFrame])

  const togglePanelFloating = useCallback((panelId: WorkspacePanelId) => {
    const state = useArcWebStore.getState()
    const current = state.workspaceLayout
    const panel = current.panels[panelId]
    const floating = !panel.floating
    const maxLeft = Math.max(0, window.innerWidth - Math.min(panel.frame.width, Math.max(0, window.innerWidth - 12)))
    const maxTop = Math.max(0, window.innerHeight - Math.min(panel.frame.height, Math.max(0, window.innerHeight - 12)))
    const frame = floating ? {
      ...panel.frame,
      left: Math.max(0, Math.min(panel.frame.left, maxLeft)),
      top: Math.max(0, Math.min(panel.frame.top, maxTop)),
    } : panel.frame
    state.setWorkspaceLayout({
      ...current,
      panels: { ...current.panels, [panelId]: { ...panel, floating, frame } },
    })
  }, [])

  const selectWorkspacePreset = useCallback((preset: WorkspacePreset) => {
    const state = useArcWebStore.getState()
    state.setWorkspaceLayout(applyWorkspacePreset(state.workspaceLayout, preset))
    setSceneView(false)
    if (preset === 'analysis') {
      state.setActiveTab('Analysis')
      state.setViewMode('map')
    } else if (preset === 'cartography') {
      state.setActiveTab('Layout')
      state.setViewMode('layout')
    } else {
      state.setActiveTab('Map')
      state.setViewMode('map')
    }
  }, [])

  const toggleFullCanvas = useCallback(() => {
    const state = useArcWebStore.getState()
    state.setWorkspaceLayout({ ...state.workspaceLayout, fullCanvas: !state.workspaceLayout.fullCanvas })
  }, [])
  const workspaceStorageErrorRef = useRef(false)
  const reportWorkspaceStorageError = useCallback((message: string) => {
    if (workspaceStorageErrorRef.current) return
    workspaceStorageErrorRef.current = true
    window.setTimeout(() => notify(message, 'error'), 0)
  }, [notify])
  const persistWorkspaceLayout = useCallback((layout: ReturnType<typeof normalizeWorkspaceLayout>) => {
    try {
      window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
      workspaceStorageErrorRef.current = false
    } catch (error) {
      reportWorkspaceStorageError(`Could not save the panel layout: ${error instanceof Error ? error.message : 'Browser storage error'}`)
    }
  }, [reportWorkspaceStorageError])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    let active = true
    void Promise.all([get<MapLayer[]>(STORAGE_KEY), get<Record<string, FeatureCollection>>(EDIT_SESSION_KEY)]).then(([saved, snapshots]) => {
      if (!active) return
      if (saved?.length) {
        const state = useArcWebStore.getState()
        state.restoreLayers(saved)
        if (snapshots && typeof snapshots === 'object') {
          state.restoreEditSnapshots(snapshots)
          const resumed = Object.keys(useArcWebStore.getState().editSnapshots)
            .map((layerId) => useArcWebStore.getState().layers.find((layer) => layer.id === layerId)?.name)
            .filter((name): name is string => Boolean(name)).map((name) => isolate(name))
          if (resumed.length) notify(`Resumed your edit session: unsaved edits in ${resumed.join(', ')}. Save or Discard them from the Edit Tools tab.`, 'warning')
        }
        adoptRibbonContext()
      }
      hydratedRef.current = true
    }).catch((error: unknown) => {
      if (active) {
        hydratedRef.current = true
        notify(`Could not restore the saved workspace: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
      }
    })
    return () => { active = false }
  }, [notify, adoptRibbonContext])

  useEffect(() => {
    if (!hydratedRef.current) return
    void set(STORAGE_KEY, layers).catch((error: unknown) => {
      notify(`Could not save this workspace locally: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
    })
  }, [layers, notify])

  useEffect(() => {
    if (!hydratedRef.current) return
    void set(EDIT_SESSION_KEY, editSnapshots).catch(() => undefined)
  }, [editSnapshots])

  useEffect(() => {
    let restored = false
    try {
      const saved = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)
      if (saved) {
        useArcWebStore.getState().setWorkspaceLayout(normalizeWorkspaceLayout(JSON.parse(saved)))
        restored = true
      }
    } catch (error) {
      reportWorkspaceStorageError(`Could not restore the saved panel layout: ${error instanceof Error ? error.message : 'Browser storage error'}`)
    }
    workspaceHydratedRef.current = true
    skipWorkspacePersistRef.current = true
    if (!restored) persistWorkspaceLayout(useArcWebStore.getState().workspaceLayout)
  }, [persistWorkspaceLayout, reportWorkspaceStorageError])

  useEffect(() => {
    if (!workspaceHydratedRef.current) return
    if (skipWorkspacePersistRef.current) {
      skipWorkspacePersistRef.current = false
      return
    }
    persistWorkspaceLayout(workspaceLayout)
  }, [workspaceLayout, persistWorkspaceLayout])

  useEffect(() => {
    if (!workspaceHydratedRef.current) return
    if (workspaceLayout.preset === 'analysis') {
      useArcWebStore.getState().setActiveTab('Analysis')
      useArcWebStore.getState().setViewMode('map')
    } else if (workspaceLayout.preset === 'cartography') {
      useArcWebStore.getState().setActiveTab('Layout')
      useArcWebStore.getState().setViewMode('layout')
    }
  }, [workspaceLayout.preset])

  // Map settings (display coordinate system and print layout) persist separately from the layer data.
  useEffect(() => {
    let active = true
    void get<SavedSettings>(SETTINGS_KEY).then((saved) => {
      if (!active) return
      if (saved?.displayCrs && getCrs(saved.displayCrs)) useArcWebStore.getState().setDisplayCrs(saved.displayCrs)
      if (saved?.layout) useLayoutStore.getState().restore(saved.layout)
      if (Array.isArray(saved?.bookmarks)) useArcWebStore.getState().setBookmarks(saved.bookmarks)
      if (saved?.projectName) useArcWebStore.getState().setProjectName(saved.projectName)
      // Validated like a project file, since browser storage can hold data from an older ArcWeb.
      const state = useArcWebStore.getState()
      if (saved?.sceneSettings) state.setSceneSettings(parseSceneSettings(saved.sceneSettings))
      if (saved?.analysisHistory) state.setAnalysisHistory(parseAnalysisHistory(saved.analysisHistory))
      if (saved?.tableViews) state.setTableViews(parseTableViews(saved.tableViews, new Set(Object.keys(saved.tableViews as object))))
    }).catch(() => undefined).finally(() => {
      if (active) settingsHydratedRef.current = true
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!settingsHydratedRef.current) return
    const settings: SavedSettings = {
      displayCrs,
      layout: { paper: layoutPaper, orientation: layoutOrientation, elements: layoutElements },
      bookmarks,
      projectName,
      sceneSettings,
      analysisHistory,
      tableViews,
    }
    void set(SETTINGS_KEY, settings).catch(() => undefined)
  }, [displayCrs, layoutPaper, layoutOrientation, layoutElements, bookmarks, projectName, sceneSettings, analysisHistory, tableViews])


  const updateMeasure = useCallback((map: MapLibreMap, points: [number, number][], mode: 'distance' | 'area' | 'pan') => {
    const features: Feature<Geometry>[] = points.map((coordinates) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates },
    }))
    if (points.length > 1) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: mode === 'area' && points.length > 2
          ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
          : { type: 'LineString', coordinates: points },
      })
    }
    setMeasureOverlay(map, features)
  }, [])

  const updateSketch = useCallback((map: MapLibreMap, points: [number, number][], mode: ToolMode) => {
    const features: Feature<Geometry>[] = points.map((coordinates) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates },
    }))
    if (points.length > 1) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: mode === 'draw-polygon' && points.length > 2
          ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
          : { type: 'LineString', coordinates: points },
      })
    }
    setSketchOverlay(map, features)
  }, [])

  const appendFeature = useCallback((layer: MapLayer, geometry: Geometry) => {
    const feature = createSketchFeature(layer, geometry)
    const data: FeatureCollection = { ...layer.data, features: [...layer.data.features, feature] }
    useArcWebStore.getState().commitEdit(layer.id, data, `Add ${geometry.type.toLowerCase()} feature`)
    useArcWebStore.getState().setSelectedFeature({ layerId: layer.id, featureId: feature.id })
    useArcWebStore.getState().setTableOpen(true)
    notify(`Added a ${geometry.type} feature to ${isolate(layer.name)}.`)
  }, [notify])

  const finishSketch = useCallback(() => {
    const state = useArcWebStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    const coordinates = sketchPointsRef.current.filter((coordinate, index, list) =>
      index === 0 || coordinate[0] !== list[index - 1][0] || coordinate[1] !== list[index - 1][1])
    if (!layer || (state.tool !== 'draw-line' && state.tool !== 'draw-polygon')) {
      if (state.tool === 'draw-line' || state.tool === 'draw-polygon') notify('Select a target layer before drawing.')
      return
    }
    if (state.tool === 'draw-line' && coordinates.length < 2) {
      notify('A line needs at least two vertices.', 'warning')
      return
    }
    if (state.tool === 'draw-polygon' && coordinates.length < 3) {
      notify('A polygon needs at least three vertices.', 'warning')
      return
    }
    if (state.tool === 'draw-line') {
      appendFeature(layer, { type: 'LineString', coordinates })
    } else {
      appendFeature(layer, { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] })
    }
    sketchPointsRef.current = []
    setSketchPoints([])
    if (mapRef.current) updateSketch(mapRef.current, [], 'pan')
    state.setTool('pan')
  }, [appendFeature, notify, updateSketch])

  /** Selects the first hit and opens the Identify pop-up next to a viewport point. */
  const showIdentify = useCallback((hits: FeatureSelection[], client: { x: number; y: number }, lngLat: [number, number]) => {
    const state = useArcWebStore.getState()
    state.setSelectedLayer(hits[0].layerId)
    state.setSelectedFeature(hits[0])
    const bounds = workspaceRef.current?.getBoundingClientRect()
    const x = client.x - (bounds?.left ?? 0)
    const y = client.y - (bounds?.top ?? 0)
    setIdentify({
      key: Date.now(),
      hits,
      index: 0,
      x: Math.max(8, Math.min(x + 18, (bounds?.width ?? 900) - 328)),
      y: Math.max(8, Math.min(y - 24, (bounds?.height ?? 600) - 380)),
      lngLat,
    })
  }, [])

  const handleMapClick = useCallback((map: MapLibreMap, event: maplibregl.MapMouseEvent) => {
    const state = useArcWebStore.getState()
    const activeTool = state.tool
    if (activeTool === 'distance' || activeTool === 'area') {
      const next = [...measurePointsRef.current, [event.lngLat.lng, event.lngLat.lat] as [number, number]]
      measurePointsRef.current = next
      setMeasurePoints(next)
      updateMeasure(map, next, activeTool)
      return
    }
    if (activeTool === 'draw-point' || activeTool === 'draw-line' || activeTool === 'draw-polygon') {
      const layer = state.layers.find((item) => item.id === state.selectedLayerId)
      if (!layer) {
        notify('Create or select a target layer before drawing.', 'warning')
        return
      }
      const expectedGeometry = activeTool === 'draw-point' ? 'Point' : activeTool === 'draw-line' ? 'Line' : 'Polygon'
      if (layer.geometry !== 'Unknown' && layer.geometry !== 'Mixed' && layer.geometry !== expectedGeometry) {
        notify(`${isolate(layer.name)} stores ${layer.geometry.toLowerCase()} features; choose a matching sketch tool.`, 'warning')
        return
      }
      const coordinate = snapCoordinate(map, event, state.layers)
      if (activeTool === 'draw-point') {
        appendFeature(layer, { type: 'Point', coordinates: coordinate })
        return
      }
      const next = [...sketchPointsRef.current, coordinate]
      sketchPointsRef.current = next
      setSketchPoints(next)
      updateSketch(map, next, activeTool)
      return
    }
    if (activeTool === 'move-vertex') {
      const selection = state.selectedFeature
      const layer = selection && state.layers.find((item) => item.id === selection.layerId)
      const feature = layer?.data.features.find((item) => item.id === selection?.featureId)
      if (!layer || !feature?.geometry || feature.geometry.type === 'GeometryCollection') {
        movingVertexRef.current = null
        notify('Select a feature with an editable geometry first.', 'warning')
        return
      }
      const pending = movingVertexRef.current
      if (pending?.layerId === layer.id && pending.featureId === selection.featureId) {
        const coordinate = snapCoordinate(map, event, state.layers, selection)
        const nextFeature = {
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: replaceCoordinate(feature.geometry.coordinates, pending.path, coordinate),
          },
        } as Feature<Geometry>
        const data: FeatureCollection = {
          ...layer.data,
          features: layer.data.features.map((item) => item.id === selection.featureId ? nextFeature : item),
        }
        useArcWebStore.getState().commitEdit(layer.id, data, 'Move vertex')
        movingVertexRef.current = null
        notify('Feature vertex moved.')
        return
      }
      movingVertexRef.current = null
      const nearest = nearestVertexPath(map, feature as Feature<Geometry>, event.point)
      if (!nearest) {
        notify('Click within 18 px of a vertex to select it.', 'warning')
        return
      }
      movingVertexRef.current = { layerId: layer.id, featureId: selection.featureId, path: nearest.path }
      notify('Vertex selected. Click its new location.')
      return
    }

    // Explore tool: identify every feature under the pointer.
    const hits = queryFeaturesAt(map, event.point, state.layers)
    if (!hits.length) {
      state.setSelectedFeature(null)
      setIdentify(null)
      return
    }
    // Ctrl/Cmd+click adds or removes the feature from the selection. (Shift+click cannot be
    // used: MapLibre reserves Shift for box zoom and suppresses the click.)
    if (event.originalEvent.ctrlKey || event.originalEvent.metaKey) {
      state.toggleSelected(hits[0].layerId, hits[0].featureId)
      return
    }
    showIdentify(hits, { x: event.originalEvent.clientX, y: event.originalEvent.clientY }, [event.lngLat.lng, event.lngLat.lat])
  }, [appendFeature, notify, showIdentify, updateMeasure, updateSketch])

  useEffect(() => {
    const host = mapHostRef.current
    if (!host) return
    // The map lives in a container React does not own, so it can be moved into the
    // layout's map frame and back without re-creating the MapLibre instance.
    const container = document.createElement('div')
    container.className = 'map-canvas'
    host.appendChild(container)
    mapContainerRef.current = container
    const map = new maplibregl.Map({
      container,
      style: baseStyle('osm'),
      center: [-98, 39],
      zoom: 3.15,
      attributionControl: false,
      maxZoom: 20,
      // Terrain views need a lower horizon than the 60° default.
      maxPitch: 85,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    const onReady = () => {
      if (!map.isStyleLoaded()) {
        map.once('idle', onReady)
        return
      }
      ensureMapOverlays(map)
      syncMapLayers(map, useArcWebStore.getState().layers, sceneViewRef.current)
      setSelectionOverlay(map, useArcWebStore.getState().layers, useArcWebStore.getState().selectedFeature, useArcWebStore.getState().selections)
      setZoom(map.getZoom())
      window.requestAnimationFrame(() => {
        setMapInstance(map)
        setMapLoaded(true)
      })
    }
    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      setCursor([event.lngLat.lng, event.lngLat.lat])
    }
    const onZoom = () => setZoom(map.getZoom())
    const onClick = (event: maplibregl.MapMouseEvent) => handleMapClick(map, event)
    let rightDown: { x: number; y: number } | null = null
    const onMouseDown = (event: maplibregl.MapMouseEvent) => {
      if (event.originalEvent.button === 2) rightDown = { x: event.point.x, y: event.point.y }
    }
    const onContextMenu = (event: maplibregl.MapMouseEvent) => {
      event.originalEvent.preventDefault()
      const wasClick = isRightClickGesture(rightDown, event.point)
      rightDown = null
      // Skip the end of a right-drag rotation, and the map frame inside the print layout.
      if (!wasClick || useArcWebStore.getState().viewMode !== 'map') return
      setContextMenu({
        kind: 'canvas',
        x: event.originalEvent.clientX,
        y: event.originalEvent.clientY,
        point: { x: event.point.x, y: event.point.y },
        lngLat: [event.lngLat.lng, event.lngLat.lat],
        canIdentify: getRenderedFeatureLayerIds(map, useArcWebStore.getState().layers).length > 0,
      })
    }
    const onDoubleClick = (event: maplibregl.MapMouseEvent) => {
      const activeTool = useArcWebStore.getState().tool
      if (activeTool === 'draw-line' || activeTool === 'draw-polygon') {
        event.preventDefault()
        finishSketch()
      }
    }
    map.once('load', onReady)
    map.on('mousemove', onMouseMove)
    map.on('click', onClick)
    map.on('dblclick', onDoubleClick)
    map.on('zoom', onZoom)
    map.on('mousedown', onMouseDown)
    map.on('contextmenu', onContextMenu)
    return () => {
      map.off('load', onReady)
      map.off('mousemove', onMouseMove)
      map.off('mousedown', onMouseDown)
      map.off('contextmenu', onContextMenu)
      quickMarkersRef.current = []
      setQuickMarkerCount(0)
      map.off('click', onClick)
      map.off('dblclick', onDoubleClick)
      map.off('zoom', onZoom)
      map.remove()
      container.remove()
      mapContainerRef.current = null
      mapRef.current = null
      setMapInstance(null)
    }
  }, [finishSketch, handleMapClick])

  useEffect(() => {
    const workspace = workspaceRef.current
    const map = mapRef.current
    if (!workspace || !map || !mapLoaded) return
    const resizeMap = () => { window.requestAnimationFrame(() => map.resize()) }
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resizeMap)
      return () => window.removeEventListener('resize', resizeMap)
    }
    const observer = new ResizeObserver(resizeMap)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [mapLoaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || previousBasemapRef.current === basemap) return
    previousBasemapRef.current = basemap
    const onStyleReady = () => {
      window.requestAnimationFrame(() => {
        if (!map.isStyleLoaded()) {
          map.once('idle', onStyleReady)
          return
        }
        ensureMapOverlays(map)
        syncMapLayers(map, useArcWebStore.getState().layers, sceneViewRef.current)
        setSelectionOverlay(map, useArcWebStore.getState().layers, useArcWebStore.getState().selectedFeature, useArcWebStore.getState().selections)
        updateMeasure(map, measurePointsRef.current, useArcWebStore.getState().tool === 'area' ? 'area' : 'distance')
        updateSketch(map, sketchPointsRef.current, useArcWebStore.getState().tool)
      })
    }
    map.once('style.load', onStyleReady)
    map.setStyle(baseStyle(basemap))
  }, [basemap, mapLoaded, updateMeasure, updateSketch])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const syncMapState = () => {
      if (mapRef.current !== map) return
      if (!map.isStyleLoaded()) {
        map.once('idle', syncMapState)
        return
      }
      const state = useArcWebStore.getState()
      syncMapLayers(map, state.layers, sceneView)
      setSelectionOverlay(map, state.layers, state.selectedFeature, state.selections)
    }
    syncMapState()
  }, [layers, mapLoaded, selectedFeature, selections, sceneView])

  useEffect(() => {
    sceneViewRef.current = sceneView
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (sceneView) map.dragRotate.enable()
    else map.dragRotate.disable()
    // Leaving 3D also returns the map to north-up.
    map.easeTo(sceneView ? { pitch: 60, duration: 350 } : { pitch: 0, bearing: 0, duration: 350 })
    if (viewMode !== 'layout' && map.isStyleLoaded()) {
      syncMapLayers(map, useArcWebStore.getState().layers, sceneView)
    }
  }, [sceneView, mapLoaded, viewMode])

  // Terrain follows the scene settings, the DEM layer's data and basemap swaps (which rebuild the style).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      if (!map.isStyleLoaded()) {
        map.once('idle', apply)
        return
      }
      try {
        setTerrainState(applySceneTerrain(map, sceneSettings, layers, sceneView && viewMode === 'map'))
      } catch (error) {
        setTerrainState({ warning: `Terrain could not be shown: ${error instanceof Error ? error.message : 'MapLibre error'}`, range: null })
      }
    }
    apply()
    return () => { cancelled = true }
  }, [sceneSettings, layers, sceneView, viewMode, mapLoaded, basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (tool !== 'move-vertex') movingVertexRef.current = null
    if (tool === 'pan') {
      map.doubleClickZoom.enable()
      updateMeasure(map, [], 'pan')
      updateSketch(map, [], 'pan')
      map.getCanvas().style.cursor = 'grab'
      return
    }
    if (tool === 'draw-line' || tool === 'draw-polygon' || tool === 'area' || tool === 'distance') map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
    map.getCanvas().style.cursor = 'crosshair'
    if (tool === 'distance' || tool === 'area') updateMeasure(map, measurePointsRef.current, tool)
    if (tool === 'draw-line' || tool === 'draw-polygon') updateSketch(map, sketchPointsRef.current, tool)
  }, [tool, mapLoaded, updateMeasure, updateSketch])

  /** Replaces the whole workspace with the contents of a project file. */
  const applyProject = useCallback((project: ArcWebProject) => {
    const state = useArcWebStore.getState()
    state.restoreLayers(project.layers)
    state.setBasemap(project.map.basemap)
    state.setDisplayCrs(project.map.displayCrs)
    state.setBookmarks(project.map.bookmarks)
    state.setSceneSettings(project.map.scene)
    state.setAnalysisHistory(project.analysisHistory)
    state.setTableViews(project.tableViews)
    state.setProjectName(project.name)
    state.setTableOpen(false)
    state.setTool('pan')
    adoptRibbonContext()
    state.setWorkspaceLayout(project.workspaceLayout)
    if (project.workspaceLayout.preset === 'analysis') {
      state.setActiveTab('Analysis')
      state.setViewMode('map')
    } else if (project.workspaceLayout.preset === 'cartography') {
      state.setActiveTab('Layout')
      state.setViewMode('layout')
    } else {
      state.setActiveTab('Map')
      state.setViewMode('map')
    }
    setSceneView(false)
    useLayoutStore.getState().restore(project.layout)
    setIdentify(null)
    setPendingProject(null)
    const camera = project.map.camera
    if (camera) mapRef.current?.jumpTo(camera)
    notify(`Opened project “${isolate(project.name)}” — ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}, ${project.layout.elements.length} layout elements, ${project.map.bookmarks.length} bookmark${project.map.bookmarks.length === 1 ? '' : 's'}.`)
  }, [notify, adoptRibbonContext])

  const loadProjectFile = useCallback(async (file: File) => {
    try {
      const layout = useLayoutStore.getState()
      const project = parseProject(await file.text(), { paper: layout.paper, orientation: layout.orientation, elements: layout.elements })
      // Opening a project discards the current workspace, so ask first when there is something to lose.
      if (useArcWebStore.getState().layers.length) setPendingProject(project)
      else applyProject(project)
    } catch (error) {
      notify(`Could not open ${isolate(file.name)}: ${error instanceof Error ? error.message : 'Unreadable project file.'}`, 'error')
    }
  }, [applyProject, notify])

  const saveProject = useCallback(() => {
    const state = useArcWebStore.getState()
    const layout = useLayoutStore.getState()
    const map = mapRef.current
    const project = buildProject({
      name: state.projectName.trim() || 'Untitled map',
      basemap: state.basemap,
      displayCrs: state.displayCrs,
      camera: map ? { center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() } : null,
      bookmarks: state.bookmarks,
      layers: state.layers,
      layout: { paper: layout.paper, orientation: layout.orientation, elements: layout.elements },
      workspaceLayout: state.workspaceLayout,
      scene: state.sceneSettings,
      analysisHistory: state.analysisHistory,
      tableViews: state.tableViews,
    })
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = projectFileName(project.name)
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify(`Saved ${isolate(anchor.download)} — ${project.layers.length} layer${project.layers.length === 1 ? '' : 's'}, ${(blob.size / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} KB.`)
  }, [notify])

  // Layout view shows the live map inside the map frame; map view puts it back in the workspace.
  useEffect(() => {
    const container = mapContainerRef.current
    const target = viewMode === 'layout' && mapFrameHost ? mapFrameHost : mapHostRef.current
    if (!container || !target || container.parentElement === target) return
    target.appendChild(container)
    mapRef.current?.resize()
  }, [viewMode, mapFrameHost, mapLoaded])

  const importAbortRef = useRef<AbortController | null>(null)
  const cancelImport = useCallback(() => importAbortRef.current?.abort(), [])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files)
    for (const [index, file] of selectedFiles.entries()) {
      const controller = new AbortController()
      importAbortRef.current = controller
      setImportingFile({ name: file.name, index: index + 1, total: selectedFiles.length })
      try {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        if (isProjectFile(file)) {
          await loadProjectFile(file)
          continue
        }
        const loaded: ImportResult = needsMainThread(file.name)
          ? { kind: 'vector', layers: await readGeospatialFile(file) }
          : await runInWorker<ImportRequest, ImportResult>(
            // Worker's handlers take a full MessageEvent; WorkerLike only needs the fields the helper reads.
            () => new Worker(new URL('./workers/import.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike,
            { file },
            { signal: controller.signal },
          )
        if (controller.signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError')
        if (loaded.kind === 'raster') {
          const raster = loaded.grid
          const data = rasterToFeatureCollection(raster)
          if (!data.features.length) throw new Error('The raster has no valid cells to display.')
          const layer = styleRasterCells(createMapLayer(loaded.name, data, raster.crs))
          useArcWebStore.getState().addLayer(layer)
          notify(`Added raster ${isolate(loaded.name)} (${raster.width.toLocaleString()} × ${raster.height.toLocaleString()} cells).`)
          continue
        }
        const imported = loaded.layers
        const warnings = imported.flatMap((item) => item.warnings.map((warning) => `${isolate(item.name)}: ${warning}`))
        const added = imported.map(({ name, data, sourceCrs }) => createMapLayer(name, data, sourceCrs))
        added.forEach((layer) => useArcWebStore.getState().addLayer(layer))
        const result = `Added ${added.length} layer${added.length === 1 ? '' : 's'} from ${isolate(file.name)}`
        notify(warnings.length ? `${result}. ${warnings.join(' ')}` : result, warnings.length ? 'warning' : 'success')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          notify(`Import of ${isolate(file.name)} cancelled.`, 'warning')
          break
        }
        notify(`Could not import ${isolate(file.name)}: ${error instanceof Error ? error.message : 'Unknown file error'}`, 'error')
      } finally {
        if (importAbortRef.current === controller) importAbortRef.current = null
        setImportingFile(null)
      }
    }
  }, [loadProjectFile, notify])

  const zoomToLayer = useCallback((layer: MapLayer) => {
    const bounds = getCollectionBounds([layer.data])
    const map = mapRef.current
    if (!bounds || !map) {
      notify('This layer does not contain coordinates to zoom to.', 'warning')
      return
    }
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 80, maxZoom: 15, duration: 900 })
  }, [notify])

  /** Smooth flight to a layer that keeps the current 3D tilt and heading. */
  const flyToLayer = useCallback((layer: MapLayer) => {
    const bounds = getCollectionBounds([layer.data])
    const map = mapRef.current
    if (!bounds || !map) {
      notify('This layer does not contain coordinates to fly to.', 'warning')
      return
    }
    const camera = map.cameraForBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 80, maxZoom: 16 })
    if (!camera) return
    map.flyTo({ ...camera, pitch: map.getPitch(), bearing: map.getBearing(), duration: 2200, curve: 1.6, essential: true })
  }, [notify])

  const openSymbologyPane = useCallback(() => {
    const state = useArcWebStore.getState()
    state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: !state.workspaceLayout.rightPaneOpen })
  }, [])

  const zoomToAll = useCallback(() => {
    const bounds = getCollectionBounds(layers.filter((layer) => layer.visible).map((layer) => layer.data))
    if (!bounds) {
      notify('Add a visible layer before using Full Extent.', 'warning')
      return
    }
    mapRef.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 76, maxZoom: 14, duration: 900 })
  }, [layers, notify])

  const selectAndZoomFeature = useCallback((layer: MapLayer, feature: Feature) => {
    const featureId = feature.id
    if (featureId === undefined) {
      notify('This feature has no stable ID and cannot be selected in the table.', 'error')
      return
    }
    const state = useArcWebStore.getState()
    state.setSelectedLayer(layer.id)
    state.setSelectedFeature({ layerId: layer.id, featureId })
    state.setTableOpen(true)
    const bounds = feature.geometry ? geometryBounds(feature.geometry) : null
    const map = mapRef.current
    if (!bounds || !map) return
    if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
      map.flyTo({ center: [bounds[0], bounds[1]], zoom: 15, duration: 650 })
    } else {
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 55, maxZoom: 16, duration: 650 })
    }
  }, [notify])

  const deleteFeature = useCallback((layer: MapLayer, featureId: string | number) => {
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.filter((feature) => feature.id !== featureId),
    }
    useArcWebStore.getState().commitEdit(layer.id, data, 'Delete feature')
    if (useArcWebStore.getState().selectedFeature?.featureId === featureId) {
      useArcWebStore.getState().setSelectedFeature(null)
    }
    notify('Feature deleted.')
  }, [notify])

  const addCustomField = useCallback((layer: MapLayer, name: string) => {
    const field = name.trim()
    if (!field) {
      notify('Enter a field name.', 'warning')
      return
    }
    if (layer.data.features.some((feature) => Object.hasOwn(feature.properties ?? {}, field))) {
      notify(`A field named "${isolate(field)}" already exists.`, 'warning')
      return
    }
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => ({
        ...feature,
        properties: { ...(feature.properties ?? {}), [field]: '' },
      })),
    }
    useArcWebStore.getState().updateLayer(layer.id, { data, customFields: [...(layer.customFields ?? []), field] })
    notify(`Added field "${isolate(field)}".`)
  }, [notify])

  const removeCustomField = useCallback((layer: MapLayer, field: string) => {
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) }
        delete properties[field]
        return { ...feature, properties }
      }),
    }
    const fieldAliases = { ...(layer.fieldAliases ?? {}) }
    delete fieldAliases[field]
    useArcWebStore.getState().updateLayer(layer.id, {
      data,
      customFields: (layer.customFields ?? []).filter((name) => name !== field),
      fieldAliases,
      labelField: layer.labelField === field ? '' : layer.labelField,
    })
    notify(`Deleted field "${isolate(field)}".`)
  }, [notify])

  const calculateLayerField = useCallback((layer: MapLayer, name: string, expression: string) => {
    try {
      const data = calculateField(layer.data, name, expression)
      const field = name.trim()
      const existing = layer.data.features.some((feature) => Object.hasOwn(feature.properties ?? {}, field))
      useArcWebStore.getState().updateLayer(layer.id, {
        data,
        customFields: existing ? layer.customFields ?? [] : [...(layer.customFields ?? []), field],
      })
      notify(`Calculated "${isolate(field)}" for ${data.features.length.toLocaleString()} features.`)
    } catch (error) {
      notify(`Field calculation failed: ${error instanceof Error ? error.message : 'Invalid expression.'}`, 'error')
    }
  }, [notify])

  const toolAbortRef = useRef<AbortController | null>(null)
  const cancelTool = useCallback(() => toolAbortRef.current?.abort(), [])

  const executeTool = useCallback(async (toolDefinition: ToolboxTool, parameters: ToolboxParameters, options: { selectedOnly: boolean }) => {
    const executionId = ++toolExecutionIdRef.current
    const startedAt = new Date()
    const startState = useArcWebStore.getState()
    const { parameters: recordedParameters, summary } = describeToolRun(toolDefinition, parameters, startState.layers)
    const record = (status: AnalysisRecord['status'], message: string, outputLayerNames: string[] = []) => {
      useArcWebStore.getState().addAnalysisRecord({
        id: crypto.randomUUID(), toolId: toolDefinition.id, toolName: toolDefinition.name, startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(), status, message, parameters: recordedParameters, summary,
        selectedOnly: options.selectedOnly, outputLayerNames,
      })
    }
    const controller = new AbortController()
    toolAbortRef.current = controller
    setToolExecutionProgress({ name: toolDefinition.name, current: 0, total: 1, message: 'Running' })
    try {
      const state = useArcWebStore.getState()
      const startData = new Map<string, unknown>(state.layers.map((layer) => [layer.id, layer.data]))
      // Tools see only the selected features of layers that have a selection, like ArcGIS Pro.
      const scope = options.selectedOnly ? scopeLayersToSelection(state.layers, state.selections) : { layers: state.layers, scoped: new Map() }
      const onProgress = (progress: { current: number; total: number; message: string }) => {
        if (toolExecutionIdRef.current === executionId) setToolExecutionProgress({ name: toolDefinition.name, ...progress })
      }
      const result = toolDefinition.runsOnMainThread
        ? await toolDefinition.execute({ layers: scope.layers, selectedLayerId: state.selectedLayerId, onProgress }, parameters)
        : await runInWorker<ToolRequest, ToolExecutionResult>(
          // Worker's handlers take a full MessageEvent; WorkerLike only needs the fields the helper reads.
          () => new Worker(new URL('./workers/tool.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike,
          { toolId: toolDefinition.id, layers: scope.layers, selectedLayerId: state.selectedLayerId, parameters },
          { signal: controller.signal, onProgress },
        )
      if (controller.signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError')
      // The tool ran on a snapshot; if the user edited an input layer meanwhile, discard the whole run.
      const staleIds = changedLayerIds(startData, useArcWebStore.getState().layers, (result.updates ?? []).map((update) => update.layerId))
      if (staleIds.length > 0) {
        const staleName = startState.layers.find((layer) => layer.id === staleIds[0])?.name ?? 'A layer'
        const staleMessage = `${isolate(staleName)} changed while the tool ran; run it again.`
        record('failed', staleMessage)
        notify(staleMessage, 'warning')
        return
      }
      result.updates?.forEach(({ layerId, updates }) => {
        const subset = scope.scoped.get(layerId)
        const current = useArcWebStore.getState().layers.find((layer) => layer.id === layerId)
        // An in-place edit of a selection subset is merged into the full layer.
        const merged = subset && updates.data && current ? { ...updates, data: mergeScopedData(current.data, subset, updates.data) } : updates
        useArcWebStore.getState().updateLayer(layerId, merged)
      })
      result.layers?.forEach((layer) => useArcWebStore.getState().addLayer(layer))
      record('succeeded', result.message, result.layers?.map((layer) => layer.name))
      result.downloads?.forEach(({ blob, fileName }) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        anchor.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      notify(result.message, result.kind ?? 'success')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        record('failed', 'Cancelled by user.')
        notify(`${toolDefinition.name} cancelled.`, 'warning')
      } else {
        const message = error instanceof Error ? error.message : 'Tool execution error.'
        record('failed', message)
        notify(`${toolDefinition.name} failed: ${message}`, 'error')
      }
    } finally {
      if (toolAbortRef.current === controller) toolAbortRef.current = null
      if (toolExecutionIdRef.current === executionId) setToolExecutionProgress(null)
    }
  }, [notify])

  const createEditableLayer = useCallback((name: string, geometry: 'Point' | 'Line' | 'Polygon', fields: string[]) => {
    const layerName = name.trim()
    if (!layerName) {
      notify('Enter a name for the new layer.', 'warning')
      return
    }
    const layer = createMapLayer(layerName, { type: 'FeatureCollection', features: [] })
    layer.geometry = geometry
    layer.customFields = fields
    useArcWebStore.getState().addLayer(layer)
    useArcWebStore.getState().setTableOpen(true)
    notify(`Created editable ${geometry.toLowerCase()} layer "${isolate(name)}".`)
  }, [notify])

  const setEditingTool = useCallback((nextTool: ToolMode) => {
    sketchPointsRef.current = []
    measurePointsRef.current = []
    movingVertexRef.current = null
    setSketchPoints([])
    setMeasurePoints([])
    const state = useArcWebStore.getState()
    // Picking an editing tool opens (or joins) the edit session for the target layer.
    if (isEditingTool(nextTool) && state.selectedLayerId) state.beginEdit(state.selectedLayerId)
    state.setTool(nextTool)
    if (mapRef.current) {
      updateMeasure(mapRef.current, [], 'pan')
      updateSketch(mapRef.current, [], 'pan')
    }
  }, [updateMeasure, updateSketch])

  const deleteSelectedFeature = useCallback(() => {
    const state = useArcWebStore.getState()
    const selection = state.selectedFeature
    const layer = selection && state.layers.find((item) => item.id === selection.layerId)
    if (layer && selection) deleteFeature(layer, selection.featureId)
    useArcWebStore.getState().setSelectedFeature(null)
  }, [deleteFeature])

  /** Feature IDs the Delete command acts on: the layer's selection set plus the identified feature. */
  const editTargetIds = useMemo(() => {
    if (!selectedLayerId) return []
    const ids = new Set<FeatureId>(selections[selectedLayerId] ?? [])
    if (selectedFeature?.layerId === selectedLayerId) ids.add(selectedFeature.featureId)
    return [...ids]
  }, [selectedLayerId, selections, selectedFeature])

  const deleteSelectedFeatures = useCallback(() => {
    const state = useArcWebStore.getState()
    const layer = state.layers.find((item) => item.id === state.selectedLayerId)
    if (!layer || !editTargetIds.length) return
    const doomed = new Set<FeatureId>(editTargetIds)
    const features = layer.data.features.filter((feature) => feature.id === undefined || !doomed.has(feature.id))
    const removed = layer.data.features.length - features.length
    state.commitEdit(layer.id, { ...layer.data, features }, `Delete ${removed} feature${removed === 1 ? '' : 's'}`)
    state.setSelection(layer.id, [])
    state.setSelectedFeature(null)
    notify(`Deleted ${removed} feature${removed === 1 ? '' : 's'} from ${isolate(layer.name)}. Save or discard from the Edit Tools tab.`)
  }, [editTargetIds, notify])

  const undoEdit = useCallback(() => {
    const label = useArcWebStore.getState().undo()
    if (label) notify(`Undid: ${label}.`)
    else notify('Nothing to undo — the layer changed outside the edit session since the last edit.', 'warning')
  }, [notify])

  const redoEdit = useCallback(() => {
    const label = useArcWebStore.getState().redo()
    if (label) notify(`Redid: ${label}.`)
    else notify('Nothing to redo.', 'warning')
  }, [notify])

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) for the edit session, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const key = event.key.toLowerCase()
      const state = useArcWebStore.getState()
      if (key === 'z' && !event.shiftKey && state.undoStack.length) {
        event.preventDefault()
        undoEdit()
      } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && state.redoStack.length) {
        event.preventDefault()
        redoEdit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoEdit, redoEdit])

  const editCell = useCallback((layerId: string, featureId: FeatureId, field: string, value: unknown) => {
    const layer = useArcWebStore.getState().layers.find((item) => item.id === layerId)
    if (!layer) return
    useArcWebStore.getState().commitEdit(layerId, { ...layer.data, features: setFeatureAttribute(layer.data.features, featureId, field, value) }, `Edit ${field}`)
  }, [])

  const saveEdits = useCallback(() => {
    setEditingTool('pan')
    useArcWebStore.getState().saveEdits()
    notify('Edits saved.')
  }, [notify, setEditingTool])

  const discardEdits = useCallback(() => {
    setEditingTool('pan')
    useArcWebStore.getState().discardEdits()
    notify('Edits discarded; features restored.', 'warning')
  }, [notify, setEditingTool])

  const handleTableResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = tableHeight
    const onMove = (moveEvent: PointerEvent) => {
      const current = useArcWebStore.getState().workspaceLayout.panels.attributeTable.frame
      updatePanelFrame('attributeTable', {
        ...current,
        height: Math.max(170, Math.min(560, startHeight + startY - moveEvent.clientY)),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const exportSelectedLayer = useCallback((layer: MapLayer, format: 'geojson' | 'csv') => {
    try {
      exportLayer(layer, format)
      notify(`Exported ${isolate(layer.name)} as ${format.toUpperCase()}.`)
    } catch (error) {
      notify(`Could not export ${isolate(layer.name)}: ${error instanceof Error ? error.message : 'Export failed.'}`, 'error')
    }
  }, [notify])

  const exportCurrentMap = useCallback(async () => {
    const canvas = mapRef.current?.getCanvas()
    if (!canvas) {
      notify('The map canvas is not ready to export.', 'error')
      return
    }
    try {
      await exportMapCanvas(canvas)
      notify('Map canvas exported as a 2× PNG.')
    } catch (error) {
      notify(`Could not export the map image: ${error instanceof Error ? error.message : 'Image export failed.'}`, 'error')
    }
  }, [notify])

  const toggleTool = (nextTool: 'distance' | 'area') => {
    const state = useArcWebStore.getState()
    state.setTool(state.tool === nextTool ? 'pan' : nextTool)
    measurePointsRef.current = []
    setMeasurePoints([])
    if (mapRef.current) updateMeasure(mapRef.current, [], nextTool)
  }

  const clearMeasurements = () => {
    measurePointsRef.current = []
    setMeasurePoints([])
    if (mapRef.current) updateMeasure(mapRef.current, [], tool === 'area' || tool === 'distance' ? tool : 'pan')
  }

  const clearSession = async () => {
    try {
      await del(STORAGE_KEY)
      useArcWebStore.getState().clearSession()
      clearMeasurements()
      setIdentify(null)
      notify('Workspace cleared. Your basemap and theme are unchanged.')
    } catch (error) {
      notify(`Could not clear the saved workspace: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
    }
  }

  const zoomToSelected = useCallback(() => {
    const state = useArcWebStore.getState()
    const features: Feature[] = []
    for (const layer of state.layers) {
      const ids = new Set<FeatureId>(state.selections[layer.id] ?? [])
      if (state.selectedFeature?.layerId === layer.id) ids.add(state.selectedFeature.featureId)
      if (!ids.size) continue
      for (const feature of layer.data.features) {
        if (feature.id !== undefined && ids.has(feature.id)) features.push(feature)
      }
    }
    const bounds = getCollectionBounds([{ type: 'FeatureCollection', features }])
    const map = mapRef.current
    if (!bounds || !map) {
      notify('Select one or more features first.', 'warning')
      return
    }
    if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
      map.flyTo({ center: [bounds[0], bounds[1]], zoom: Math.max(map.getZoom(), 15), duration: 650 })
    } else {
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 70, maxZoom: 17, duration: 650 })
    }
  }, [notify])

  const clearSelection = useCallback(() => {
    useArcWebStore.getState().clearSelection()
    setIdentify(null)
  }, [])

  /** Applies a Select By Attributes / Location result; returns the layer's resulting selection size. */
  const applySelection = useCallback((layerId: string, featureIds: FeatureId[], method: SelectionMethod) => {
    const state = useArcWebStore.getState()
    state.setSelectedLayer(layerId)
    state.setSelectedFeature(null)
    state.setSelection(layerId, featureIds, method)
    state.setTableOpen(true)
    setIdentify(null)
    return useArcWebStore.getState().selections[layerId]?.length ?? 0
  }, [])

  const addBookmark = useCallback((name: string) => {
    const map = mapRef.current
    if (!map) return
    useArcWebStore.getState().addBookmark({
      id: crypto.randomUUID(),
      name,
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    })
    notify(`Bookmark “${isolate(name)}” saved.`)
  }, [notify])

  const goToBookmark = useCallback((bookmark: Bookmark) => {
    mapRef.current?.flyTo({ center: bookmark.center, zoom: bookmark.zoom, bearing: bookmark.bearing, pitch: bookmark.pitch, duration: 900 })
    setBookmarkAnchor(null)
  }, [])

  const closeBookmarks = useCallback(() => setBookmarkAnchor(null), [])

  const exportLayout = useCallback(async (format: LayoutExportFormat, dpi = 200) => {
    setLayoutExporting(true)
    try {
      if (useArcWebStore.getState().viewMode !== 'layout') {
        setSceneView(false)
        useArcWebStore.getState().setViewMode('layout')
        // Give the sheet time to mount and the live map time to move into its frame.
        await new Promise((resolve) => window.setTimeout(resolve, 400))
      }
      useLayoutStore.getState().select(null)
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
      const page = layoutPageRef.current
      if (!page) throw new Error('The layout sheet is not ready yet.')
      const layout = useLayoutStore.getState()
      const size = pageSize(layout.paper, layout.orientation)
      const result = await exportLayoutSheet({
        page, map: mapRef.current, format, dpi, widthMm: size.width, heightMm: size.height, fileName: 'arcweb-layout',
      })
      notify(result.capped
        ? `Layout exported as ${format.toUpperCase()} at ${result.dpi} dpi (${result.width} × ${result.height} px) — ${dpi} dpi on ${layout.paper} exceeds what the browser can render, so it was reduced.`
        : `Layout exported as ${format.toUpperCase()} — ${layout.paper} ${layout.orientation} at ${result.dpi} dpi (${result.width} × ${result.height} px).`, result.capped ? 'warning' : 'success')
    } catch (error) {
      notify(`Could not export the layout: ${error instanceof Error ? error.message : 'Layout export failed.'}`, 'error')
    } finally {
      setLayoutExporting(false)
    }
  }, [notify])

  const insertLayoutElement = useCallback((type: LayoutElementType) => {
    setSceneView(false)
    useArcWebStore.getState().setViewMode('layout')
    useLayoutStore.getState().addElement(type)
  }, [])

  const openMapProperties = useCallback(() => {
    const map = mapRef.current
    const state = useArcWebStore.getState()
    setMapViewInfo(map ? {
      center: [map.getCenter().lng, map.getCenter().lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      basemap: basemaps.find((item) => item.id === state.basemap)?.name ?? state.basemap,
    } : null)
    setContextMenu(null)
    state.setMapPropertiesOpen(true)
  }, [])

  const pendingRemovalLayer = pendingRemoval ? layers.find((layer) => layer.id === pendingRemoval) ?? null : null

  const toggleLayerTable = useCallback((layerId: string) => {
    const state = useArcWebStore.getState()
    if (state.tableOpen && state.selectedLayerId === layerId && !state.workspaceLayout.tableMinimized) {
      state.setTableOpen(false)
      return
    }
    state.setSelectedLayer(layerId)
    if (state.workspaceLayout.tableMinimized) state.setWorkspaceLayout({ ...state.workspaceLayout, tableMinimized: false })
    state.setTableOpen(true)
  }, [])

  /** Selects the layer and shows the Symbology pane, switching off tabs whose right pane shows something else. */
  const openLayerSymbology = useCallback((layer: MapLayer) => {
    const state = useArcWebStore.getState()
    state.setSelectedLayer(layer.id)
    state.setActiveTab(isRasterLayer(layer) ? 'RasterLayer' : 'FeatureLayer')
    if (!state.workspaceLayout.rightPaneOpen) state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: true })
  }, [])

  const confirmRemoveLayer = useCallback(() => {
    const state = useArcWebStore.getState()
    const index = state.layers.findIndex((item) => item.id === pendingRemoval)
    const layer = state.layers[index]
    setPendingRemoval(null)
    if (!layer) return
    // Keyboard focus continues on the layer that takes this one's place in the list.
    const neighbour = state.layers[index + 1] ?? state.layers[index - 1] ?? null
    state.removeLayer(layer.id)
    notify(`Removed ${isolate(layer.name)} from the map.`)
    focusLayerInContents(neighbour?.id ?? null)
  }, [notify, pendingRemoval])

  const cancelRemoveLayer = useCallback(() => {
    setPendingRemoval(null)
    focusLayerInContents(pendingRemoval)
  }, [pendingRemoval])

  const addQuickMarker = useCallback((lngLat: [number, number]) => {
    const map = mapRef.current
    if (!map) return
    const color = getComputedStyle(document.documentElement).getPropertyValue('--ctx-layer').trim() || '#f4a261'
    const marker = new maplibregl.Marker({ color, draggable: true }).setLngLat(lngLat)
    // Built from DOM nodes, not an HTML string, so nothing user-controlled is ever parsed as markup.
    const body = document.createElement('div')
    body.className = 'quick-marker-popup-body'
    const title = document.createElement('strong')
    title.textContent = `Quick marker ${quickMarkersRef.current.length + 1}`
    const coordinates = document.createElement('span')
    const describe = () => {
      const position = marker.getLngLat()
      coordinates.textContent = formatLngLat([position.lng, position.lat])
    }
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Remove marker'
    remove.addEventListener('click', () => {
      marker.remove()
      quickMarkersRef.current = quickMarkersRef.current.filter((item) => item !== marker)
      setQuickMarkerCount(quickMarkersRef.current.length)
    })
    body.append(title, coordinates, remove)
    describe()
    marker.on('dragend', describe)
    marker.setPopup(new maplibregl.Popup({ offset: 28, closeButton: true, className: 'quick-marker-popup' }).setDOMContent(body))
    marker.addTo(map)
    quickMarkersRef.current = [...quickMarkersRef.current, marker]
    setQuickMarkerCount(quickMarkersRef.current.length)
    notify('Quick marker added. Drag it to move; click it for its coordinates.')
  }, [notify])

  /** Identify Features Here: the Explore click, run at the point the menu was opened. */
  const identifyAtPoint = useCallback((point: { x: number; y: number }, client: { x: number; y: number }, lngLat: [number, number]) => {
    const map = mapRef.current
    if (!map) return
    const hits = queryFeaturesAt(map, point, useArcWebStore.getState().layers)
    if (hits.length) showIdentify(hits, client, lngLat)
    else notify('No features found at this location.', 'warning')
  }, [notify, showIdentify])

  const centerMapAt = useCallback((lngLat: [number, number]) => {
    mapRef.current?.easeTo({ center: lngLat, duration: 450 })
  }, [])

  const clearQuickMarkers = useCallback(() => {
    quickMarkersRef.current.forEach((marker) => marker.remove())
    quickMarkersRef.current = []
    setQuickMarkerCount(0)
  }, [])

  /** Menu entries are data only; choosing one is routed through handleContextMenuAction. */
  const contextMenuEntries = useMemo((): MenuEntry[] => {
    if (!contextMenu) return []
    if (contextMenu.kind === 'map-root') {
      return [
        { kind: 'item', id: 'properties', label: 'Properties…', icon: Settings2 },
        { kind: 'item', id: 'full-extent', label: 'Zoom to full extent', icon: Focus },
        { kind: 'item', id: 'view', icon: LayoutTemplate, label: viewMode === 'layout' ? 'Switch to map view' : 'Switch to layout view' },
      ]
    }
    if (contextMenu.kind === 'layer') {
      const index = layers.findIndex((item) => item.id === contextMenu.layerId)
      const layer = layers[index]
      if (!layer) return []
      return buildLayerMenu({
        layer, index, count: layers.length,
        tableShowsLayer: tableOpen && selectedLayerId === layer.id && !workspaceLayout.tableMinimized,
      })
    }
    return buildMapCanvasMenu({ lngLat: contextMenu.lngLat, canIdentify: contextMenu.canIdentify, markerCount: quickMarkerCount })
  }, [contextMenu, layers, tableOpen, selectedLayerId, workspaceLayout.tableMinimized, viewMode, quickMarkerCount])

  const handleContextMenuAction = useCallback((menu: ContextMenuState, id: string) => {
    if (menu.kind === 'map-root') {
      if (id === 'properties') openMapProperties()
      else if (id === 'full-extent') zoomToAll()
      else if (id === 'view') {
        const state = useArcWebStore.getState()
        state.setViewMode(state.viewMode === 'layout' ? 'map' : 'layout')
      }
      return
    }
    if (menu.kind === 'layer') {
      const layer = useArcWebStore.getState().layers.find((item) => item.id === menu.layerId)
      if (!layer) return
      runLayerMenuAction(id, {
        zoomTo: () => zoomToLayer(layer),
        toggleTable: () => toggleLayerTable(layer.id),
        openSymbology: () => openLayerSymbology(layer),
        move: (direction) => useArcWebStore.getState().moveLayer(layer.id, direction),
        exportAs: (format) => exportSelectedLayer(layer, format),
        requestRemove: () => setPendingRemoval(layer.id),
      })
      return
    }
    const { lngLat, point, x, y } = menu
    runMapCanvasMenuAction(id, {
      identify: () => identifyAtPoint(point, { x, y }, lngLat),
      center: () => centerMapAt(lngLat),
      addMarker: () => addQuickMarker(lngLat),
      copyCoordinates: () => {
        const text = `${lngLat[1].toFixed(6)}, ${lngLat[0].toFixed(6)}`
        void navigator.clipboard.writeText(text)
          .then(() => notify(`Copied ${text} (lat, lon).`))
          .catch(() => notify('The browser blocked clipboard access.', 'error'))
      },
      clearMarkers: clearQuickMarkers,
    })
  }, [
    openMapProperties, zoomToAll, zoomToLayer, toggleLayerTable, openLayerSymbology, exportSelectedLayer,
    identifyAtPoint, centerMapAt, notify, addQuickMarker, clearQuickMarkers,
  ])

  /** Opens the layer menu; a keyboard-invoked menu (no pointer position) anchors to the row itself. */
  const openLayerMenu = useCallback((event: ReactMouseEvent<HTMLElement>, layerId: string) => {
    event.preventDefault()
    event.stopPropagation()
    useArcWebStore.getState().setSelectedLayer(layerId)
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({ kind: 'layer', layerId, x: fromKeyboard ? rect.left + 24 : event.clientX, y: fromKeyboard ? rect.bottom : event.clientY })
  }, [])

  const selectedCount = Object.values(selections).reduce((sum, ids) => sum + ids.length, 0)
  const hasSelection = selectedCount > 0 || selectedFeature !== null
  const tableSelectedIds = useMemo(
    () => new Set<FeatureId>(selectedLayerId ? selections[selectedLayerId] ?? [] : []),
    [selections, selectedLayerId],
  )
  // Resolve identified features against the live layers so edits and deletions are reflected.
  const identifyHits: IdentifyHit[] = identify ? identify.hits.flatMap((hit) => {
    const layer = layers.find((item) => item.id === hit.layerId)
    const feature = layer?.data.features.find((item) => item.id === hit.featureId)
    return layer && feature ? [{ layer, feature }] : []
  }) : []
  const identifyIndex = identify ? Math.min(identify.index, identifyHits.length - 1) : 0
  const identifiedHit = identifyHits[identifyIndex]

  const displayCrsDefinition = requireCrs(displayCrs)
  // With a geographic display system the secondary readout is the pointer's UTM zone.
  const wgsReadout = cursor ? coordinateReadout(WGS84, cursor[0], cursor[1]) : null
  const projectedReadout = cursor
    ? coordinateReadout(displayCrsDefinition.kind === 'geographic' ? utmCodeFor(cursor[0], cursor[1]) : displayCrs, cursor[0], cursor[1])
    : null
  const scale = cursor
    ? `1:${Math.round(scaleDenominator(cursor[1], zoom)).toLocaleString('en-US')}`
    : '—'
  const length = measurePoints.slice(1).reduce((sum, point, index) => sum + distanceBetween(measurePoints[index], point), 0)
  const area = polygonArea(measurePoints)

  return (
    <main className={`arc-app preset-${workspaceLayout.preset} ${workspaceLayout.fullCanvas ? 'full-canvas' : ''}`}>
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-mark"><MapIcon size={18} strokeWidth={2.3} /></div>
          <span className="brand-name">Arc<span>Web</span></span>
          <div className="header-divider" />
          <label className="project-title" title="Project name — used for the saved file name"><span>Project</span>
            <input className="project-name" aria-label="Project name" value={projectName} spellCheck={false} maxLength={80}
              onChange={(event) => useArcWebStore.getState().setProjectName(event.target.value)}
              onBlur={(event) => { if (!event.target.value.trim()) useArcWebStore.getState().setProjectName('Untitled map') }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          </label>
          <div className="save-state"><span className="save-dot" />Saved locally</div>
        </div>
        <div className="header-actions">
          <button className="header-button" title="Open an .arcweb.json project file" onClick={() => projectInputRef.current?.click()}><FolderOpen size={14} />Open Project</button>
          <button className="header-button primary" title="Save the whole workspace (layers, symbology, coordinate system, layout, bookmarks) as an .arcweb.json file" onClick={saveProject}><Save size={14} />Save Project</button>
          <input ref={projectInputRef} className="visually-hidden" type="file" tabIndex={-1} aria-label="Choose an ArcWeb project file" accept=".json,.arcweb.json,application/json" onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void loadProjectFile(file)
            event.currentTarget.value = ''
          }} />
          <label className="workspace-layout-control"><span>Workspace</span>
            <select aria-label="Workspace layout preset" value={workspaceLayout.preset} onChange={(event) => {
              const value = event.target.value
              if (value === 'standard' || value === 'analysis' || value === 'cartography') selectWorkspacePreset(value)
            }}>
              <option value="standard">Standard Layout</option>
              <option value="analysis">Analysis Focus</option>
              <option value="cartography">Cartography Focus</option>
            </select>
          </label>
          <button className="header-button" title="Hide panels and ribbons for a full-canvas map view" onClick={toggleFullCanvas}><Focus size={14} />Full canvas</button>
          <span className="header-separator" />
          <button className="header-icon" title="Toggle theme" onClick={() => useArcWebStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <span className="header-separator" />
          <button className="clear-session" onClick={() => void clearSession()}><Trash2 size={14} />Clear session</button>
          <div className="avatar">AW</div>
        </div>
      </header>

      <nav className="ribbon-tabs" aria-label="Ribbon tabs">
        {CORE_TABS.map((tab) => (
          <button key={tab} className={`ribbon-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => {
            useArcWebStore.getState().setActiveTab(tab)
            if (tab === 'Analysis') {
              const state = useArcWebStore.getState()
              state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: true })
            }
            if (tab === 'Layout') { setSceneView(false); useArcWebStore.getState().setViewMode('layout') }
          }}>{tab}</button>
        ))}
        {CONTEXTUAL_TABS.filter((tab) => visibleContextualTabs.includes(tab)).map((tab) => (
          <button
            key={tab}
            className={`ribbon-tab contextual-tab contextual-${tab === 'EditSession' ? 'edit' : 'layer'} ${activeTab === tab ? 'active' : ''}`}
            title={`${CONTEXTUAL_TAB_META[tab].group}: ${CONTEXTUAL_TAB_META[tab].label}${tab !== 'EditSession' && selectedLayer ? ` — ${selectedLayer.name}` : ''}`}
            onClick={() => useArcWebStore.getState().setActiveTab(tab)}
          >
            <span className="contextual-tab-group">{CONTEXTUAL_TAB_META[tab].group}</span>
            <span className="contextual-tab-label">{CONTEXTUAL_TAB_META[tab].label}</span>
          </button>
        ))}
        <div className="ribbon-context">{viewMode === 'layout' ? 'LAYOUT VIEW' : sceneView ? '3D SCENE' : '2D MAP'}</div>
      </nav>

      <section className={`ribbon-toolbar ${isContextualTab(activeTab) ? `contextual-toolbar contextual-${activeTab === 'EditSession' ? 'edit' : 'layer'}` : ''}`}>
        {addRibbonTooltips(<>{activeTab === 'FeatureLayer' && selectedLayer ? (
          <FeatureLayerRibbon
            layer={selectedLayer}
            symbologyOpen={workspaceLayout.rightPaneOpen}
            tableOpen={tableOpen}
            onUpdate={(updates) => useArcWebStore.getState().updateLayer(selectedLayer.id, updates)}
            onOpenSymbology={openSymbologyPane}
            onZoomToLayer={() => zoomToLayer(selectedLayer)}
            onToggleTable={() => useArcWebStore.getState().setTableOpen(!tableOpen)}
          />
        ) : activeTab === 'RasterLayer' && selectedLayer ? (
          <RasterLayerRibbon
            layer={selectedLayer}
            onUpdate={(updates) => useArcWebStore.getState().updateLayer(selectedLayer.id, updates)}
            onZoomToLayer={() => zoomToLayer(selectedLayer)}
            onError={(message) => notify(message, 'error')}
          />
        ) : activeTab === 'EditSession' ? (
          <EditSessionRibbon
            layer={selectedLayer}
            tool={tool}
            selectedFeatureIsEditable={selectedFeatureIsEditable}
            selectedCount={editTargetIds.length}
            pendingLayerNames={pendingEditLayerNames}
            onSetTool={setEditingTool}
            onFinishSketch={finishSketch}
            onDeleteSelected={deleteSelectedFeatures}
            onSave={saveEdits}
            onDiscard={discardEdits}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undoEdit}
            onRedo={redoEdit}
          />
        ) : isContextualTab(activeTab) ? null : activeTab === 'Map' ? (
          <>
            <div className="tool-group basemap-group">
              <div className="basemap-options">
                {basemaps.map((item) => (
                  <button key={item.id} className={`basemap-button ${basemap === item.id ? 'chosen' : ''}`} onClick={() => useArcWebStore.getState().setBasemap(item.id)} title={`${item.name} basemap`}>
                    <span className={`basemap-preview ${item.preview}`} />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
              <div className="group-caption">Basemap gallery</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions map-ribbon">
              <button className={`ribbon-action ${tool === 'pan' ? 'tool-selected' : ''}`} title="Explore: pan the map and click a feature to open its pop-up (Ctrl+click adds it to the selection)" onClick={() => setEditingTool('pan')}><MousePointer2 size={17} /><span>Explore</span></button>
              <button className="ribbon-action" title="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: 250 })}><Plus size={17} /><span>Zoom in</span></button>
              <button className="ribbon-action" title="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: 250 })}><Minus size={17} /><span>Zoom out</span></button>
              <button className="ribbon-action" title="Full extent" onClick={zoomToAll}><Focus size={17} /><span>Full extent</span></button>
              <button className={`ribbon-action ${bookmarkAnchor ? 'tool-selected' : ''}`} title="Spatial bookmarks" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                setBookmarkAnchor(bookmarkAnchor ? null : { left: bounds.left, top: bounds.bottom + 8 })
              }}><BookmarkIcon size={17} /><span>Bookmarks</span></button>
              <div className="group-caption">Navigate</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions map-ribbon">
              <button className="ribbon-action" title="Select By Attributes" disabled={!layers.length} onClick={() => setSelectionDialog('attributes')}><ListFilter size={17} /><span>By attributes</span></button>
              <button className="ribbon-action" title="Select By Location" disabled={!layers.length} onClick={() => setSelectionDialog('location')}><SquareDashedMousePointer size={17} /><span>By location</span></button>
              <button className="ribbon-action" title="Zoom to selected features" disabled={!hasSelection} onClick={zoomToSelected}><ScanSearch size={17} /><span>Zoom to</span></button>
              <button className="ribbon-action" title="Clear selection" disabled={!hasSelection} onClick={clearSelection}><Eraser size={17} /><span>Clear</span></button>
              <div className="group-caption">Selection{selectedCount ? ` · ${selectedCount.toLocaleString('en-US')} selected` : ''}</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions map-ribbon">
              <button className={`ribbon-action ${tool === 'distance' ? 'tool-selected' : ''}`} title="Measure distance" onClick={() => toggleTool('distance')}><Ruler size={17} /><span>Distance</span></button>
              <button className={`ribbon-action ${tool === 'area' ? 'tool-selected' : ''}`} title="Measure area" onClick={() => toggleTool('area')}><AreaChart size={17} /><span>Area</span></button>
              <div className="group-caption">Measure</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions map-ribbon">
              <button className={`ribbon-action ${tableOpen ? 'tool-selected' : ''}`} title="Open attribute table" disabled={!selectedLayer} onClick={() => useArcWebStore.getState().setTableOpen(!tableOpen)}><Table2 size={17} /><span>Table</span></button>
              <button className="ribbon-action" title="Map properties and coordinate systems" onClick={openMapProperties}><Globe2 size={17} /><span>Properties</span></button>
              <button className={`ribbon-action ${!sceneView && viewMode === 'map' ? 'tool-selected' : ''}`} title="Switch to 2D Map" onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode('map') }}><MapIcon size={17} /><span>2D Map</span></button>
              <button className={`ribbon-action ${sceneView && viewMode === 'map' ? 'tool-selected' : ''}`} title="Switch to 3D Scene; right-drag to rotate and tilt" onClick={() => { setSceneView(true); useArcWebStore.getState().setViewMode('map') }}><Box size={17} /><span>3D Scene</span></button>
              <button className={`ribbon-action ${viewMode === 'layout' ? 'tool-selected' : ''}`} title="Switch to print layout view" onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode(viewMode === 'layout' ? 'map' : 'layout') }}><LayoutTemplate size={17} /><span>Layout</span></button>
              <div className="group-caption">Map</div>
            </div>
          </>
        ) : activeTab === 'Insert' ? (
          <>
            <div className="tool-group add-data-group">
              <button className="add-data-button" onClick={() => fileInputRef.current?.click()}><FilePlus2 size={19} /><span>Add data</span></button>
              <div className="group-caption">Import local data</div>
            </div>
            <div className="ribbon-separator" />
            <div className="supported-files"><CloudUpload size={19} /><div><strong>Drop a file onto the map</strong><span>GeoJSON · Shapefile ZIP · KML · CSV · GeoTIFF</span></div></div>
          </>
        ) : activeTab === 'Analysis' ? (
          <div className="ribbon-contextual-copy"><Sparkles size={17} /><div><strong>Spatial analysis</strong><span>Choose an operation and input layers in the Geoprocessing pane.</span></div></div>
        ) : activeTab === 'Layout' ? (
          <>
            <div className="phase-ribbon-actions layout-ribbon">
              <button className={`ribbon-action ${viewMode === 'map' ? 'tool-selected' : ''}`} onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode('map') }}><MapIcon size={17} /><span>Map view</span></button>
              <button className={`ribbon-action ${viewMode === 'layout' ? 'tool-selected' : ''}`} onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode('layout') }}><LayoutTemplate size={17} /><span>Layout view</span></button>
              <div className="group-caption">View</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions layout-ribbon">
              {insertableElements.map(({ type, icon: Icon }) => (
                <button key={type} className="ribbon-action" title={`Insert ${elementLabels[type].toLowerCase()}`} onClick={() => insertLayoutElement(type)}><Icon size={17} /><span>{elementLabels[type]}</span></button>
              ))}
              <div className="group-caption">Insert map elements</div>
            </div>
            <div className="ribbon-separator" />
            <div className="phase-ribbon-actions layout-ribbon">
              <button className="ribbon-action" disabled={layoutExporting} onClick={() => void exportLayout('png')}><FileImage size={17} /><span>PNG</span></button>
              <button className="ribbon-action" disabled={layoutExporting} onClick={() => void exportLayout('pdf')}><FileText size={17} /><span>PDF</span></button>
              <div className="group-caption">Export layout</div>
            </div>
          </>
        ) : activeTab === 'View' ? (
          <ViewRibbon
            contentsOpen={!workspaceLayout.contentsMinimized}
            sidePaneOpen={workspaceLayout.rightPaneOpen}
            tableOpen={tableOpen}
            tableAvailable={Boolean(selectedLayer)}
            preset={workspaceLayout.preset}
            mode={viewMode === 'layout' ? 'layout' : sceneView ? '3d' : '2d'}
            fullCanvas={workspaceLayout.fullCanvas}
            theme={theme}
            onTogglePane={(pane) => {
              const state = useArcWebStore.getState()
              if (pane === 'table') state.setTableOpen(!tableOpen)
              else if (pane === 'side') state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: !state.workspaceLayout.rightPaneOpen })
              else state.setWorkspaceLayout({ ...state.workspaceLayout, contentsMinimized: !state.workspaceLayout.contentsMinimized })
            }}
            onPreset={selectWorkspacePreset}
            onMode={(mode) => {
              setSceneView(mode === '3d')
              useArcWebStore.getState().setViewMode(mode === 'layout' ? 'layout' : 'map')
            }}
            onToggleFullCanvas={toggleFullCanvas}
            onToggleTheme={() => useArcWebStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
        ) : activeTab === 'Edit' ? (
          <div className="phase-ribbon-actions">
            {([
              ['draw-point', 'Point'],
              ['draw-line', 'Line'],
              ['draw-polygon', 'Polygon'],
              ['move-vertex', 'Move vertex'],
            ] as const).map(([mode, label]) => (
              <button key={mode} className={`ribbon-action ${tool === mode ? 'tool-selected' : ''}`} disabled={mode === 'move-vertex' ? !selectedFeatureIsEditable : !selectedLayer} onClick={() => setEditingTool(tool === mode ? 'pan' : mode)}><MousePointer2 size={17} /><span>{label}</span></button>
            ))}
            <div className="group-caption">Feature tools · snapping enabled</div>
          </div>
        ) : (
          <div className="phase-ribbon-actions">
            <button className="ribbon-action" disabled={!selectedLayer} onClick={() => selectedLayer && exportSelectedLayer(selectedLayer, 'geojson')}><FilePlus2 size={17} /><span>GeoJSON</span></button>
            <button className="ribbon-action" disabled={!selectedLayer} onClick={() => selectedLayer && exportSelectedLayer(selectedLayer, 'csv')}><Table2 size={17} /><span>CSV</span></button>
            <button className="ribbon-action" onClick={() => void exportCurrentMap()}><Upload size={17} /><span>Map PNG</span></button>
            <button className="ribbon-action" disabled={layoutExporting} title="Export the print layout sheet as a high-resolution PNG" onClick={() => void exportLayout('png')}><FileImage size={17} /><span>Layout PNG</span></button>
            <button className="ribbon-action" disabled={layoutExporting} title="Export the print layout sheet as a PDF" onClick={() => void exportLayout('pdf')}><FileText size={17} /><span>Layout PDF</span></button>
            <div className="group-caption">Export locally</div>
          </div>
        )}
        <div className="toolbar-spacer" />
        <button className="coordinate-reference" title="Display coordinate system — open Map Properties" onClick={openMapProperties}><Compass size={14} /><span>{displayCrsDefinition.name}</span><span className="crs-code">{displayCrsDefinition.code}</span></button>
        <input ref={fileInputRef} className="visually-hidden" type="file" multiple tabIndex={-1} aria-label="Choose data files to add" accept=".geojson,.json,.zip,.kml,.csv,.tif,.tiff" onChange={(event) => {
          if (event.currentTarget.files) void addFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        }} />
        </>)}
      </section>

      <div className={`workspace ${workspaceLayout.preset === 'analysis' ? 'analysis-focus' : ''}`}>
        <DockablePanel
          floating={workspaceLayout.panels.contents.floating}
          frame={workspaceLayout.panels.contents.frame}
          className="contents-window"
          onFrameChange={updateContentsFrame}
        >
        <aside className={`dock contents-dock ${workspaceLayout.contentsMinimized ? 'contents-minimized' : ''}`}>
          <div className="dock-heading">
            <div><Layers3 size={16} /><strong>Contents</strong><span className="layer-count">{layers.length}</span></div>
            <div className="dock-heading-actions">
              <button className="panel-float-toggle" title={workspaceLayout.panels.contents.floating ? 'Dock Contents panel' : 'Float Contents panel'} aria-label={workspaceLayout.panels.contents.floating ? 'Dock Contents panel' : 'Float Contents panel'} onClick={() => togglePanelFloating('contents')}><Move size={13} /><span>{workspaceLayout.panels.contents.floating ? 'Dock' : 'Float'}</span></button>
              <button className="subtle-icon contents-collapse-toggle" title={workspaceLayout.contentsMinimized ? 'Expand Contents panel' : 'Minimize Contents panel'} aria-label={workspaceLayout.contentsMinimized ? 'Expand Contents panel' : 'Minimize Contents panel'} onClick={() => {
                const state = useArcWebStore.getState()
                state.setWorkspaceLayout({ ...state.workspaceLayout, contentsMinimized: !state.workspaceLayout.contentsMinimized })
              }}><ChevronDown size={14} /></button>
              <button className="subtle-icon" title="Add data" aria-label="Add data" onClick={() => fileInputRef.current?.click()}><Plus size={16} /></button>
            </div>
          </div>
          <div className="pane-subtitle">Drawing order <span>Top layers draw first</span></div>
          {layers.length > 0 && <label className="layer-search"><Search size={14} /><input placeholder="Find a layer" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} /><span>⌘F</span></label>}
          <div className="layer-list">
            <div className={`map-root-row ${selectedLayerId ? '' : 'selected'}`} title="Click to select the map (clears the layer selection); right-click for map options" onClick={() => useArcWebStore.getState().setSelectedLayer(null)} onDoubleClick={openMapProperties} onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu({ kind: 'map-root', x: event.clientX, y: event.clientY })
            }}>
              <Globe2 size={14} /><strong>Map</strong><span>{displayCrsDefinition.code}</span>
              <button title="Map properties" onClick={openMapProperties}><Settings2 size={12} /></button>
            </div>
            {filteredLayers.map((layer) => {
              const layerIndex = layers.findIndex((item) => item.id === layer.id)
              const selected = selectedLayerId === layer.id
              return (
                <div key={layer.id} data-layer-id={layer.id} className={`layer-row ${selected ? 'selected' : ''} ${contextMenu?.kind === 'layer' && contextMenu.layerId === layer.id ? 'menu-open' : ''}`} onClick={() => useArcWebStore.getState().setSelectedLayer(layer.id)} onContextMenu={(event) => openLayerMenu(event, layer.id)}>
                  <div className="layer-main">
                    <button className={`visibility-button ${layer.visible ? '' : 'hidden-layer'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={(event) => {
                      event.stopPropagation()
                      useArcWebStore.getState().updateLayer(layer.id, { visible: !layer.visible })
                    }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                    <span className={`geometry-icon geometry-${layer.geometry.toLowerCase()}`} title={layer.geometry === 'Unknown' ? 'Standalone table' : `${layer.geometry} geometry`}><LayerIcon geometry={layer.geometry} /></span>
                    <button className="layer-name-button" dir="auto" title={layer.name} onClick={(event) => {
                      event.stopPropagation()
                      useArcWebStore.getState().setSelectedLayer(layer.id)
                    }}>{layer.name}</button>
                    <div className="layer-actions">
                      <button title="Move layer up" disabled={layerIndex === 0} onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().moveLayer(layer.id, -1) }}><ArrowUp size={12} /></button>
                      <button title="Move layer down" disabled={layerIndex === layers.length - 1} onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().moveLayer(layer.id, 1) }}><ArrowDown size={12} /></button>
                      <button title="Zoom to layer" disabled={layer.geometry === 'Unknown'} onClick={(event) => { event.stopPropagation(); zoomToLayer(layer) }}><LocateFixed size={12} /></button>
                      <button title="Open attribute table" onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().setSelectedLayer(layer.id); useArcWebStore.getState().setTableOpen(true) }}><Table2 size={12} /></button>
                      <button title="Remove layer" onClick={(event) => { event.stopPropagation(); setPendingRemoval(layer.id) }}><X size={13} /></button>
                    </div>
                  </div>
                  {selected && (
                    <div className="layer-opacity" onClick={(event) => event.stopPropagation()}>
                      <span>Opacity</span><input aria-label={`${layer.name} opacity`} type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={(event) => useArcWebStore.getState().updateLayer(layer.id, { opacity: Number(event.target.value) })} /><span>{Math.round(layer.opacity * 100)}%</span>
                    </div>
                  )}
                  {selected && <ContentsRendererLegend layer={layer} />}
                </div>
              )
            })}
            {layers.length === 0 && (
              <button className="empty-layers" onClick={() => fileInputRef.current?.click()}>
                <div className="empty-glyph"><Database size={20} /></div>
                <strong>Your map is ready</strong>
                <span>Add a dataset to start exploring spatial data.</span>
                <em><Plus size={13} /> Add data</em>
              </button>
            )}
            {layers.length > 0 && filteredLayers.length === 0 && <div className="no-results">No matching layers found.</div>}
          </div>
          <div className="contents-footer"><span><span className="status-dot" />{layers.length ? `${layers.length} layer${layers.length === 1 ? '' : 's'} in map` : 'No layers yet'}</span><button title="Map properties" onClick={openMapProperties}><Settings2 size={14} /></button></div>
        </aside>
        </DockablePanel>

        <section className="map-workspace" ref={workspaceRef} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false)
        }} onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
        }}>
          <div className="map-host" ref={mapHostRef} />
          {workspaceLayout.fullCanvas && <button className="full-canvas-exit" onClick={toggleFullCanvas}><X size={14} />Restore workspace</button>}
          {importingFile && (
            <div className="import-progress" role="status" aria-live="polite">
              <span className="import-spinner" aria-hidden="true" />
              <span className="import-progress-copy"><strong>Loading {importingFile.name}</strong><small>Reading local data · file {importingFile.index} of {importingFile.total}</small></span>
              <button type="button" className="import-cancel" onClick={cancelImport}>Cancel</button>
              <span className="import-progress-track"><span /></span>
            </div>
          )}
          {toolExecutionProgress && (
            <div className="tool-execution-progress" role="status" aria-live="polite">
              <span className="import-spinner" aria-hidden="true" />
              <span className="import-progress-copy"><strong>{toolExecutionProgress.name}</strong><small>{toolExecutionProgress.message} · {toolExecutionProgress.current} of {toolExecutionProgress.total}</small></span>
              <span className="tool-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, toolExecutionProgress.current / Math.max(1, toolExecutionProgress.total) * 100))}%` }} /></span>
            </div>
          )}
          {viewMode === 'layout' && (
            <LayoutView map={mapInstance} layers={layers} basemap={basemap} pageRef={layoutPageRef} onMapFrameHost={setMapFrameHost} />
          )}
          <div className="map-top-left">
            <div className="view-switch" role="tablist" aria-label="View">
              <button role="tab" aria-selected={viewMode === 'map' && !sceneView} className={viewMode === 'map' && !sceneView ? 'active' : ''} onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode('map') }}><MapIcon size={13} /> 2D Map</button>
              <button role="tab" aria-selected={viewMode === 'map' && sceneView} className={viewMode === 'map' && sceneView ? 'active' : ''} onClick={() => { setSceneView(true); useArcWebStore.getState().setViewMode('map') }}><Box size={13} /> 3D Scene</button>
              <button role="tab" aria-selected={viewMode === 'layout'} className={viewMode === 'layout' ? 'active' : ''} onClick={() => { setSceneView(false); useArcWebStore.getState().setViewMode('layout') }}><LayoutTemplate size={13} /> Layout</button>
            </div>
            {viewMode === 'map' && <span className="map-coordinate-badge"><span className="live-dot" />{sceneView ? '3D Scene · right-drag to rotate' : basemaps.find((item) => item.id === basemap)?.name}</span>}
          </div>
          {viewMode === 'map' && sceneView && mapInstance && (
            <SceneNavigator
              map={mapInstance}
              settings={sceneSettings}
              terrain={terrainState}
              layers={layers}
              selectedLayer={selectedLayer}
              onSettings={(settings) => useArcWebStore.getState().setSceneSettings(settings)}
              onUpdateLayer={(layerId, updates) => useArcWebStore.getState().updateLayer(layerId, updates)}
              onFlyToLayer={flyToLayer}
            />
          )}
          {(tool === 'distance' || tool === 'area') && (
            <div className="measurement-card">
              <div className="measurement-icon">{tool === 'distance' ? <Ruler size={15} /> : <AreaChart size={15} />}</div>
              <div><strong>{tool === 'distance' ? 'Measure distance' : 'Measure area'}</strong><span>{measurePoints.length < (tool === 'area' ? 3 : 2) ? 'Click map to add vertices' : tool === 'distance' ? formatDistance(length) : `${(area / 1_000_000).toFixed(3)} km²`}</span></div>
              <button title="Clear measurement" onClick={clearMeasurements}><Trash2 size={14} /></button>
              <button title="Finish measurement" onClick={() => useArcWebStore.getState().setTool('pan')}><Check size={15} /></button>
            </div>
          )}
          {identify && identifiedHit && (
            <IdentifyPopup
              key={identify.key}
              hits={identifyHits}
              index={identifyIndex}
              position={{ x: identify.x, y: identify.y }}
              location={coordinateReadout(displayCrs, identify.lngLat[0], identify.lngLat[1]).text}
              selected={(selections[identifiedHit.layer.id] ?? []).includes(identifiedHit.feature.id as FeatureId)}
              onIndexChange={(index) => {
                const hit = identifyHits[index]
                if (!hit || hit.feature.id === undefined) return
                setIdentify({ ...identify, hits: identifyHits.map((item) => ({ layerId: item.layer.id, featureId: item.feature.id as FeatureId })), index })
                useArcWebStore.getState().setSelectedLayer(hit.layer.id)
                useArcWebStore.getState().setSelectedFeature({ layerId: hit.layer.id, featureId: hit.feature.id })
              }}
              onZoom={(hit) => {
                const bounds = hit.feature.geometry ? geometryBounds(hit.feature.geometry) : null
                if (!bounds) return
                if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) mapRef.current?.flyTo({ center: [bounds[0], bounds[1]], zoom: 15, duration: 650 })
                else mapRef.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 70, maxZoom: 17, duration: 650 })
              }}
              onOpenTable={(hit) => {
                if (hit.feature.id === undefined) return
                useArcWebStore.getState().setSelectedLayer(hit.layer.id)
                useArcWebStore.getState().setSelectedFeature({ layerId: hit.layer.id, featureId: hit.feature.id })
                useArcWebStore.getState().setTableOpen(true)
              }}
              onToggleSelected={(hit) => { if (hit.feature.id !== undefined) useArcWebStore.getState().toggleSelected(hit.layer.id, hit.feature.id) }}
              onClose={() => setIdentify(null)}
            />
          )}
          {(tool === 'draw-line' || tool === 'draw-polygon') && (
            <div className="measurement-card sketch-card">
              <div className="measurement-icon"><MousePointer2 size={15} /></div>
              <div><strong>{tool === 'draw-line' ? 'Sketch line' : 'Sketch polygon'}</strong><span>{sketchPoints.length} vertices · double-click to finish</span></div>
              <button title="Cancel sketch" onClick={() => setEditingTool('pan')}><X size={14} /></button>
              <button title="Finish sketch" onClick={finishSketch}><Check size={15} /></button>
            </div>
          )}
          {isDragging && (
            <div className="drop-overlay">
              <div className="drop-card"><div className="drop-icon"><Upload size={23} /></div><strong>Drop your spatial data</strong><span>GeoJSON, Shapefile ZIP, KML, CSV or GeoTIFF</span><small>Files are processed locally in your browser</small></div>
            </div>
          )}
          {viewMode === 'map' && <div className="map-scale-readout">{scale}</div>}
          <div className="bottom-status">
            <div className="status-coordinate">{!wgsReadout || !projectedReadout ? <><MousePointer2 size={12} /><span>Move pointer over map</span></> : <>
              <span className="coordinate-label">WGS 84</span><span>{wgsReadout.text}</span>
              <span className="status-divider" />
              <span className="coordinate-label">{projectedReadout.label}</span>
              <span className={projectedReadout.inArea ? '' : 'out-of-area'} title={projectedReadout.inArea ? projectedReadout.code : `Outside the area of use of ${crsLabel(projectedReadout.code)}`}>{projectedReadout.text}{projectedReadout.inArea ? '' : ' (outside area of use)'}</span>
            </>}</div>
            <div className="status-right"><span>{viewMode === 'layout' ? `Layout · ${layoutPaper} ${layoutOrientation}` : scale}</span><span className="status-divider" /><button className="status-crs" title="Display coordinate system — open Map Properties" onClick={openMapProperties}>{displayCrsDefinition.code}</button></div>
          </div>
        </section>

        {!workspaceLayout.rightPaneOpen ? (
          workspaceLayout.preset === 'cartography' ? null : (
            <aside className="right-pane-rail"><button title={activeTab === 'Analysis' ? 'Open Geoprocessing pane' : 'Open side panel'} onClick={() => {
              const state = useArcWebStore.getState()
              state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: true })
            }}><PanelRightClose size={16} /><span>{activeTab === 'Analysis' ? 'Tools' : 'Panel'}</span></button></aside>
          )
        ) : activeTab === 'Analysis' ? (
          <DockablePanel
            floating={workspaceLayout.panels.geoprocessing.floating}
            frame={workspaceLayout.panels.geoprocessing.frame}
            className="geoprocessing-window"
            onFrameChange={updateGeoprocessingFrame}
          >
            <aside className="dock symbology-dock toolbox-dock">
              <ToolboxPanel
                layers={layers}
                selectedLayerId={selectedLayerId}
                floating={workspaceLayout.panels.geoprocessing.floating}
                onToggleFloat={() => togglePanelFloating('geoprocessing')}
                selectionCount={selectedFeatureCount(layers, selections)}
                running={toolExecutionProgress?.name ?? null}
                history={analysisHistory}
                onExecute={(definition, parameters, options) => void executeTool(definition, parameters, options)}
                onCancel={cancelTool}
                onClose={() => {
                  const state = useArcWebStore.getState()
                  state.setWorkspaceLayout({ ...state.workspaceLayout, rightPaneOpen: false })
                }}
              />
            </aside>
          </DockablePanel>
        ) : activeTab === 'Edit' || activeTab === 'EditSession' ? (
          <aside className="dock symbology-dock"><EditPanel
            layers={layers}
            selectedLayer={selectedLayer}
            selectedFeatureIsEditable={selectedFeatureIsEditable}
            tool={tool}
            onCreateLayer={createEditableLayer}
            onSetTool={setEditingTool}
            onDeleteFeature={deleteSelectedFeature}
            onOpenTable={() => useArcWebStore.getState().setTableOpen(true)}
            onFinishSketch={finishSketch}
          /></aside>
        ) : activeTab === 'Layout' ? (
          <aside className="dock symbology-dock"><LayoutPanel
            viewMode={viewMode}
            exporting={layoutExporting}
            onSetViewMode={(mode) => useArcWebStore.getState().setViewMode(mode)}
            onInsert={insertLayoutElement}
            onExport={(format, dpi) => void exportLayout(format, dpi)}
          /></aside>
        ) : activeTab === 'Share' ? (
          <aside className="dock symbology-dock"><SharePanel key={selectedLayerId ?? 'no-layer'}
            layers={layers}
            selectedLayerId={selectedLayerId}
            layoutExporting={layoutExporting}
            onExportLayer={exportSelectedLayer}
            onExportImage={() => void exportCurrentMap()}
            onExportLayout={(format, dpi) => void exportLayout(format, dpi)}
          /></aside>
        ) : (
        <DockablePanel
          floating={workspaceLayout.panels.symbology.floating}
          frame={workspaceLayout.panels.symbology.frame}
          className="symbology-window"
          onFrameChange={updateSymbologyFrame}
        >
        <SymbologyPanel
          selectedLayer={selectedLayer}
          floating={workspaceLayout.panels.symbology.floating}
          onToggleFloat={() => togglePanelFloating('symbology')}
          onUpdate={(updates) => {
            if (selectedLayer) useArcWebStore.getState().updateLayer(selectedLayer.id, updates)
          }}
          onAddData={() => useArcWebStore.getState().setActiveTab('Insert')}
        />
        </DockablePanel>
        )}
      </div>

      {tableOpen && selectedLayer && !workspaceLayout.tableMinimized && (
        <DockablePanel
          floating={workspaceLayout.panels.attributeTable.floating}
          frame={workspaceLayout.panels.attributeTable.frame}
          className="attribute-table-window"
          onFrameChange={updateAttributeTableFrame}
        >
        <AttributeTable
          layer={selectedLayer}
          selectedFeatureId={selectedFeature?.layerId === selectedLayer.id ? selectedFeature.featureId : null}
          selectedIds={tableSelectedIds}
          height={tableHeight}
          floating={workspaceLayout.panels.attributeTable.floating}
          onToggleFloat={() => togglePanelFloating('attributeTable')}
          onToggleSelection={(feature) => { if (feature.id !== undefined) useArcWebStore.getState().toggleSelected(selectedLayer.id, feature.id) }}
          onSelectByAttributes={() => setSelectionDialog('attributes')}
          onZoomToSelected={zoomToSelected}
          onClearSelection={clearSelection}
          onResizePointerDown={handleTableResize}
          onClose={() => useArcWebStore.getState().setTableOpen(false)}
          onSelectFeature={(feature) => selectAndZoomFeature(selectedLayer, feature)}
          onDeleteFeature={(featureId) => deleteFeature(selectedLayer, featureId)}
          onAddField={(name) => addCustomField(selectedLayer, name)}
          onRemoveField={(name) => removeCustomField(selectedLayer, name)}
          onCalculate={(name, expression) => calculateLayerField(selectedLayer, name, expression)}
          view={tableViews[selectedLayer.id] ?? EMPTY_TABLE_VIEW}
          onViewChange={(view) => useArcWebStore.getState().setTableView(selectedLayer.id, view)}
          editable={!isRasterLayer(selectedLayer)}
          onEditCell={(featureId, field, value) => editCell(selectedLayer.id, featureId, field, value)}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={undoEdit}
          onRedo={redoEdit}
        />
        </DockablePanel>
      )}

      <footer className="app-footer">
        <div><span className="footer-app-dot" />ArcWeb <span className="footer-divider">/</span><span>{layers.length ? 'Ready' : 'No active layers'}</span></div>
        <div className="footer-center"><span>CLIENT-SIDE GIS</span><span className="footer-divider">·</span><span>SESSION STORED LOCALLY</span></div>
        <div><span>{layers.reduce((sum, layer) => sum + layer.data.features.length, 0).toLocaleString()} features</span><span className="footer-divider">·</span><span>MapLibre GL</span></div>
      </footer>

      {contextMenu && contextMenuEntries.length > 0 && (
        <ContextMenu
          // Re-mount per opening so focus and measurement start fresh.
          key={`${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}`}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          entries={contextMenuEntries}
          onSelect={(id) => handleContextMenuAction(contextMenu, id)}
          label={contextMenu.kind === 'layer' ? 'Layer options' : contextMenu.kind === 'canvas' ? 'Map canvas options' : 'Map options'}
          onClose={closeContextMenu}
        />
      )}

      {pendingRemovalLayer && (
        <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) cancelRemoveLayer() }}>
          <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label="Remove layer" onKeyDown={(event) => { if (event.key === 'Escape') cancelRemoveLayer(); else trapTabKey(event) }}>
            <header className="modal-header"><div><Trash2 size={15} /><strong>Remove “<bdi>{pendingRemovalLayer.name}</bdi>”?</strong></div></header>
            <div className="confirm-body">
              <p>The layer and its {pendingRemovalLayer.data.features.length.toLocaleString()} feature{pendingRemovalLayer.data.features.length === 1 ? '' : 's'} will be removed from this project.</p>
              <p className="modal-note">This cannot be undone. Export the layer first if you want to keep a copy.{editSnapshots[pendingRemovalLayer.id] ? ' Its unsaved edits will be lost.' : ''}</p>
            </div>
            <footer className="modal-footer">
              <span />
              <div className="dialog-buttons">
                <button className="phase-secondary-button" autoFocus onClick={cancelRemoveLayer}>Cancel</button>
                <button className="phase-primary-button danger-confirm" onClick={confirmRemoveLayer}>Remove layer</button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {bookmarkAnchor && (
        <BookmarksPopover
          bookmarks={bookmarks}
          anchor={bookmarkAnchor}
          onAdd={addBookmark}
          onGo={goToBookmark}
          onRemove={(id) => useArcWebStore.getState().removeBookmark(id)}
          onClose={closeBookmarks}
        />
      )}

      {selectionDialog === 'attributes' && (
        <SelectByAttributesDialog layers={layers} initialLayerId={selectedLayerId} selections={selections} onApply={applySelection} onClose={() => setSelectionDialog(null)} />
      )}
      {selectionDialog === 'location' && (
        <SelectByLocationDialog layers={layers} initialLayerId={selectedLayerId} selections={selections} onApply={applySelection} onClose={() => setSelectionDialog(null)} />
      )}

      {pendingProject && (
        <div className="modal-backdrop">
          <section className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label="Open project" onKeyDown={(event) => { if (event.key === 'Escape') setPendingProject(null); else trapTabKey(event) }}>
            <header className="modal-header"><div><FolderOpen size={15} /><strong>Open “<bdi>{pendingProject.name}</bdi>”?</strong></div></header>
            <div className="confirm-body">
              <p>Opening this project replaces the current workspace: {layers.length} layer{layers.length === 1 ? '' : 's'}, the layout, panel positions and bookmarks will be discarded.</p>
              <p className="modal-note">Use Save Project first if you want to keep the current work. The project contains {pendingProject.layers.length} layer{pendingProject.layers.length === 1 ? '' : 's'}{pendingProject.savedAt ? ` and was saved on ${new Date(pendingProject.savedAt).toLocaleString()}` : ''}.</p>
            </div>
            <footer className="modal-footer">
              <span />
              <div className="dialog-buttons">
                <button className="phase-secondary-button" autoFocus onClick={() => setPendingProject(null)}>Cancel</button>
                <button className="phase-primary-button" onClick={() => applyProject(pendingProject)}>Replace workspace</button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {mapPropertiesOpen && (
        <MapProperties
          name={projectName}
          layers={layers}
          displayCrs={displayCrs}
          view={mapViewInfo}
          onChangeDisplayCrs={(code) => useArcWebStore.getState().setDisplayCrs(code)}
          onClose={() => useArcWebStore.getState().setMapPropertiesOpen(false)}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-indicator">{toast.kind === 'error' ? <X size={13} /> : <Check size={13} />}</span><span>{toast.message}</span><button title="Dismiss" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </main>
  )
}

export default App
