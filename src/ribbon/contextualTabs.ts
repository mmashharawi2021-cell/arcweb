import type { FeatureCollection } from 'geojson'
import type { AppTab, ContextualTab, CoreTab, MapLayer, ToolMode, ViewMode } from '../store'

/** Permanent tabs and contextual groups, in display order. */
export const CORE_TABS: readonly CoreTab[] = ['Map', 'Insert', 'Analysis', 'Edit', 'View', 'Share']
export const CONTEXTUAL_GROUPS: { id: 'feature' | 'raster' | 'layout'; label: string; tabs: ContextualTab[] }[] = [
  { id: 'feature', label: 'Feature Layer', tabs: ['FeatureAppearance', 'FeatureLabeling', 'FeatureData'] },
  { id: 'raster', label: 'Raster Layer', tabs: ['RasterAppearance', 'RasterData'] },
  { id: 'layout', label: 'Layout', tabs: ['LayoutInsert', 'LayoutExport'] },
]
export const CONTEXTUAL_TABS = CONTEXTUAL_GROUPS.flatMap(group => group.tabs)
export const CONTEXTUAL_TAB_META = Object.fromEntries(CONTEXTUAL_GROUPS.flatMap(group => group.tabs.map(tab => [tab, {
  group: group.label, label: tab.replace(/^(Feature|Raster|Layout)/, ''),
}]))) as Record<ContextualTab, { group: string; label: string }>

/** Old session tab ids are accepted at the store boundary. Unknown ids return to Map. */
export function migrateTabId(id: string): AppTab {
  const legacy: Record<string, AppTab> = { FeatureLayer: 'FeatureAppearance', RasterLayer: 'RasterAppearance', EditSession: 'Edit', Layout: 'Map' }
  return legacy[id] ?? ([...CORE_TABS, ...CONTEXTUAL_TABS].includes(id as AppTab) ? id as AppTab : 'Map')
}

const NEUTRAL_TABS: ReadonlySet<AppTab> = new Set<AppTab>(['Map', 'Insert', 'View'])

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
  viewMode: ViewMode
}

export function getVisibleContextualTabs({ selectedLayer, viewMode }: RibbonContext): ContextualTab[] {
  const visible: ContextualTab[] = []
  // Standalone tables (no geometry) get no appearance tab.
  if (selectedLayer && selectedLayer.geometry !== 'Unknown') {
    visible.push(...CONTEXTUAL_GROUPS[isRasterLayer(selectedLayer) ? 1 : 0].tabs)
  }
  if (viewMode === 'layout') visible.push('LayoutInsert', 'LayoutExport')
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
 * - A newly visible tab is activated (only from a neutral or contextual tab).
 * - An active contextual tab that disappears reverts to the tab that was active before it.
 */
export function reconcileRibbonTabs(
  state: RibbonTabState,
  previousVisible: readonly ContextualTab[],
  nextVisible: readonly ContextualTab[],
): RibbonTabState {
  const appeared = CONTEXTUAL_TABS.filter((tab) => nextVisible.includes(tab) && !previousVisible.includes(tab))
  const fromKind = CONTEXTUAL_TAB_META[state.activeTab as ContextualTab]?.label
  const candidate = appeared.find(tab => CONTEXTUAL_TAB_META[tab].label === fromKind) ?? appeared[0]
  const from = state.activeTab
  const fromContextual = isContextualTab(from)

  if (candidate && candidate !== from &&
    (fromContextual || NEUTRAL_TABS.has(from))) {
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
