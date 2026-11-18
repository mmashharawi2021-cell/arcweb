import { isEmbeddedPicture } from './layout/picture'
import type { FeatureCollection } from 'geojson'
import { getCrs, WGS84 } from './crs'
import type { LayoutDocument, LayoutElement } from './layout/layoutStore'
import { isPaperSize } from './layout/paper'
import {
  DEFAULT_SCENE_SETTINGS, MAX_ANALYSIS_HISTORY,
  type AnalysisRecord, type BasemapId, type Bookmark, type CategoricalRampId, type ClassificationMethod, type ContinuousRampId,
  type ExtrusionSettings, type GeometryKind, type LabelStyle, type MapLayer, type PointShape, type RendererConfig,
  type SceneSettings, type SortDirection, type StrokeDash, type TableView,
} from './store'
import { defaultWorkspaceLayout, normalizeWorkspaceLayout } from './workspaceLayout'
import type { WorkspaceLayoutConfig } from './workspaceLayout'

/**
 * Portable project files (`.arcweb.json`): the whole workspace in one JSON document,
 * so a student can submit an assignment or continue on another computer.
 */

export const PROJECT_FORMAT = 'arcweb-project'
export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = '.arcweb.json'

export interface MapCamera {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

export interface ArcWebProject {
  format: typeof PROJECT_FORMAT
  version: number
  name: string
  savedAt: string
  map: {
    basemap: BasemapId
    /** Display coordinate system (EPSG code). */
    displayCrs: string
    camera: MapCamera | null
    bookmarks: Bookmark[]
    /** 3D Scene terrain settings (added after version 1; absent in older files). */
    scene: SceneSettings
  }
  layers: MapLayer[]
  layout: LayoutDocument
  workspaceLayout: WorkspaceLayoutConfig
  /** Geoprocessing history, most recent first. */
  analysisHistory: AnalysisRecord[]
  /** Attribute table sort and column filters, keyed by layer ID. */
  tableViews: Record<string, TableView>
}

export interface ProjectSource {
  name: string
  basemap: BasemapId
  displayCrs: string
  camera: MapCamera | null
  bookmarks: Bookmark[]
  layers: MapLayer[]
  layout: LayoutDocument
  workspaceLayout: WorkspaceLayoutConfig
  scene?: SceneSettings
  analysisHistory?: AnalysisRecord[]
  tableViews?: Record<string, TableView>
}

export function buildProject(source: ProjectSource): ArcWebProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: source.name,
    savedAt: new Date().toISOString(),
    map: { basemap: source.basemap, displayCrs: source.displayCrs, camera: source.camera, bookmarks: source.bookmarks, scene: source.scene ?? { ...DEFAULT_SCENE_SETTINGS } },
    layers: source.layers,
    layout: source.layout,
    workspaceLayout: normalizeWorkspaceLayout(source.workspaceLayout),
    analysisHistory: (source.analysisHistory ?? []).slice(0, MAX_ANALYSIS_HISTORY),
    // Only views of layers that are in the project; empty views are not worth storing.
    tableViews: Object.fromEntries(Object.entries(source.tableViews ?? {}).filter(([layerId, view]) =>
      source.layers.some((layer) => layer.id === layerId) && (view.sort !== null || Object.keys(view.filters).length > 0))),
  }
}

export function projectFileName(name: string): string {
  const safe = name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '_').replace(/\.+$/, '')
  return `${safe || 'arcweb-project'}${PROJECT_EXTENSION}`
}

export function isProjectFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PROJECT_EXTENSION)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const text = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback

const basemapIds: BasemapId[] = ['osm', 'satellite', 'dark', 'light']
const geometryKinds: GeometryKind[] = ['Point', 'Line', 'Polygon', 'Mixed', 'Unknown']
const classificationMethods: ClassificationMethod[] = ['equal-interval', 'quantile', 'natural-breaks']
const categoricalRamps: CategoricalRampId[] = ['pastel', 'vivid', 'earth', 'urban']
const continuousRamps: ContinuousRampId[] = ['viridis', 'yl-or-rd', 'blues', 'greens', 'rd-yl-gn']
const strokeDashes: StrokeDash[] = ['solid', 'dashed', 'dotted']
const pointShapes: PointShape[] = ['circle', 'square', 'triangle', 'diamond']
const elementTypes = ['map', 'title', 'text', 'legend', 'north', 'scalebar', 'titleblock', 'picture']

function parseCamera(value: unknown): MapCamera | null {
  if (!isRecord(value) || !Array.isArray(value.center)) return null
  const [longitude, latitude] = value.center as unknown[]
  if (typeof longitude !== 'number' || typeof latitude !== 'number' || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null
  return { center: [longitude, latitude], zoom: Math.max(0, Math.min(22, finite(value.zoom, 3))), bearing: finite(value.bearing, 0), pitch: finite(value.pitch, 0) }
}

function parseRenderer(value: unknown): RendererConfig {
  if (isRecord(value) && typeof value.field === 'string') {
    if (value.type === 'unique' && isRecord(value.colors)) {
      return {
        type: 'unique',
        field: value.field,
        colors: Object.fromEntries(Object.entries(value.colors).filter(([, item]) => typeof item === 'string').map(([key, item]) => [key, color(item, '#f5a623')])),
        ramp: categoricalRamps.includes(value.ramp as CategoricalRampId) ? value.ramp as CategoricalRampId : 'vivid',
        overrides: Array.isArray(value.overrides) ? value.overrides.filter((item): item is string => typeof item === 'string') : [],
      }
    }
    if (value.type === 'graduated' && Array.isArray(value.breaks) && Array.isArray(value.colors)) {
      return {
        type: 'graduated',
        field: value.field,
        method: classificationMethods.includes(value.method as ClassificationMethod) ? value.method as ClassificationMethod : 'quantile',
        breaks: value.breaks.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)),
        colors: value.colors.filter((item): item is string => typeof item === 'string').map((item) => color(item, '#f5a623')),
        ramp: continuousRamps.includes(value.ramp as ContinuousRampId) ? value.ramp as ContinuousRampId : 'viridis',
        labels: Array.isArray(value.labels) ? value.labels.filter((item): item is string => typeof item === 'string') : undefined,
        classCount: Number.isInteger(value.classCount) && Number(value.classCount) >= 3 && Number(value.classCount) <= 8 ? Number(value.classCount) : undefined,
      }
    }
  }
  return { type: 'single' }
}

function parseLabelStyle(value: unknown, labelField: string, strokeColor: string): LabelStyle {
  const record = isRecord(value) ? value : {}
  const haloColorValue = record.haloColor
  const haloColor = typeof haloColorValue === 'string' &&
    (/^#[0-9a-f]{6}$/i.test(haloColorValue) || /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i.test(haloColorValue))
    ? haloColorValue
    : 'rgba(18, 22, 30, 0.88)'
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : Boolean(labelField),
    expression: typeof record.expression === 'string' ? record.expression : '',
    fontSize: Math.max(6, Math.min(48, finite(record.fontSize, 11))),
    color: color(record.color, strokeColor),
    haloColor,
    haloWidth: Math.max(0, Math.min(8, finite(record.haloWidth, 1.4))),
    placement: record.placement === 'line' ? 'line' : 'point',
    offset: Math.max(-5, Math.min(5, finite(record.offset, 1.15))),
  }
}

function parseLayer(value: unknown, index: number): MapLayer {
  if (!isRecord(value)) throw new Error(`Layer ${index + 1} is not a valid layer object.`)
  const data = value.data
  if (!isRecord(data) || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error(`Layer "${text(value.name, String(index + 1))}" does not contain a GeoJSON FeatureCollection.`)
  }
  const features = (data.features as unknown[]).filter((feature) => isRecord(feature) && feature.type === 'Feature')
  const fillColor = color(value.fillColor, '#f5a623')
  const strokeColor = color(value.strokeColor, '#ffe0a3')
  const labelField = typeof value.labelField === 'string' ? value.labelField : ''
  return {
    id: text(value.id, crypto.randomUUID()),
    name: text(value.name, `Layer ${index + 1}`),
    data: { type: 'FeatureCollection', features } as FeatureCollection,
    geometry: geometryKinds.includes(value.geometry as GeometryKind) ? value.geometry as GeometryKind : 'Unknown',
    visible: value.visible !== false,
    ...parseScaleRange(value),
    opacity: Math.max(0, Math.min(1, finite(value.opacity, 0.88))),
    fillColor,
    strokeColor,
    strokeWidth: finite(value.strokeWidth, 2),
    strokeDash: strokeDashes.includes(value.strokeDash as StrokeDash) ? value.strokeDash as StrokeDash : 'solid',
    fillOpacity: Math.max(0, Math.min(1, finite(value.fillOpacity, 1))),
    pointRadius: finite(value.pointRadius, 6),
    pointShape: pointShapes.includes(value.pointShape as PointShape) ? value.pointShape as PointShape : 'circle',
    labelField,
    labelStyle: parseLabelStyle(value.labelStyle, labelField, strokeColor),
    customFields: Array.isArray(value.customFields) ? value.customFields.filter((item): item is string => typeof item === 'string') : [],
    fieldAliases: isRecord(value.fieldAliases)
      ? Object.fromEntries(Object.entries(value.fieldAliases).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {},
    renderer: parseRenderer(value.renderer),
    sourceCrs: text(value.sourceCrs, WGS84),
    ...('extrusion' in value ? { extrusion: parseExtrusion(value.extrusion) } : {}),
  }
}

function parseExtrusion(value: unknown): ExtrusionSettings | null | undefined {
  if (value === null) return null
  if (isRecord(value) && typeof value.field === 'string' && value.field) {
    return { field: value.field, multiplier: Math.max(0, finite(value.multiplier, 1)) }
  }
  return undefined
}

export function parseSceneSettings(value: unknown): SceneSettings {
  if (!isRecord(value)) return { ...DEFAULT_SCENE_SETTINGS }
  const terrain = value.terrain === 'world' || value.terrain === 'layer' ? value.terrain : 'none'
  return {
    terrain,
    terrainLayerId: typeof value.terrainLayerId === 'string' ? value.terrainLayerId : null,
    exaggeration: Math.max(0.5, Math.min(5, finite(value.exaggeration, DEFAULT_SCENE_SETTINGS.exaggeration))),
    hillshade: typeof value.hillshade === 'boolean' ? value.hillshade : DEFAULT_SCENE_SETTINGS.hillshade,
  }
}

export function parseAnalysisHistory(value: unknown): AnalysisRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): AnalysisRecord[] => {
    if (!isRecord(item) || typeof item.toolId !== 'string' || typeof item.toolName !== 'string') return []
    const parameters = isRecord(item.parameters)
      ? Object.fromEntries(Object.entries(item.parameters).filter((entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || (typeof entry[1] === 'number' && Number.isFinite(entry[1]))))
      : {}
    return [{
      id: text(item.id, crypto.randomUUID()),
      toolId: item.toolId,
      toolName: item.toolName,
      startedAt: text(item.startedAt, new Date(0).toISOString()),
      durationMs: Math.max(0, finite(item.durationMs, 0)),
      status: item.status === 'failed' ? 'failed' : 'succeeded',
      message: typeof item.message === 'string' ? item.message : '',
      parameters,
      summary: typeof item.summary === 'string' ? item.summary : '',
      selectedOnly: item.selectedOnly === true,
      outputLayerNames: Array.isArray(item.outputLayerNames) ? item.outputLayerNames.filter((name): name is string => typeof name === 'string') : [],
    }]
  }).slice(0, MAX_ANALYSIS_HISTORY)
}

export function parseTableViews(value: unknown, layerIds: Set<string>): Record<string, TableView> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([layerId, view]): [string, TableView][] => {
    if (!layerIds.has(layerId) || !isRecord(view)) return []
    const sort = isRecord(view.sort) && typeof view.sort.field === 'string' && (view.sort.direction === 1 || view.sort.direction === -1)
      ? { field: view.sort.field, direction: view.sort.direction as SortDirection }
      : null
    const filters = isRecord(view.filters)
      ? Object.fromEntries(Object.entries(view.filters).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''))
      : {}
    return [[layerId, { sort, filters }]]
  }))
}

/** Fills in every field a title block needs, so a hand-edited project cannot break the sheet. */
function normalizeTitleBlock(element: Record<string, unknown>): Record<string, unknown> {
  const fields = Array.isArray(element.fields)
    ? element.fields.filter(isRecord).map((field) => ({ label: typeof field.label === 'string' ? field.label : '', value: typeof field.value === 'string' ? field.value : '' })).slice(0, 10)
    : []
  return {
    ...element,
    title: typeof element.title === 'string' ? element.title : 'Map Title',
    subtitle: typeof element.subtitle === 'string' ? element.subtitle : '',
    fields,
    fontSize: Math.max(4, finite(element.fontSize, 7.5)),
    frame: element.frame !== false,
    accent: color(element.accent, '#e9844a'),
  }
}

function parseLayout(value: unknown): LayoutDocument | null {
  if (!isRecord(value) || !Array.isArray(value.elements)) return null
  const elements = (value.elements as unknown[]).filter((element): element is Record<string, unknown> =>
    isRecord(element) && (element.type !== 'picture' || isEmbeddedPicture(element.src)) && elementTypes.includes(element.type as string) &&
    ['x', 'y', 'w', 'h'].every((key) => typeof element[key] === 'number' && Number.isFinite(element[key])))
    .map((element) => ({ ...(element.type === 'titleblock' ? normalizeTitleBlock(element) : element.type === 'picture' ? { ...element, alt: typeof element.alt === 'string' ? element.alt : 'Picture', fit: element.fit === 'cover' ? 'cover' : 'contain' } : element), id: text(element.id, crypto.randomUUID()) }))
  return {
    paper: isPaperSize(value.paper) ? value.paper : 'A4',
    orientation: value.orientation === 'portrait' ? 'portrait' : 'landscape',
    elements: elements as unknown as LayoutElement[],
  }
}

/**
 * Reads and validates a project document. Throws a readable error for files that are
 * not ArcWeb projects; tolerates missing optional parts by falling back to defaults.
 */
export function parseProject(json: string, fallbackLayout: LayoutDocument): ArcWebProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  if (!isRecord(parsed) || parsed.format !== PROJECT_FORMAT) {
    throw new Error('This is not an ArcWeb project file. To load data, use Insert → Add data instead.')
  }
  const version = finite(parsed.version, 0)
  if (version < 1 || version > PROJECT_VERSION) {
    throw new Error(`This project was saved with a newer ArcWeb format (version ${version}). Update ArcWeb to open it.`)
  }
  if (!Array.isArray(parsed.layers)) throw new Error('The project file has no layer list.')
  const map = isRecord(parsed.map) ? parsed.map : {}
  const bookmarks = (Array.isArray(map.bookmarks) ? map.bookmarks : []).flatMap((item: unknown): Bookmark[] => {
    const camera = parseCamera(item)
    return camera && isRecord(item) ? [{ id: text(item.id, crypto.randomUUID()), name: text(item.name, 'Bookmark'), ...camera }] : []
  })
  const layers = parsed.layers.map(parseLayer)
  return {
    format: PROJECT_FORMAT,
    version,
    name: text(parsed.name, 'Untitled map'),
    savedAt: text(parsed.savedAt, ''),
    map: {
      basemap: basemapIds.includes(map.basemap as BasemapId) ? map.basemap as BasemapId : 'osm',
      displayCrs: typeof map.displayCrs === 'string' && getCrs(map.displayCrs) ? getCrs(map.displayCrs)!.code : WGS84,
      camera: parseCamera(map.camera),
      bookmarks,
      scene: parseSceneSettings(map.scene),
    },
    layers,
    layout: parseLayout(parsed.layout) ?? fallbackLayout,
    workspaceLayout: normalizeWorkspaceLayout(parsed.workspaceLayout ?? defaultWorkspaceLayout()),
    analysisHistory: parseAnalysisHistory(parsed.analysisHistory),
    tableViews: parseTableViews(parsed.tableViews, new Set(layers.map((layer) => layer.id))),
  }
}

function parseScaleRange(value: Record<string, unknown>): { minScale?: number; maxScale?: number } {
  const scale = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(1e9, v)) : undefined
  const minScale = scale(value.minScale), maxScale = scale(value.maxScale)
  if (minScale !== undefined && maxScale !== undefined && minScale <= maxScale) return {}
  return { ...(minScale !== undefined ? { minScale } : {}), ...(maxScale !== undefined ? { maxScale } : {}) }
}
