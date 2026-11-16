import type { FeatureCollection } from 'geojson'
import type { AppTab, ContextualTab, CoreTab, MapLayer, ToolMode } from '../store'

/** The permanent ribbon tabs, in display order. */
export const CORE_TABS: readonly CoreTab[] = ['Map', 'Insert', 'Analysis', 'Edit', 'Layout', 'Share']

/** Contextual tabs in display order; earlier entries win when several appear at once. */
export const CONTEXTUAL_TABS: readonly ContextualTab[] = ['EditSession', 'FeatureLayer', 'RasterLayer']

/** ArcGIS Pro shows a contextual tab under a small group header naming the context. */
export const CONTEXTUAL_TAB_META: Record<ContextualTab, { group: string; label: string }> = {
  FeatureLayer: { group: 'Feature Layer', label: 'Appearance' },
  RasterLayer: { group: 'Raster Layer', label: 'Appearance' },
  EditSession: { group: 'Editing', label: 'Edit Tools' },
}

/**
 * Core tabs that carry no workflow state of their own. A contextual tab that appears while one of
 * these is active takes over the ribbon; on Analysis, Edit, Layout or Share it only lights up, so
 * selecting a layer never tears down the Geoprocessing pane or a print layout mid-task.
 */
const NEUTRAL_TABS: ReadonlySet<AppTab> = new Set<AppTab>(['Map', 'Insert'])

const EDITING_TOOLS: ReadonlySet<ToolMode> = new Set<ToolMode>(['draw-point', 'draw-line', 'draw-polygon', 'move-vertex'])

export function isContextualTab(tab: AppTab): tab is ContextualTab {
  return (CONTEXTUAL_TABS as readonly AppTab[]).includes(tab)
}

export function isEditingTool(tool: ToolMode): boolean {
  return EDITING_TOOLS.has(tool)
}

/** Layers built from a raster (GeoTIFF import or a raster tool) store one cell per feature with row/column/value. */
export function isRasterLayer(layer: Pick<MapLayer, 'data'>): boolean {
  const properties = layer.data.features[0]?.properties
  return Boolean(
    properties &&
    typeof properties.value === 'number' &&
    Number.isInteger(properties.row) &&
    Number.isInteger(properties.column) &&
    Number.isInteger(properties.rasterWidth),
  )
}

/** True when any layer's data has changed since its edit-session snapshot was taken. */
export function hasPendingEdits(layers: Pick<MapLayer, 'id' | 'data'>[], snapshots: Record<string, FeatureCollection>): boolean {
  return layers.some((layer) => snapshots[layer.id] !== undefined && snapshots[layer.id] !== layer.data)
}

export interface RibbonContext {
  selectedLayer: Pick<MapLayer, 'data' | 'geometry'> | null
  tool: ToolMode
  pendingEdits: boolean
}

export function getVisibleContextualTabs({ selectedLayer, tool, pendingEdits }: RibbonContext): ContextualTab[] {
  const visible: ContextualTab[] = []
  if (isEditingTool(tool) || pendingEdits) visible.push('EditSession')
  // Standalone tables (no geometry) get no appearance tab.
  if (selectedLayer && selectedLayer.geometry !== 'Unknown') {
    visible.push(isRasterLayer(selectedLayer) ? 'RasterLayer' : 'FeatureLayer')
  }
  return visible
}

export interface RibbonTabState {
  activeTab: AppTab
  /** Tab to fall back to when the active contextual tab disappears. */
  returnTab: AppTab
}

function isAvailable(tab: AppTab, visible: readonly ContextualTab[]): boolean {
  return !isContextualTab(tab) || visible.includes(tab)
}

/**
 * Decides the active ribbon tab after the set of contextual tabs changes.
 * - A newly visible tab is activated (Edit Tools always; layer tabs only from a neutral or contextual tab).
 * - An active contextual tab that disappears reverts to the tab that was active before it.
 */
export function reconcileRibbonTabs(
  state: RibbonTabState,
  previousVisible: readonly ContextualTab[],
  nextVisible: readonly ContextualTab[],
): RibbonTabState {
  const appeared = CONTEXTUAL_TABS.filter((tab) => nextVisible.includes(tab) && !previousVisible.includes(tab))
  const candidate = appeared[0]
  const from = state.activeTab
  const fromContextual = isContextualTab(from)

  if (candidate && candidate !== from &&
    (candidate === 'EditSession' || fromContextual || NEUTRAL_TABS.has(from))) {
    // Remember where to come back to; if the tab we leave is itself going away, keep its own return target.
    const returnTab = isAvailable(from, nextVisible) ? from
      : isAvailable(state.returnTab, nextVisible) ? state.returnTab : 'Map'
    return { activeTab: candidate, returnTab }
  }

  if (fromContextual && !nextVisible.includes(from)) {
    const activeTab = isAvailable(state.returnTab, nextVisible) && state.returnTab !== from ? state.returnTab : 'Map'
    return { activeTab, returnTab: 'Map' }
  }

  return state
}
