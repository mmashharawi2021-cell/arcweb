import type { FeatureCollection } from 'geojson'
import type { LayersSlice } from './slices/layers'
import type { SelectionSlice } from './slices/selection'
import type { EditSessionSlice } from './slices/editSession'
import type { WorkspaceSlice } from './slices/workspace'
import type { ProjectDataSlice } from './slices/projectData'

export type GeometryKind = 'Point' | 'Line' | 'Polygon' | 'Mixed' | 'Unknown'
export type BasemapId = 'osm' | 'satellite' | 'dark' | 'light'
export type CoreTab = 'Map' | 'Insert' | 'Analysis' | 'Edit' | 'View' | 'Layout' | 'Share'
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

/** The full store: every slice combined. Slice creators are typed against this so cross-slice actions can touch any key. */
export type ArcWebState = LayersSlice & SelectionSlice & EditSessionSlice & WorkspaceSlice & ProjectDataSlice
