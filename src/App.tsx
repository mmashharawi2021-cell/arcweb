import { LayerPropertiesDialog } from './contents/LayerPropertiesDialog'
import { toolboxTools } from './toolboxes/registry'
import { CommandSearch } from './shell/CommandSearch'
import type { Command } from './shell/commands'
import { NotificationsMenu } from './shell/NotificationsMenu'
import { HelpRibbon } from './ribbon/HelpRibbon'
import { KeyboardShortcutsDialog } from './shell/KeyboardShortcutsDialog'
import { MeasureWindow } from './measure/MeasureWindow'
import { SketchToolbar } from './editing/SketchToolbar'
import { ViewTabs } from './views/ViewTabs'
import { TableDock } from './views/TableDock'
import { DockArea } from './panes/DockArea'
import { PANE_TITLES } from './panes/paneTitles'
import { PANE_IDS, openPane, loadPaneLayout, migrateWorkspaceLayout, applyPanePreset, closePane, type PaneId, type PaneLayout } from './panes/paneLayout'
import { CatalogPane } from './panes/CatalogPane'
import { CreateFeaturesPane } from './panes/CreateFeaturesPane'
import { ModifyFeaturesPane } from './panes/ModifyFeaturesPane'
import { AttributesPane } from './panes/AttributesPane'
import { readLayoutPicture } from './layout/picture'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import maplibreWorkerUrl from './workers/maplibre.worker.ts?worker&url'
import { coordinateReadout, requireCrs, zoomForScale, scaleDenominator } from './crs'
import {
  Check, Compass, Focus, FolderOpen, Settings2, Trash2, X, LayoutTemplate,
} from 'lucide-react'
import type { Feature } from 'geojson'
import AttributeTable from './AttributeTable'
import DockablePanel from './DockablePanel'
import { SymbologyPanel } from './SymbologyPanel'
import { getCollectionBounds } from './geo'
import { runInWorker, type WorkerLike } from './workers/runInWorker'
import Backstage, { type BackstageSection } from './project/Backstage'
import TitleBar from './shell/TitleBar'
import { useAppShortcuts } from './shell/useAppShortcuts'
import { saveProjectNow } from './shell/saveProjectNow'
import type { UiSettings } from './ui/uiSettings'
import { registerOfflineProtocol } from './storage/offlineBasemap'
import { useFadeExit } from './ui/useFadeExit'
import { useContentFade } from './ui/useContentFade'
import { selectToolInputLayers } from './workers/toolInputs'
import type { ToolRequest } from './workers/toolProtocol'
import { exportLayer, exportMapCanvas } from './exportData'
import MapProperties, { type MapViewInfo } from './MapProperties'
import { exportLayoutSheet, type LayoutExportFormat } from './layout/exportLayout'
import LayoutPanel from './layout/LayoutPanel'
import LayoutView from './layout/LayoutView'
import { pageSize, useLayoutStore, type LayoutElementType } from './layout/layoutStore'
import { geometryBounds } from './mapRendering'
import {
  useArcWebStore, type AnalysisRecord, type Bookmark, type ContextualTab, type FeatureId, type MapLayer, type SelectionMethod, type TableView,
} from './store'
import SceneNavigator from './scene/SceneNavigator'
import {
  CONTEXTUAL_TAB_META, CONTEXTUAL_GROUPS, CORE_TABS, getVisibleContextualTabs, isContextualTab, isRasterLayer, reconcileRibbonTabs,
} from './ribbon/contextualTabs'
import ContextMenu from './contextMenu/ContextMenu'
import {
  buildLayerMenu, buildMapCanvasMenu, formatLngLat, runLayerMenuAction, runMapCanvasMenuAction, type MenuEntry,
} from './contextMenu/menuModel'
import { ViewRibbon } from './ribbon/ViewRibbon'
import { LayoutRibbon } from './ribbon/LayoutRibbon'
import { FeatureLayerRibbon, RasterLayerRibbon } from './ribbon/LayerRibbons'
import { buildUniqueRenderer, buildGraduatedRenderer, getFeatureFields, getNumericFields } from './symbology'
import BookmarksPopover from './BookmarksPopover'
import IdentifyPopup, { type IdentifyHit } from './IdentifyPopup'
import { applyWorkspacePreset, normalizeWorkspaceLayout } from './workspaceLayout'
import type { PanelFrame, WorkspacePanelId, WorkspacePreset } from './workspaceLayout'
import { SelectByAttributesDialog, SelectByLocationDialog } from './selection/SelectionDialogs'
import ToolboxPanel from './toolboxes/ToolboxPanel'
import type { ToolboxParameters, ToolboxTool, ToolExecutionResult } from './toolboxes/types'
import { mergeScopedData, scopeLayersToSelection, selectedFeatureCount } from './toolboxes/selectionScope'
import { describeToolRun } from './toolboxes/history'
import { basemaps } from './basemaps'
import { queryFeaturesAt } from './mapGeometry'
import ContentsPanel from './contents/ContentsPanel'
import { addRibbonTooltips } from './ribbon/ribbonTooltips'
import { AnalysisRibbon, EditRibbon, InsertRibbon, MapRibbon, ShareRibbon, type WorkspaceView } from './ribbon/CoreRibbons'
import StatusBar from './StatusBar'
import { DropOverlay, ImportProgress, ToolProgress } from './MapOverlays'
import ConfirmDialog from './ui/ConfirmDialog'
import { useProjectIO } from './useProjectIO'
import { useFileImport } from './useFileImport'
import { useFeatureEdits } from './editing/useFeatureEdits'
import { useSketchTools } from './editing/useSketchTools'
import { useMapInstance, type MapEvents } from './map/useMapInstance'
import { useMapSync } from './map/useMapSync'
import { useExtentHistory } from './map/useExtentHistory'
import GoToXY, { type GoToAction } from './map/GoToXY'
import { flashLocation } from './map/flashLocation'
import { useBoxSelect } from './map/useBoxSelect'
import { applyBoxSelection, featuresInBox } from './map/boxSelect'
import { useMapClick, type IdentifyState } from './map/useMapClick'
import { startUiSettingsSync } from './ui/uiSettingsSync'
import './App.css'
import { isolate } from './bidi'
import { changedLayerIds } from './toolboxes/staleUpdates'

maplibregl.setWorkerUrl(maplibreWorkerUrl)
registerOfflineProtocol()

const WORKSPACE_LAYOUT_STORAGE_KEY = 'arcweb-workspace-shell-v2'



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

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapHostRef = useRef<HTMLDivElement>(null)
  const layoutPageRef = useRef<HTMLDivElement>(null)
  const workspaceHydratedRef = useRef(false)
  const skipWorkspacePersistRef = useRef(false)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const [identify, setIdentify] = useState<IdentifyState | null>(null)
  const [selectionDialog, setSelectionDialog] = useState<'attributes' | 'location' | null>(null)
  const [bookmarkAnchor, setBookmarkAnchor] = useState<{ left: number; top: number } | null>(null)
  const [backstage, setBackstage] = useState<BackstageSection | null>(null)
  const [goToXYOpen, setGoToXYOpen] = useState(false)
  // Ribbon requests to the Geoprocessing pane; a new nonce remounts it on the requested tool/view.
  const [toolboxRequest, setToolboxRequest] = useState<{ nonce: number; toolId?: string; view?: 'tools' | 'history' }>({ nonce: 0 })
  const toastTimerRef = useRef<number | null>(null)
  const toolExecutionIdRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'warning' } | null>(null)
  const toastFadeRef = useFadeExit<HTMLDivElement>()
  const removeFadeRef = useFadeExit<HTMLDivElement>()
  const projectFadeRef = useFadeExit<HTMLDivElement>()
  const [sceneView, setSceneView] = useState(false)
  const sceneViewRef = useRef(false)
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
  const [calculatorRequest, setCalculatorRequest] = useState(0)
  const [labelRequest, setLabelRequest] = useState(0)
  const openViews = useArcWebStore(state=>state.openViews)
  const activeView = useArcWebStore(state=>state.activeView)
  const openTables = useArcWebStore(state=>state.openTables)
  const activeTable = useArcWebStore(state=>state.activeTable)
  const tableOpen = useArcWebStore((state) => state.tableOpen)
  const [propertiesLayerId,setPropertiesLayerId]=useState<string|null>(null)
  const [searchOpen,setSearchOpen]=useState(false),[shortcutsOpen,setShortcutsOpen]=useState(false)
  const [savedPaneLayout] = useState(() => {
    try { if (!localStorage.getItem('arcweb-workspace-layout-v2')) { const old=localStorage.getItem('arcweb-workspace-layout-v1'); if(old)return migrateWorkspaceLayout(normalizeWorkspaceLayout(JSON.parse(old))) } } catch { /* defaults */ }
    return loadPaneLayout()
  })
  const workspaceLayout = useArcWebStore((state) => state.workspaceLayout)
  const basemap = useArcWebStore((state) => state.basemap)
  const theme = useArcWebStore((state) => state.theme)
  const measureUnits = useArcWebStore((state) => state.measureUnits)
  const coordinateFormat = useArcWebStore((state) => state.coordinateFormat)
  const snapping = useArcWebStore((state) => state.snapping)
  const activeTab = useArcWebStore((state) => state.activeTab)
  const contentFadeRef = useContentFade(activeTab)
  const tool = useArcWebStore((state) => state.tool)
  const displayCrs = useArcWebStore((state) => state.displayCrs)
  const viewMode = useArcWebStore((state) => state.viewMode)
  const mapPropertiesOpen = useArcWebStore((state) => state.mapPropertiesOpen)
  const layoutPaper = useLayoutStore((state) => state.paper)
  const layoutOrientation = useLayoutStore((state) => state.orientation)
  const mapEventsRef = useRef<MapEvents | null>(null)
  const { mapInstance, mapLoaded } = useMapInstance({ mapRef, mapHostRef, workspaceRef, sceneViewRef, eventsRef: mapEventsRef, viewMode, mapFrameHost })
  const extentHistory = useExtentHistory(mapInstance)
  useBoxSelect(mapInstance, tool === 'select-box', (bounds, method) => applyBoxSelection(featuresInBox(useArcWebStore.getState().layers, bounds), method))
  const paneLayout = workspaceLayout.paneLayout ?? savedPaneLayout
  const changePanes = useCallback((layout: PaneLayout) => {
    const state = useArcWebStore.getState()
    state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, paneLayout: layout })
    try { localStorage.setItem('arcweb-workspace-layout-v2', JSON.stringify(layout)) } catch { /* storage unavailable */ }
  }, [])
  const showPane = useCallback((id: PaneId) => { const state = useArcWebStore.getState(); const layout = state.workspaceLayout.paneLayout ?? savedPaneLayout; changePanes(openPane(layout,id)) }, [changePanes, savedPaneLayout])
  const tableHeight = workspaceLayout.panels.attributeTable.frame.height
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null
  const tableLayer = layers.find(layer=>layer.id===activeTable) ?? selectedLayer
  const selectedFeatureIsEditable = Boolean(
    selectedLayer && selectedLayer.editable!==false && !isRasterLayer(selectedLayer) &&
    selectedFeature?.layerId === selectedLayer.id &&
    selectedLayer.data.features.some((feature) => feature.id === selectedFeature.featureId),
  )

  // Contextual ribbon tabs follow the selected layer type and the edit session.
  const editSnapshots = useArcWebStore((state) => state.editSnapshots)
  const analysisHistory = useArcWebStore((state) => state.analysisHistory)
  const undoStack = useArcWebStore((state) => state.undoStack)
  const redoStack = useArcWebStore((state) => state.redoStack)
  const tableViews = useArcWebStore((state) => state.tableViews)
  const sceneSettings = useArcWebStore((state) => state.sceneSettings)
  const pendingEditLayerNames = useMemo(() => layers
    .filter((layer) => editSnapshots[layer.id] !== undefined && editSnapshots[layer.id] !== layer.data)
    .map((layer) => layer.name), [layers, editSnapshots])
  const visibleContextualTabs = getVisibleContextualTabs({ selectedLayer, viewMode })
  const visibleContextualKey = visibleContextualTabs.join('|')
  const previousContextualTabsRef = useRef<ContextualTab[]>([])
  /** Treats the current context as already seen, so restoring a session does not hijack the ribbon. */
  const adoptRibbonContext = useCallback(() => {
    const state = useArcWebStore.getState()
    previousContextualTabsRef.current = getVisibleContextualTabs({
      selectedLayer: state.layers.find((layer) => layer.id === state.selectedLayerId) ?? null,
      viewMode: state.viewMode,
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
    useArcWebStore.getState().addNotification(message,kind)
    setToast({ message, kind })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200)
  }, [])

  const resetWorkspaceView = useCallback(() => {
    setSceneView(false)
    setIdentify(null)
  }, [])
  const {
    library, captureWorkspace, projectStorageReady, pendingProject, cancelPendingProject,
    offlineBasemap, selectOfflineBasemap, getOfflineAreaBounds, addSourceAsset,
    applyProject, loadProjectFile, saveProject, startNewWorkspace,
  } = useProjectIO({ mapRef, mapInstance, notify, adoptRibbonContext, onWorkspaceReplaced: resetWorkspaceView })
  const { importingFile, addFiles, cancelImport } = useFileImport({ notify, loadProjectFile, addSourceAsset })
  const {
    appendFeature, deleteFeature, addCustomField, removeCustomField, calculateLayerField, createEditableLayer,
    deleteSelectedFeature, editTargetIds, deleteSelectedFeatures, undoEdit, redoEdit, editCell,
  } = useFeatureEdits(notify)
  const {
    measurePoints, sketchPoints, movingVertexRef, addMeasurePoint, addSketchPoint, redrawOverlays, finishSketch, undoLastVertex,
    setEditingTool, toggleMeasureTool, clearMeasurements, saveEdits, discardEdits,
  } = useSketchTools({ mapRef, mapLoaded, notify, appendFeature })
  const terrainState = useMapSync({ mapRef, mapLoaded, sceneView, sceneViewRef, viewMode, offlineBasemap, projectStorageReady, redrawOverlays })
  const [measuredFeature,setMeasuredFeature]=useState<Feature['geometry']|null>(null)
  const { handleMapClick, showIdentify } = useMapClick({ notify, workspaceRef, setIdentify, appendFeature, addMeasurePoint, addSketchPoint, movingVertexRef, onMeasureFeature: hit=>{const layer=useArcWebStore.getState().layers.find(layer=>layer.id===hit.layerId);setMeasuredFeature(layer?.data.features.find(feature=>feature.id===hit.featureId)?.geometry??null)} })
  // The map reads its handlers through this ref, so handler changes never rebuild the map.
  useEffect(() => {
    mapEventsRef.current = {
      onClick: handleMapClick,
      onFinishSketch: finishSketch,
      onCanvasMenu: (request) => setContextMenu({ kind: 'canvas', ...request }),
    }
  })

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
    state.setWorkspaceLayout({ ...applyWorkspacePreset(state.workspaceLayout, preset), paneLayout: applyPanePreset(state.workspaceLayout.paneLayout??savedPaneLayout, preset) })
    setSceneView(false)
    if (preset === 'analysis') {
      state.setActiveTab('Analysis')
      state.setViewMode('map')
    } else if (preset === 'cartography') {
      state.setActiveTab('LayoutInsert')
      state.setViewMode('layout')
    } else {
      state.setActiveTab('Map')
      state.setViewMode('map')
    }
  }, [savedPaneLayout])

  const toggleFullCanvas = useCallback(() => {
    const state = useArcWebStore.getState()
    state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, fullCanvas: !state.workspaceLayout.fullCanvas })
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

  // Theme, measure units and coordinate format are per-browser preferences, saved as they change.
  useEffect(() => startUiSettingsSync(), [])

  useEffect(() => {
    let restored = false
    try {
      const saved = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY) ?? window.localStorage.getItem('arcweb-workspace-layout-v1')
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
      useArcWebStore.getState().setActiveTab('LayoutInsert')
      useArcWebStore.getState().setViewMode('layout')
    }
  }, [workspaceLayout.preset])




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
      const inputs = toolDefinition.runsOnMainThread ? state.layers : selectToolInputLayers(toolDefinition, state.layers, parameters)
      const scope = options.selectedOnly ? scopeLayersToSelection(inputs, state.selections) : { layers: inputs, scoped: new Map() }
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
      result.layers?.forEach((layer) => useArcWebStore.getState().addLayer({...layer,source:{kind:'tool',name:toolDefinition.name}}))
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


  const clearSession = async () => {
    try {
      await startNewWorkspace()
      clearMeasurements()
      setIdentify(null)
      notify('New workspace ready. Previous work remains in Projects.')
    } catch (error) {
      notify(`Could not clear the saved workspace: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
    }
  }

  const closeBackstage = useCallback(() => setBackstage(null), [])
  // Ctrl+O must not switch the Project page away from a running storage operation.
  const backstageBusyRef = useRef(false)
  const setBackstageBusy = useCallback((busy: boolean) => { backstageBusyRef.current = busy }, [])
  const openProjectPage = useCallback(() => { if (!backstageBusyRef.current && !document.querySelector('[aria-modal="true"]:not(.backstage)')) setBackstage('open') }, [])
  const renameProject = useCallback((name: string) => useArcWebStore.getState().setProjectName(name), [])
  /** Quick Access Save / Ctrl+S: projects save automatically; this commits pending changes now. */
  const { state: libraryState, error: libraryError, flush: flushLibrary } = library
  const saveNow = useCallback(() => {
    void saveProjectNow({ state: libraryState, error: libraryError, flush: flushLibrary }, notify)
  }, [libraryState, libraryError, flushLibrary, notify])
  useAppShortcuts({ save: saveNow, open: openProjectPage, commandSearch:()=>setSearchOpen(true) })
  /** Save As › Save a copy in Projects: like Pro, the copy becomes the open project. */
  const saveProjectCopy = async () => {
    try {
      const current = captureWorkspace()
      await library.create({ ...current, project: { ...current.project, name: `${current.project.name} — copy` } }, true)
      setBackstage(null)
      notify(`Saved a copy in Projects. You are now working in “${isolate(current.project.name)} — copy”.`)
    } catch (error) {
      notify(`Could not save a copy: ${error instanceof Error ? error.message : 'IndexedDB error'}`, 'error')
    }
  }
  const applyUiSettings = useCallback((settings: UiSettings) => {
    const state = useArcWebStore.getState()
    state.setTheme(settings.theme)
    state.setMeasureUnits(settings.measureUnits)
    state.setCoordinateFormat(settings.coordinateFormat)
  }, [])

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
  /** Opens the bookmarks panel under the ribbon's Bookmarks button. */
  const openBookmarksPanel = useCallback(() => {
    const bounds = document.querySelector('[data-command="bookmarks"]')?.getBoundingClientRect()
    setBookmarkAnchor(bounds ? { left: bounds.left, top: bounds.bottom + 8 } : { left: 24, top: 140 })
  }, [])

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
    if (type !== 'picture') { useLayoutStore.getState().addElement(type); return }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.className = 'layout-picture-input'
    input.hidden = true
    document.body.appendChild(input)
    input.oncancel = () => input.remove()
    input.onchange = async () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      try {
        const picture = await readLayoutPicture(file)
        const state = useLayoutStore.getState()
        state.addElement('picture')
        const id = useLayoutStore.getState().selectedId
        if (id) state.updateElement(id, { src: picture.src, alt: picture.alt, w: 60, h: Math.min(100, 60 / picture.aspect) })
      } catch (error) { notify(error instanceof Error ? error.message : 'Could not insert picture.', 'error') }
    }
    input.click()
  }, [notify])

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
    if (state.workspaceLayout.tableMinimized) state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, tableMinimized: false })
    state.setTableOpen(true)
  }, [])

  /** Selects the layer and shows the Symbology pane, switching off tabs whose right pane shows something else. */
  const openLayerSymbology = useCallback((layer: MapLayer) => {
    const state = useArcWebStore.getState()
    state.setSelectedLayer(layer.id)
    showPane('symbology')
    state.setActiveTab(isRasterLayer(layer) ? 'RasterAppearance' : 'FeatureAppearance')
    if (!state.workspaceLayout.rightPaneOpen) state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, rightPaneOpen: true })
  }, [showPane])

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

  const goToXY = useCallback((lngLat: [number, number], action: GoToAction) => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ center: lngLat, duration: 600 })
    if (action === 'flash') flashLocation(map, lngLat)
    if (action === 'marker') addQuickMarker(lngLat)
  }, [addQuickMarker])
  const closeGoToXY = useCallback(() => setGoToXYOpen(false), [])
  /** Shows the Geoprocessing pane (Analysis tab, right pane open), optionally on a tool or the history. */
  const openGeoprocessing = useCallback((request: { toolId?: string; view?: 'tools' | 'history' }) => {
    const state = useArcWebStore.getState()
    showPane('geoprocessing')
    state.setActiveTab('Analysis')
    state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, rightPaneOpen: true })
    setToolboxRequest((current) => ({ nonce: current.nonce + 1, ...request }))
  }, [showPane])
  /** Insert › New Layer: the Edit pane holds the new-layer form. */
  const openNewLayerForm = useCallback(() => {
    const state = useArcWebStore.getState()
    showPane('createFeatures')
    state.setActiveTab('Edit')
    state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, rightPaneOpen: true })
  }, [showPane])

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
        properties:()=>setPropertiesLayerId(layer.id),
        zoomVisible:()=>{const map=mapRef.current;if(map){const scale=layer.minScale&&layer.maxScale?Math.sqrt(layer.minScale*layer.maxScale):layer.minScale?layer.minScale/1.1:layer.maxScale?layer.maxScale*1.1:undefined;if(scale)map.setZoom(zoomForScale(map.getCenter().lat,scale))}},
        selectAll:()=>useArcWebStore.getState().setSelection(layer.id,layer.data.features.flatMap(feature=>feature.id===undefined?[]:[feature.id])),
        clearSelection:()=>useArcWebStore.getState().setSelection(layer.id,[]),
        zoomSelection:zoomToSelected,
        toggleLabels:()=>useArcWebStore.getState().updateLayer(layer.id,{labelStyle:{...layer.labelStyle,enabled:!layer.labelStyle.enabled}}),
        labelProperties:()=>{openLayerSymbology(layer);setLabelRequest(value=>value+1)},
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
    openMapProperties, zoomToAll, zoomToLayer, toggleLayerTable, openLayerSymbology, exportSelectedLayer, zoomToSelected,
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

  const toggleContentsFloating = useCallback(() => togglePanelFloating('contents'), [togglePanelFloating])
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])
  /** Switches between the 2D map, the 3D scene and the print layout. */
  const showView = useCallback((view: WorkspaceView) => {
    useArcWebStore.getState().openView(view==='3d'?'scene':view==='layout'?'layout':'map')
    setSceneView(view === '3d')
    useArcWebStore.getState().setViewMode(view === 'layout' ? 'layout' : 'map')
  }, [])
  const workspaceView: WorkspaceView = viewMode === 'layout' ? 'layout' : sceneView ? '3d' : '2d'
  const openMapRootMenu = useCallback((x: number, y: number) => setContextMenu({ kind: 'map-root', x, y }), [])

  const selectedCount = Object.values(selections).reduce((sum, ids) => sum + ids.length, 0)
  const hasSelection = selectedCount > 0 || selectedFeature !== null
  const tableLayerId=tableLayer?.id
  const tableLayerSelections=tableLayerId?selections[tableLayerId]:undefined
  const tableSelectedIds=useMemo(()=>new Set<FeatureId>(tableLayerSelections??[]),[tableLayerSelections])
  // Resolve identified features against the live layers so edits and deletions are reflected.
  const identifyHits: IdentifyHit[] = identify ? identify.hits.flatMap((hit) => {
    const layer = layers.find((item) => item.id === hit.layerId)
    const feature = layer?.data.features.find((item) => item.id === hit.featureId)
    return layer && feature ? [{ layer, feature }] : []
  }) : []
  const identifyIndex = identify ? Math.min(identify.index, identifyHits.length - 1) : 0
  const identifiedHit = identifyHits[identifyIndex]

  const displayCrsDefinition = requireCrs(displayCrs)

  const commands: Command[] = [
    {id:'save',label:'Save Project',keywords:'save Ctrl S',run:saveNow},
    {id:'open',label:'Open Project',keywords:'open Ctrl O',run:openProjectPage},
    {id:'select-attributes',label:'Select By Attributes',run:()=>setSelectionDialog('attributes'),disabled:!selectedLayer},
    {id:'select-location',label:'Select By Location',run:()=>setSelectionDialog('location'),disabled:!layers.length},
    ...PANE_IDS.map(id=>({id:'pane-'+id,label:'Open '+PANE_TITLES[id],run:()=>showPane(id)})),
    ...CORE_TABS.map(tab=>({id:'tab-'+tab,label:tab+' tab',run:()=>useArcWebStore.getState().setActiveTab(tab)})),
    ...toolboxTools.map(tool=>({id:'tool-'+tool.id,label:tool.name,keywords:'geoprocessing '+tool.category,run:()=>openGeoprocessing({toolId:tool.id})})),
  ]
  const renderPane = (pane: PaneId) => pane === 'contents' ? (<DockablePanel
          floating={false}
          frame={workspaceLayout.panels.contents.frame}
          className="contents-window"
          onFrameChange={updateContentsFrame}
        >
        <ContentsPanel
          layers={layers}
          selectedLayerId={selectedLayerId}
          menuLayerId={contextMenu?.kind === 'layer' ? contextMenu.layerId : null}
          crsCode={displayCrsDefinition.code}
          minimized={false}
          floating={false}
          onToggleFloat={toggleContentsFloating}
          onAddData={openFilePicker}
          onOpenMapProperties={openMapProperties}
          onMapRootMenu={openMapRootMenu}
          onLayerMenu={openLayerMenu}
          onZoomToLayer={zoomToLayer}
          onRemoveLayer={setPendingRemoval}
        />
        </DockablePanel>) : pane === 'catalog' ? (
    <CatalogPane offlineBasemapName={offlineBasemap?.name} assetIds={captureWorkspace().assetIds ?? []} onView={showView} onTool={toolId=>openGeoprocessing({toolId})} onAdd={files=>void addFiles(files)} onOffline={()=>setBackstage('library')} onNewLayer={openNewLayerForm} />
  ) : pane === 'modifyFeatures' ? (<ModifyFeaturesPane onTool={setEditingTool} onDelete={deleteSelectedFeatures} onAttributes={()=>showPane('attributes')} />) : pane === 'attributes' ? (<AttributesPane layers={layers} onEdit={(layer,id,field,value)=>editCell(layer.id,id,field,value)} />) : pane === 'geoprocessing' ? (
          <DockablePanel
            floating={false}
            frame={workspaceLayout.panels.geoprocessing.frame}
            className="geoprocessing-window"
            onFrameChange={updateGeoprocessingFrame}
          >
            <aside className="dock symbology-dock toolbox-dock">
              <ToolboxPanel
                key={toolboxRequest.nonce}
                initialToolId={toolboxRequest.toolId}
                initialView={toolboxRequest.view}
                layers={layers}
                selectedLayerId={selectedLayerId}
                floating={false}
                onToggleFloat={() => togglePanelFloating('geoprocessing')}
                selectionCount={selectedFeatureCount(layers, selections)}
                running={toolExecutionProgress?.name ?? null}
                history={analysisHistory}
                onExecute={(definition, parameters, options) => void executeTool(definition, parameters, options)}
                onCancel={cancelTool}
                onClose={() => {
                  changePanes(closePane(paneLayout,'geoprocessing'))
                }}
              />
            </aside>
          </DockablePanel>
        ) : pane === 'createFeatures' ? (
          <aside className="dock symbology-dock"><CreateFeaturesPane
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
        ) : viewMode === 'layout' && pane === 'symbology' ? (
          <aside className="dock symbology-dock"><LayoutPanel
            viewMode={viewMode}
            exporting={layoutExporting}
            onSetViewMode={(mode) => useArcWebStore.getState().setViewMode(mode)}
            onInsert={insertLayoutElement}
            onExport={(format, dpi) => void exportLayout(format, dpi)}
          /></aside>
        ) : (
        <DockablePanel
          floating={false}
          frame={workspaceLayout.panels.symbology.frame}
          className="symbology-window"
          onFrameChange={updateSymbologyFrame}
        >
        <SymbologyPanel
          labelRequest={labelRequest}
          selectedLayer={selectedLayer}
          floating={false}
          onToggleFloat={() => togglePanelFloating('symbology')}
          onUpdate={(updates) => {
            if (selectedLayer) useArcWebStore.getState().updateLayer(selectedLayer.id, updates)
          }}
          onAddData={() => useArcWebStore.getState().setActiveTab('Insert')}
        />
        </DockablePanel>
         )
  const paneRenderers = Object.fromEntries(PANE_IDS.map(id=>[id,{title:PANE_TITLES[id],render:()=>renderPane(id)}]))

  return (
    <main ref={contentFadeRef} inert={library.state === 'loading'} aria-busy={library.state === 'loading'} className={`arc-app preset-${workspaceLayout.preset} ${workspaceLayout.fullCanvas ? 'full-canvas' : ''}`}>
      <TitleBar
        projectName={projectName}
        onRename={renameProject}
        saveState={library.state}
        saveError={library.error}
        quickAccess={{ onSave: saveNow, onUndo: undoEdit, onRedo: redoEdit, onOpen: openProjectPage, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }}
      ><button onClick={()=>setSearchOpen(true)}>Search commands (Alt+Q)</button><NotificationsMenu /></TitleBar>
      {propertiesLayerId&&layers.find(layer=>layer.id===propertiesLayerId)&&<LayerPropertiesDialog layer={layers.find(layer=>layer.id===propertiesLayerId)!} onClose={()=>setPropertiesLayerId(null)} onUpdate={update=>useArcWebStore.getState().updateLayer(propertiesLayerId,update)} />}
      {searchOpen&&<CommandSearch commands={commands} onClose={()=>setSearchOpen(false)} />}
      {shortcutsOpen&&<KeyboardShortcutsDialog onClose={()=>setShortcutsOpen(false)} />}
      <input ref={projectInputRef} className="visually-hidden" type="file" tabIndex={-1} aria-label="Choose an ArcWeb project file" accept=".json,.arcweb.json,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file) void loadProjectFile(file)
        event.currentTarget.value = ''
      }} />

      <nav className="ribbon-tabs" aria-label="Ribbon tabs">
        <button className="ribbon-tab project-tab" aria-haspopup="dialog" aria-expanded={backstage !== null} onClick={() => setBackstage('new')}>Project</button>
        {CORE_TABS.map((tab) => (
          <button key={tab} className={`ribbon-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => {
            useArcWebStore.getState().setActiveTab(tab)

          }}>{tab}</button>
        ))}
        {CONTEXTUAL_GROUPS.filter(group => group.tabs.some(tab => visibleContextualTabs.includes(tab))).map(group => (
          <div key={group.id} className={'contextual-tab-set contextual-' + group.id} role="group" aria-label={group.label}>
            <span className="contextual-group-heading">{group.label}</span>
            <div className="contextual-group-tabs">{group.tabs.filter(tab => visibleContextualTabs.includes(tab)).map(tab => (
              <button key={tab} className={`ribbon-tab contextual-tab ${activeTab === tab ? 'active' : ''}`}
                aria-pressed={activeTab === tab} title={group.label + ': ' + CONTEXTUAL_TAB_META[tab].label}
                onClick={() => useArcWebStore.getState().setActiveTab(tab)}>{CONTEXTUAL_TAB_META[tab].label}</button>
            ))}</div>
          </div>
        ))}
        <div className="ribbon-context">{viewMode === 'layout' ? 'LAYOUT VIEW' : sceneView ? '3D SCENE' : '2D MAP'}</div>
      </nav>

      <section className={`ribbon-toolbar ${isContextualTab(activeTab) ? `contextual-toolbar contextual-${activeTab.startsWith('Layout') ? 'layout' : 'layer'}` : ''}`}>
        {addRibbonTooltips(<>{['FeatureAppearance', 'FeatureLabeling', 'FeatureData'].includes(activeTab) && selectedLayer ? (
          <FeatureLayerRibbon
            tab={activeTab as 'FeatureAppearance' | 'FeatureLabeling' | 'FeatureData'}
            layer={selectedLayer}
            currentScale={() => { const map = mapRef.current; return map ? scaleDenominator(map.getCenter().lat, map.getZoom()) : undefined }}
            onUpdate={(updates) => useArcWebStore.getState().updateLayer(selectedLayer.id, updates)}
            onSymbology={(type, labels) => {
              try {
                if (type === 'single') useArcWebStore.getState().updateLayer(selectedLayer.id, { renderer: { type: 'single' } })
                if (type === 'unique') useArcWebStore.getState().updateLayer(selectedLayer.id, { renderer: buildUniqueRenderer(selectedLayer, getFeatureFields(selectedLayer)[0], 'pastel', selectedLayer.renderer) })
                if (type === 'graduated') useArcWebStore.getState().updateLayer(selectedLayer.id, { renderer: buildGraduatedRenderer(selectedLayer, getNumericFields(selectedLayer)[0], 'quantile', 5, 'viridis') })
                const state = useArcWebStore.getState()
                state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, rightPaneOpen: true })
                showPane('symbology')
                if (labels) setLabelRequest(value => value + 1)
              } catch (error) { notify(error instanceof Error ? error.message : 'Could not apply symbology', 'error') }
            }}
            onTable={() => { const state = useArcWebStore.getState(); state.setTableOpen(true); state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, tableMinimized: false }) }}
            onCalculate={() => { const state = useArcWebStore.getState(); state.setTableOpen(true); state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, tableMinimized: false }); setCalculatorRequest(value => value + 1) }}
            onSelect={() => setSelectionDialog('attributes')}
            onZoomSelection={zoomToSelected}
            onClear={clearSelection}
            hasSelection={hasSelection}
            onExport={format => exportSelectedLayer(selectedLayer, format)}
          />
        ) : ['RasterAppearance', 'RasterData'].includes(activeTab) && selectedLayer ? (
          <RasterLayerRibbon
            tab={activeTab as 'RasterAppearance' | 'RasterData'}
            onTable={() => { const state = useArcWebStore.getState(); state.setTableOpen(true); state.setWorkspaceLayout({ ...useArcWebStore.getState().workspaceLayout, tableMinimized: false }) }}
            onExport={format => exportSelectedLayer(selectedLayer, format)}
            layer={selectedLayer}
            onUpdate={(updates) => useArcWebStore.getState().updateLayer(selectedLayer.id, updates)}
            onZoomToLayer={() => zoomToLayer(selectedLayer)}
            onError={(message) => notify(message, 'error')}
          />
        ) : activeTab === 'Map' ? (
          <MapRibbon
            basemap={basemap}
            offlineBasemapActive={Boolean(offlineBasemap)}
            tool={tool}
            hasLayers={layers.length > 0}
            hasSelection={hasSelection}
            selectedCount={selectedCount}
            bookmarks={bookmarks}
            canGoBack={extentHistory.canGoBack}
            canGoForward={extentHistory.canGoForward}
            onSelectBasemap={(id) => { selectOfflineBasemap(undefined); useArcWebStore.getState().setBasemap(id) }}
            onExplore={() => setEditingTool('pan')}
            onZoomIn={() => mapRef.current?.zoomIn({ duration: 250 })}
            onZoomOut={() => mapRef.current?.zoomOut({ duration: 250 })}
            onFullExtent={zoomToAll}
            onBack={extentHistory.goBack}
            onForward={extentHistory.goForward}
            onGoToBookmark={(id) => { const bookmark = bookmarks.find((item) => item.id === id); if (bookmark) goToBookmark(bookmark) }}
            onManageBookmarks={openBookmarksPanel}
            onAddData={openFilePicker}
            onOpenProjectFile={() => projectInputRef.current?.click()}
            onSelectByAttributes={() => setSelectionDialog('attributes')}
            onSelectByLocation={() => setSelectionDialog('location')}
            onZoomToSelected={zoomToSelected}
            onClearSelection={clearSelection}
            onToggleMeasure={toggleMeasureTool}
            onOpenMapProperties={openMapProperties}
            onMeasureFeature={()=>{setMeasuredFeature(null);useArcWebStore.getState().setTool('measure-feature')}}
            onGoToXY={() => setGoToXYOpen(true)}
            onIdentify={() => useArcWebStore.getState().setTool('pan')}
            onSelectTool={() => setEditingTool(tool === 'select-box' ? 'pan' : 'select-box')}
          />
        ) : activeTab === 'Insert' ? (
          <InsertRibbon
            onNewLayout={(template) => { useLayoutStore.getState().applyTemplate(template); showView('layout') }}
            onNewLayer={openNewLayerForm}
            onAddData={openFilePicker}
          />
        ) : activeTab === 'Analysis' ? (
          <AnalysisRibbon
            onOpenTools={() => openGeoprocessing({})}
            onOpenHistory={() => openGeoprocessing({ view: 'history' })}
            onOpenTool={(toolId) => openGeoprocessing({ toolId })}
          />
        ) : (activeTab === 'LayoutInsert' || activeTab === 'LayoutExport') ? (
          <LayoutRibbon
            tab={activeTab}
            paper={layoutPaper}
            orientation={layoutOrientation}
            onPage={(paper, orientation) => useLayoutStore.getState().setPage(paper, orientation)}
            exporting={layoutExporting}
            onClose={() => {useArcWebStore.getState().closeView('layout');showView('2d')}}
            onInsert={insertLayoutElement}
            onExport={(format, dpi) => void exportLayout(format, dpi)}
          />
        ) : activeTab === 'View' ? (
          <ViewRibbon
            contentsOpen={!workspaceLayout.contentsMinimized}
            sidePaneOpen={workspaceLayout.rightPaneOpen}
            tableOpen={tableOpen}
            tableAvailable={Boolean(selectedLayer)}
            preset={workspaceLayout.preset}
            mode={workspaceView}
            fullCanvas={workspaceLayout.fullCanvas}
            theme={theme}
            onTogglePane={(pane) => {
              if (pane !== 'table') { showPane(pane === 'side' ? 'symbology' : pane); return }
              const state = useArcWebStore.getState()
              state.setTableOpen(true); state.setWorkspaceLayout({ ...state.workspaceLayout, tableMinimized: false })
            }}
            onPreset={selectWorkspacePreset}
            onMode={showView}
            onOpenPane={showPane}
            onToggleFullCanvas={toggleFullCanvas}
            onToggleTheme={() => useArcWebStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
        ) : activeTab === 'Help' ? (<HelpRibbon onShortcuts={()=>setShortcutsOpen(true)} onAbout={()=>setBackstage('about')} />        ) : activeTab === 'Edit' ? (
          <EditRibbon
            tool={tool}
            hasLayer={Boolean(selectedLayer)}
            selectedFeatureIsEditable={selectedFeatureIsEditable}
            pendingEdits={pendingEditLayerNames.length > 0}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            hasSelection={editTargetIds.length > 0}
            snapping={snapping}
            onSetTool={next=>{ setEditingTool(next); showPane(next==='move-vertex'?'modifyFeatures':'createFeatures') }}
            onSave={saveEdits}
            onDiscard={discardEdits}
            onUndo={undoEdit}
            onRedo={redoEdit}
            onSnapping={(next) => useArcWebStore.getState().setSnapping(next)}
            onDeleteSelected={deleteSelectedFeatures}
            onSelectTool={() => setEditingTool(tool === 'select-box' ? 'pan' : 'select-box')}
            onClearSelection={clearSelection}
          />
        ) : (
          <ShareRibbon
            hasLayer={Boolean(selectedLayer)}
            layoutExporting={layoutExporting}
            onExportLayer={(format) => { if (selectedLayer) exportSelectedLayer(selectedLayer, format) }}
            onExportMap={() => void exportCurrentMap()}
            onExportLayout={(format) => void exportLayout(format)}
            onDownloadProject={saveProject}
            onBackupProjects={() => setBackstage('library')}
          />
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
        <DockArea side="left" layout={paneLayout} panes={paneRenderers} onChange={changePanes} />
        <section className="map-workspace" ref={workspaceRef} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false)
        }} onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
        }}>
          <ViewTabs views={openViews} active={activeView} onActivate={kind=>showView(kind==='scene'?'3d':kind==='layout'?'layout':'2d')} onClose={kind=>{useArcWebStore.getState().closeView(kind);const next=useArcWebStore.getState().activeView;showView(next==='scene'?'3d':next==='layout'?'layout':'2d')}} />
          <div className="map-host" ref={mapHostRef} />
          {goToXYOpen && <GoToXY onGo={goToXY} onClose={closeGoToXY} />}
          {workspaceLayout.fullCanvas && <button className="full-canvas-exit" onClick={toggleFullCanvas}><X size={14} />Restore workspace</button>}
          {importingFile && <ImportProgress file={importingFile} onCancel={cancelImport} />}
          {toolExecutionProgress && <ToolProgress progress={toolExecutionProgress} />}
          {viewMode === 'layout' && (
            <LayoutView map={mapInstance} layers={layers} basemap={basemap} pageRef={layoutPageRef} onMapFrameHost={setMapFrameHost} />
          )}
          <div className="map-top-left">
            {viewMode === 'map' && <span className="map-coordinate-badge"><span className="live-dot" />{sceneView ? '3D Scene · right-drag to rotate' : offlineBasemap?.name ?? basemaps.find((item) => item.id === basemap)?.name}</span>}
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
          {(tool === 'distance' || tool === 'area' || tool === 'measure-feature') && (
            <MeasureWindow mode={tool} points={measurePoints} feature={measuredFeature} units={measureUnits} onUnits={units=>useArcWebStore.getState().setMeasureUnits(units)} onMode={mode=>useArcWebStore.getState().setTool(mode)} onClear={()=>{clearMeasurements();setMeasuredFeature(null)}} onClose={()=>useArcWebStore.getState().setTool('pan')} />
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
          {(tool === 'draw-line' || tool === 'draw-polygon' || tool === 'draw-rectangle' || tool === 'draw-circle') && (
            <SketchToolbar onUndo={undoLastVertex} mode={tool} vertexCount={sketchPoints.length} onCancel={() => setEditingTool('pan')} onFinish={finishSketch} />
          )}
          {isDragging && <DropOverlay />}
          <StatusBar
            map={mapInstance}
            viewMode={viewMode}
            displayCrs={displayCrs}
            layoutPaper={layoutPaper}
            layoutOrientation={layoutOrientation}
            onOpenMapProperties={openMapProperties}
          />
        </section>

        <DockArea side="right" layout={paneLayout} panes={paneRenderers} onChange={changePanes} />
      </div>

      {tableOpen && tableLayer && !workspaceLayout.tableMinimized && (
        <DockablePanel
          floating={workspaceLayout.panels.attributeTable.floating}
          frame={workspaceLayout.panels.attributeTable.frame}
          className="attribute-table-window"
          onFrameChange={updateAttributeTableFrame}
        >
        <TableDock layers={layers} openTables={openTables} active={activeTable} onActivate={id=>useArcWebStore.getState().openTable(id)} onClose={id=>useArcWebStore.getState().closeTable(id)} />
        <AttributeTable
          calculatorRequest={calculatorRequest}
          layer={tableLayer}
          selectedFeatureId={selectedFeature?.layerId === tableLayer.id ? selectedFeature.featureId : null}
          selectedIds={tableSelectedIds}
          height={tableHeight}
          floating={workspaceLayout.panels.attributeTable.floating}
          onToggleFloat={() => togglePanelFloating('attributeTable')}
          onToggleSelection={(feature) => { if (feature.id !== undefined) useArcWebStore.getState().toggleSelected(tableLayer.id, feature.id) }}
          onSelectByAttributes={() => setSelectionDialog('attributes')}
          onZoomToSelected={zoomToSelected}
          onClearSelection={clearSelection}
          onResizePointerDown={handleTableResize}
          onClose={() => useArcWebStore.getState().closeTable(tableLayer.id)}
          onSelectFeature={(feature) => selectAndZoomFeature(tableLayer, feature)}
          onDeleteFeature={(featureId) => deleteFeature(tableLayer, featureId)}
          onAddField={(name) => addCustomField(tableLayer, name)}
          onRemoveField={(name) => removeCustomField(tableLayer, name)}
          onCalculate={(name, expression) => calculateLayerField(tableLayer, name, expression)}
          view={tableViews[tableLayer.id] ?? EMPTY_TABLE_VIEW}
          onViewChange={(view) => useArcWebStore.getState().setTableView(tableLayer.id, view)}
          editable={tableLayer.editable!==false&&!isRasterLayer(tableLayer)}
          onEditCell={(featureId, field, value) => editCell(tableLayer.id, featureId, field, value)}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={undoEdit}
          onRedo={redoEdit}
        />
        </DockablePanel>
      )}



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
        <ConfirmDialog
          backdropRef={removeFadeRef}
          label="Remove layer"
          icon={<Trash2 size={15} />}
          title={<>Remove “<bdi>{pendingRemovalLayer.name}</bdi>”?</>}
          confirmLabel="Remove layer"
          danger
          dismissOnBackdrop
          onCancel={cancelRemoveLayer}
          onConfirm={confirmRemoveLayer}
        >
          <p>The layer and its {pendingRemovalLayer.data.features.length.toLocaleString()} feature{pendingRemovalLayer.data.features.length === 1 ? '' : 's'} will be removed from this project.</p>
          <p className="modal-note">This cannot be undone. Export the layer first if you want to keep a copy.{editSnapshots[pendingRemovalLayer.id] ? ' Its unsaved edits will be lost.' : ''}</p>
        </ConfirmDialog>
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
        <ConfirmDialog
          backdropRef={projectFadeRef}
          label="Open project"
          icon={<FolderOpen size={15} />}
          title={<>Open “<bdi>{pendingProject.name}</bdi>”?</>}
          confirmLabel="Replace workspace"
          onCancel={cancelPendingProject}
          onConfirm={() => applyProject(pendingProject)}
        >
          <p>Opening this project replaces the current workspace: {layers.length} layer{layers.length === 1 ? '' : 's'}, the layout, panel positions and bookmarks will be discarded.</p>
          <p className="modal-note">Cancel and save your current work from the Project page if you want to keep it. The project contains {pendingProject.layers.length} layer{pendingProject.layers.length === 1 ? '' : 's'}{pendingProject.savedAt ? ` and was saved on ${new Date(pendingProject.savedAt).toLocaleString()}` : ''}.</p>
        </ConfirmDialog>
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

      {backstage && (
        <Backstage
          projectName={projectName}
          section={backstage}
          onSection={setBackstage}
          onClose={closeBackstage}
          onNewBlank={() => void clearSession()}
          onOpenFile={() => projectInputRef.current?.click()}
          onSaveFile={saveProject}
          onSaveCopy={() => void saveProjectCopy()}
          library={{
            projectId: library.projectId, capture: captureWorkspace, onOpen: library.open, onCreate: library.create,
            onFlush: library.flush, onRecover: library.recover, onOffline: selectOfflineBasemap, getBounds: getOfflineAreaBounds,
          }}
          settings={{ theme, measureUnits, coordinateFormat }}
          onSettings={applyUiSettings}
          onBusyChange={setBackstageBusy}
        />
      )}

      {toast && <div ref={toastFadeRef} className={`toast toast-${toast.kind}`} role="status"><span className="toast-indicator">{toast.kind === 'error' ? <X size={13} /> : <Check size={13} />}</span><span>{toast.message}</span><button title="Dismiss" onClick={() => setToast(null)}><X size={14} /></button></div>}
    </main>
  )
}

export default App
