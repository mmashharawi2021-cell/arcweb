import { create } from 'zustand'
import type { FeatureCollection } from 'geojson'
import { isContextualTab, isEditingTool } from './ribbon/contextualTabs'
import { defaultWorkspaceLayout } from './workspaceLayout'
import type { WorkspaceLayoutConfig } from './workspaceLayout'

export type GeometryKind = 'Point' | 'Line' | 'Polygon' | 'Mixed' | 'Unknown'
export type BasemapId = 'osm' | 'satellite' | 'dark' | 'light'
export type CoreTab = 'Map' | 'Insert' | 'Analysis' | 'Edit' | 'Layout' | 'Share'
/** Ribbon tabs that only appear while their context (layer type or edit session) is active. */
export type ContextualTab = 'FeatureLayer' | 'RasterLayer' | 'EditSession'
export type AppTab = CoreTab | ContextualTab
export type ViewMode = 'map' | 'layout'
export type ToolMode = 'pan' | 'distance' | 'area' | 'draw-point' | 'draw-line' | 'draw-polygon' | 'move-vertex'
export type FeatureId = string | number
export interface FeatureSelection { layerId: string; featureId: FeatureId }
/** How a new set of matches combines with a layer's current selection (ArcGIS "Selection type"). */
export type SelectionMethod = 'new' | 'add' | 'remove' | 'subset'
export type StrokeDash = 'solid' | 'dashed' | 'dotted'
export type PointShape = 'circle' | 'square' | 'triangle' | 'diamond'
export type ClassificationMethod = 'equal-interval' | 'quantile' | 'natural-breaks'
export type CategoricalRampId = 'pastel' | 'vivid' | 'earth' | 'urban'
export type ContinuousRampId = 'viridis' | 'yl-or-rd' | 'blues' | 'greens' | 'rd-yl-gn'
export interface LabelStyle {
  enabled: boolean
  expression: string
  fontSize: number
  color: string
  haloColor: string
  haloWidth: number
  placement: 'point' | 'line'
  offset: number
}
/** A saved camera position. */
export interface Bookmark {
  id: string
  name: string
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}
/** 3D Scene terrain options; saved with the project. */
export interface SceneSettings {
  terrain: 'none' | 'world' | 'layer'
  /** DEM raster layer used when terrain is 'layer'. */
  terrainLayerId: string | null
  /** Vertical exaggeration applied to the terrain surface. */
  exaggeration: number
  hillshade: boolean
}
export const DEFAULT_SCENE_SETTINGS: SceneSettings = { terrain: 'none', terrainLayerId: null, exaggeration: 1.5, hillshade: true }
/** 3D extrusion of polygon features by a numeric attribute (height = value × multiplier, in metres). */
export interface ExtrusionSettings { field: string; multiplier: number }
/** One run of a geoprocessing tool, kept in the project like ArcGIS Pro's Geoprocessing History. */
export interface AnalysisRecord {
  id: string
  toolId: string
  toolName: string
  /** ISO timestamp of when the tool started. */
  startedAt: string
  durationMs: number
  status: 'succeeded' | 'failed'
  message: string
  /** Parameter values as entered (layer IDs, numbers, text); file inputs are recorded by name only. */
  parameters: Record<string, string | number>
  /** Human-readable parameter summary (layer IDs resolved to names at run time). */
  summary: string
  selectedOnly: boolean
  outputLayerNames: string[]
}
export const MAX_ANALYSIS_HISTORY = 100
/** One undoable change to a layer's features inside the edit session. */
export interface EditStep {
  layerId: string
  label: string
  before: FeatureCollection
  after: FeatureCollection
}
export const MAX_UNDO_STEPS = 100
export type SortDirection = 1 | -1
/** How a layer's attribute table is sorted and filtered; saved with the project. */
export interface TableView {
  sort: { field: string; direction: SortDirection } | null
  /** Field name → filter text (e.g. "rail", ">=10", "5..20", "null"). */
  filters: Record<string, string>
}
export type RendererConfig =
  | { type: 'single' }
  | { type: 'unique'; field: string; colors: Record<string, string>; ramp?: CategoricalRampId; overrides?: string[] }
  | { type: 'graduated'; field: string; method: ClassificationMethod; breaks: number[]; colors: string[]; ramp?: ContinuousRampId; labels?: string[]; classCount?: number }

export interface MapLayer {
  id: string
  name: string
  data: FeatureCollection
  geometry: GeometryKind
  visible: boolean
  opacity: number
  fillColor: string
  strokeColor: string
  strokeWidth: number
  strokeDash: StrokeDash
  fillOpacity: number
  pointRadius: number
  pointShape: PointShape
  labelField: string
  labelStyle: LabelStyle
  customFields: string[]
  fieldAliases?: Record<string, string>
  renderer: RendererConfig
  /**
   * Spatial reference of the dataset the layer came from (an EPSG code or a .prj name).
   * Geometry is always held in WGS 84 for MapLibre and Turf; this records the native system.
   */
  sourceCrs: string
  /**
   * 3D Scene extrusion: unset = detect a height/levels field automatically, null = never extrude,
   * an object = extrude by that field.
   */
  extrusion?: ExtrusionSettings | null
}

interface ArcWebState {
  layers: MapLayer[]
  selectedLayerId: string | null
  /** The single identified / edited feature (the "primary" feature). */
  selectedFeature: FeatureSelection | null
  /** Selection sets made with the selection tools, keyed by layer ID. */
  selections: Record<string, FeatureId[]>
  bookmarks: Bookmark[]
  projectName: string
  tableOpen: boolean
  basemap: BasemapId
  theme: 'dark' | 'light'
  activeTab: AppTab
  /** Tab restored when the active contextual tab disappears. */
  ribbonReturnTab: AppTab
  tool: ToolMode
  /**
   * Edit session: each layer's data as it was before the session first touched it.
   * A layer has pending edits while its current data differs from its snapshot.
   */
  editSnapshots: Record<string, FeatureCollection>
  /** Most recent first. */
  analysisHistory: AnalysisRecord[]
  undoStack: EditStep[]
  redoStack: EditStep[]
  tableViews: Record<string, TableView>
  sceneSettings: SceneSettings
  /** Coordinate system used for the status-bar readout and Map Properties. */
  displayCrs: string
  viewMode: ViewMode
  mapPropertiesOpen: boolean
  workspaceLayout: WorkspaceLayoutConfig
  addLayer: (layer: MapLayer) => void
  removeLayer: (id: string) => void
  updateLayer: (id: string, updates: Partial<MapLayer>) => void
  moveLayer: (id: string, direction: -1 | 1) => void
  setSelectedLayer: (id: string | null) => void
  setSelectedFeature: (selection: FeatureSelection | null) => void
  setSelection: (layerId: string, featureIds: FeatureId[], method?: SelectionMethod) => void
  toggleSelected: (layerId: string, featureId: FeatureId) => void
  clearSelection: () => void
  addBookmark: (bookmark: Bookmark) => void
  removeBookmark: (id: string) => void
  setBookmarks: (bookmarks: Bookmark[]) => void
  setProjectName: (name: string) => void
  setTableOpen: (open: boolean) => void
  setBasemap: (basemap: BasemapId) => void
  setTheme: (theme: 'dark' | 'light') => void
  setActiveTab: (tab: AppTab) => void
  setRibbonTabs: (activeTab: AppTab, returnTab: AppTab) => void
  setTool: (tool: ToolMode) => void
  /** Snapshots a layer so its edits can be discarded; no-op if the session already holds it. */
  beginEdit: (layerId: string) => void
  saveEdits: () => void
  discardEdits: () => void
  addAnalysisRecord: (record: AnalysisRecord) => void
  /** Replaces a layer's features as one undoable edit-session step. */
  commitEdit: (layerId: string, data: FeatureCollection, label: string) => void
  /** Returns the label of the step undone/redone, or null when there is nothing (valid) to apply. */
  undo: () => string | null
  redo: () => string | null
  setTableView: (layerId: string, view: Partial<TableView>) => void
  setTableViews: (views: Record<string, TableView>) => void
  setSceneSettings: (settings: Partial<SceneSettings>) => void
  /**
   * Resumes an edit session saved before a reload. Only snapshots of layers that exist and whose
   * data still differs from the snapshot are kept (anything else has nothing to discard).
   */
  restoreEditSnapshots: (snapshots: Record<string, FeatureCollection>) => void
  setAnalysisHistory: (records: AnalysisRecord[]) => void
  setDisplayCrs: (code: string) => void
  setViewMode: (mode: ViewMode) => void
  setMapPropertiesOpen: (open: boolean) => void
  setWorkspaceLayout: (layout: WorkspaceLayoutConfig) => void
  clearSession: () => void
  restoreLayers: (layers: MapLayer[]) => void
}

function normalizeLabelStyle(style: LabelStyle | undefined, layer: MapLayer): LabelStyle {
  const source = style ?? {
    enabled: Boolean(layer.labelField),
    expression: '',
    fontSize: 11,
    color: layer.strokeColor,
    haloColor: 'rgba(18, 22, 30, 0.88)',
    haloWidth: 1.4,
    placement: 'point' as const,
    offset: 1.15,
  }
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : Boolean(layer.labelField),
    expression: typeof source.expression === 'string' ? source.expression : '',
    fontSize: Number.isFinite(source.fontSize) ? Math.max(6, Math.min(48, source.fontSize)) : 11,
    color: typeof source.color === 'string' ? source.color : layer.strokeColor,
    haloColor: typeof source.haloColor === 'string' ? source.haloColor : 'rgba(18, 22, 30, 0.88)',
    haloWidth: Number.isFinite(source.haloWidth) ? Math.max(0, Math.min(8, source.haloWidth)) : 1.4,
    placement: source.placement === 'line' ? 'line' : 'point',
    offset: Number.isFinite(source.offset) ? Math.max(-5, Math.min(5, source.offset)) : 1.15,
  }
}

export const useArcWebStore = create<ArcWebState>((set) => ({
  layers: [],
  selectedLayerId: null,
  selectedFeature: null,
  selections: {},
  bookmarks: [],
  projectName: 'Untitled map',
  tableOpen: false,
  basemap: 'osm',
  theme: 'dark',
  activeTab: 'Map',
  ribbonReturnTab: 'Map',
  tool: 'pan',
  editSnapshots: {},
  analysisHistory: [],
  undoStack: [],
  redoStack: [],
  tableViews: {},
  sceneSettings: DEFAULT_SCENE_SETTINGS,
  displayCrs: 'EPSG:4326',
  viewMode: 'map',
  mapPropertiesOpen: false,
  workspaceLayout: defaultWorkspaceLayout(),
  addLayer: (layer) => set((state) => ({
    layers: [layer, ...state.layers],
    selectedLayerId: layer.id,
    selectedFeature: null,
  })),
  removeLayer: (id) => set((state) => {
    const layers = state.layers.filter((layer) => layer.id !== id)
    const removesSelection = state.selectedFeature?.layerId === id
    const selections = { ...state.selections }
    delete selections[id]
    const editSnapshots = { ...state.editSnapshots }
    delete editSnapshots[id]
    const tableViews = { ...state.tableViews }
    delete tableViews[id]
    const sceneSettings = state.sceneSettings.terrainLayerId === id
      ? { ...state.sceneSettings, terrain: state.sceneSettings.terrain === 'layer' ? 'none' as const : state.sceneSettings.terrain, terrainLayerId: null }
      : state.sceneSettings
    return {
      sceneSettings,
      tableViews,
      undoStack: state.undoStack.filter((step) => step.layerId !== id),
      redoStack: state.redoStack.filter((step) => step.layerId !== id),
      layers,
      selections,
      editSnapshots,
      selectedLayerId: state.selectedLayerId === id ? layers[0]?.id ?? null : state.selectedLayerId,
      selectedFeature: removesSelection ? null : state.selectedFeature,
      tableOpen: removesSelection ? false : state.tableOpen,
    }
  }),
  updateLayer: (id, updates) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...updates } : layer),
  })),
  moveLayer: (id, direction) => set((state) => {
    const index = state.layers.findIndex((layer) => layer.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.layers.length) return state
    const layers = [...state.layers]
    ;[layers[index], layers[target]] = [layers[target], layers[index]]
    return { layers }
  }),
  setSelectedLayer: (selectedLayerId) => set((state) => selectedLayerId === state.selectedLayerId
    ? {}
    : { selectedLayerId, selectedFeature: null }),
  setSelectedFeature: (selectedFeature) => set({ selectedFeature }),
  setSelection: (layerId, featureIds, method = 'new') => set((state) => {
    const current = state.selections[layerId] ?? []
    const incoming = new Set(featureIds)
    const next = method === 'add' ? [...current, ...featureIds.filter((id) => !current.includes(id))]
      : method === 'remove' ? current.filter((id) => !incoming.has(id))
        : method === 'subset' ? current.filter((id) => incoming.has(id))
          : featureIds
    const selections = { ...state.selections }
    if (next.length) selections[layerId] = next
    else delete selections[layerId]
    return { selections }
  }),
  toggleSelected: (layerId, featureId) => set((state) => {
    const current = state.selections[layerId] ?? []
    const next = current.includes(featureId) ? current.filter((id) => id !== featureId) : [...current, featureId]
    const selections = { ...state.selections }
    if (next.length) selections[layerId] = next
    else delete selections[layerId]
    return { selections }
  }),
  clearSelection: () => set({ selections: {}, selectedFeature: null }),
  addBookmark: (bookmark) => set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
  removeBookmark: (id) => set((state) => ({ bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== id) })),
  setBookmarks: (bookmarks) => set({ bookmarks }),
  setProjectName: (projectName) => set({ projectName }),
  setTableOpen: (tableOpen) => set({ tableOpen }),
  setBasemap: (basemap) => set({ basemap }),
  setTheme: (theme) => set({ theme }),
  setActiveTab: (activeTab) => set((state) => activeTab === state.activeTab ? {} : {
    activeTab,
    // Entering a contextual tab by hand remembers the tab to return to when its context ends.
    ribbonReturnTab: isContextualTab(activeTab) ? state.activeTab : state.ribbonReturnTab,
  }),
  setRibbonTabs: (activeTab, ribbonReturnTab) => set({ activeTab, ribbonReturnTab }),
  setTool: (tool) => set((state) => {
    if (isEditingTool(tool)) return { tool }
    // Leaving the editing tools drops snapshots of layers that were never changed.
    // Layers with undo/redo steps keep theirs too, so a redo still has something to discard back to.
    const hasHistory = (layerId: string) => [...state.undoStack, ...state.redoStack].some((step) => step.layerId === layerId)
    const editSnapshots = Object.fromEntries(Object.entries(state.editSnapshots).filter(([layerId, snapshot]) =>
      hasHistory(layerId) || state.layers.some((layer) => layer.id === layerId && layer.data !== snapshot)))
    return { tool, editSnapshots }
  }),
  beginEdit: (layerId) => set((state) => {
    const layer = state.layers.find((item) => item.id === layerId)
    if (!layer || state.editSnapshots[layerId]) return {}
    return { editSnapshots: { ...state.editSnapshots, [layerId]: layer.data } }
  }),
  saveEdits: () => set({ editSnapshots: {}, undoStack: [], redoStack: [], tool: 'pan' }),
  commitEdit: (layerId, data, label) => set((state) => {
    const layer = state.layers.find((item) => item.id === layerId)
    if (!layer || layer.data === data) return {}
    return {
      layers: state.layers.map((item) => item.id === layerId ? { ...item, data } : item),
      editSnapshots: state.editSnapshots[layerId] ? state.editSnapshots : { ...state.editSnapshots, [layerId]: layer.data },
      undoStack: [...state.undoStack, { layerId, label, before: layer.data, after: data }].slice(-MAX_UNDO_STEPS),
      redoStack: [],
    }
  }),
  undo: () => applyHistoryStep('undo'),
  redo: () => applyHistoryStep('redo'),
  setTableView: (layerId, view) => set((state) => {
    const current = state.tableViews[layerId] ?? { sort: null, filters: {} }
    return { tableViews: { ...state.tableViews, [layerId]: { ...current, ...view } } }
  }),
  setTableViews: (tableViews) => set({ tableViews }),
  setSceneSettings: (settings) => set((state) => ({ sceneSettings: { ...state.sceneSettings, ...settings } })),
  restoreEditSnapshots: (snapshots) => set((state) => ({
    editSnapshots: Object.fromEntries(Object.entries(snapshots).filter(([layerId, snapshot]) => {
      const layer = state.layers.find((item) => item.id === layerId)
      return Boolean(layer && snapshot && Array.isArray(snapshot.features) && JSON.stringify(layer.data) !== JSON.stringify(snapshot))
    })),
  })),
  addAnalysisRecord: (record) => set((state) => ({ analysisHistory: [record, ...state.analysisHistory].slice(0, MAX_ANALYSIS_HISTORY) })),
  setAnalysisHistory: (analysisHistory) => set({ analysisHistory: analysisHistory.slice(0, MAX_ANALYSIS_HISTORY) }),
  discardEdits: () => set((state) => {
    const snapshots = state.editSnapshots
    const layers = state.layers.map((layer) => snapshots[layer.id] ? { ...layer, data: snapshots[layer.id] } : layer)
    const selections = Object.fromEntries(Object.entries(state.selections).filter(([layerId]) => !snapshots[layerId]))
    const selectedFeature = state.selectedFeature && snapshots[state.selectedFeature.layerId] ? null : state.selectedFeature
    return { layers, selections, selectedFeature, editSnapshots: {}, undoStack: [], redoStack: [], tool: 'pan' }
  }),
  setDisplayCrs: (displayCrs) => set({ displayCrs }),
  setViewMode: (viewMode) => set({ viewMode }),
  setMapPropertiesOpen: (mapPropertiesOpen) => set({ mapPropertiesOpen }),
  setWorkspaceLayout: (workspaceLayout) => set({ workspaceLayout }),
  clearSession: () => set({
    layers: [],
    selectedLayerId: null,
    selectedFeature: null,
    selections: {},
    tableOpen: false,
    tool: 'pan',
    editSnapshots: {},
    undoStack: [],
    redoStack: [],
    tableViews: {},
    analysisHistory: [],
    sceneSettings: DEFAULT_SCENE_SETTINGS,
  }),
  restoreLayers: (layers) => {
    const normalized = layers.map((layer) => {
      const featureIds = new Set<string | number>()
      const features = layer.data.features.map((feature, index) => {
        const originalId = feature.id ?? `${layer.id}:${index}`
        let uniqueId = originalId
        let suffix = 1
        while (featureIds.has(uniqueId)) {
          uniqueId = `${String(originalId)}:${suffix}`
          suffix += 1
        }
        featureIds.add(uniqueId)
        return { ...feature, id: uniqueId }
      })
      const strokeDash: StrokeDash = layer.strokeDash === 'dashed' || layer.strokeDash === 'dotted' ? layer.strokeDash : 'solid'
      const pointShape: PointShape = layer.pointShape === 'square' || layer.pointShape === 'triangle' || layer.pointShape === 'diamond'
        ? layer.pointShape
        : 'circle'
      return {
        ...layer,
        customFields: layer.customFields ?? [],
        fieldAliases: layer.fieldAliases ?? {},
        renderer: layer.renderer ?? { type: 'single' },
        strokeDash,
        fillOpacity: Number.isFinite(layer.fillOpacity) ? Math.max(0, Math.min(1, layer.fillOpacity)) : 1,
        pointShape,
        labelStyle: normalizeLabelStyle(layer.labelStyle, layer),
        sourceCrs: layer.sourceCrs ?? 'EPSG:4326',
        data: { ...layer.data, features },
      }
    })
    set({ layers: normalized, selectedLayerId: normalized[0]?.id ?? null, selectedFeature: null, selections: {}, editSnapshots: {}, undoStack: [], redoStack: [] })
  },
}))

/**
 * Moves one step between the undo and redo stacks. A step only applies while the layer still holds
 * the data that step produced; if something else changed the layer since (a tool, an import), the
 * history for that direction is stale and is dropped rather than overwriting newer work.
 */
function applyHistoryStep(direction: 'undo' | 'redo'): string | null {
  const state = useArcWebStore.getState()
  const from = direction === 'undo' ? state.undoStack : state.redoStack
  const step = from[from.length - 1]
  if (!step) return null
  const layer = state.layers.find((item) => item.id === step.layerId)
  const expected = direction === 'undo' ? step.after : step.before
  if (!layer || layer.data !== expected) {
    useArcWebStore.setState(direction === 'undo' ? { undoStack: [] } : { redoStack: [] })
    return null
  }
  const data = direction === 'undo' ? step.before : step.after
  const remaining = from.slice(0, -1)
  const to = direction === 'undo' ? [...state.redoStack, step] : [...state.undoStack, step]
  const selectedFeature = state.selectedFeature?.layerId === step.layerId &&
    !data.features.some((feature) => feature.id === state.selectedFeature?.featureId) ? null : state.selectedFeature
  useArcWebStore.setState({
    layers: state.layers.map((item) => item.id === step.layerId ? { ...item, data } : item),
    selectedFeature,
    ...(direction === 'undo' ? { undoStack: remaining, redoStack: to } : { redoStack: remaining, undoStack: to }),
  })
  return step.label
}
