import type { PanelFrame, WorkspaceLayoutConfig, WorkspacePreset } from '../workspaceLayout'
export const PANE_IDS = ['contents', 'catalog', 'geoprocessing', 'symbology', 'createFeatures', 'modifyFeatures', 'attributes'] as const
export type PaneId = typeof PANE_IDS[number]
export type DockSide = 'left' | 'right' | 'float'
export interface PaneState { open: boolean; side: DockSide; autoHide: boolean; frame: PanelFrame; order: number }
export interface PaneLayout { panes: Record<PaneId, PaneState>; active: { left: PaneId | null; right: PaneId | null }; dockWidth: { left: number; right: number } }
export function defaultPaneLayout(): PaneLayout {
  return { panes: Object.fromEntries(PANE_IDS.map((id, order) => [id, { open: ['contents', 'catalog', 'geoprocessing', 'symbology'].includes(id), side: id === 'contents' ? 'left' : 'right', autoHide: false, order, frame: { left: 500, top: 150, width: 350, height: 550 } }])) as PaneLayout['panes'], active: { left: 'contents', right: 'catalog' }, dockWidth: { left: 255, right: 320 } }
}
function reconcile(layout: PaneLayout): PaneLayout {
  const active = { ...layout.active }
  for (const side of ['left', 'right'] as const) {
    const current = active[side]
    if (!current || !layout.panes[current].open || layout.panes[current].side !== side) active[side] = PANE_IDS.filter(id => layout.panes[id].open && layout.panes[id].side === side).sort((a,b) => layout.panes[a].order-layout.panes[b].order)[0] ?? null
  }
  return { ...layout, active }
}
export function openPane(layout: PaneLayout, id: PaneId, options: { side?: DockSide } = {}): PaneLayout {
  const side = options.side ?? layout.panes[id].side
  return reconcile({ ...layout, panes: { ...layout.panes, [id]: { ...layout.panes[id], open: true, side } }, active: { ...layout.active, ...(side !== 'float' ? { [side]: id } : {}) } })
}
export const activatePane = openPane
export function closePane(layout: PaneLayout, id: PaneId): PaneLayout { return reconcile({ ...layout, panes: { ...layout.panes, [id]: { ...layout.panes[id], open: false } } }) }
export function movePane(layout: PaneLayout, id: PaneId, side: DockSide): PaneLayout { return openPane(layout, id, { side }) }
export function toggleAutoHide(layout: PaneLayout, id: PaneId): PaneLayout { return { ...layout, panes: { ...layout.panes, [id]: { ...layout.panes[id], autoHide: !layout.panes[id].autoHide } } } }
export function normalizePaneLayout(value: unknown): PaneLayout {
  const defaults = defaultPaneLayout()
  if (!value || typeof value !== 'object') return defaults
  const raw = value as Partial<PaneLayout>
  const finite = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
  for (const id of PANE_IDS) {
    const p = raw.panes?.[id]
    if (!p || typeof p !== 'object') continue
    defaults.panes[id] = { open: p.open !== false, side: ['left','right','float'].includes(p.side) ? p.side : defaults.panes[id].side, autoHide: p.autoHide === true, order: finite(p.order, defaults.panes[id].order,0,100), frame: { left: finite(p.frame?.left,500,0,10000), top: finite(p.frame?.top,150,0,10000), width: finite(p.frame?.width,350,220,1800), height: finite(p.frame?.height,550,160,1400) } }
  }
  for (const side of ['left','right'] as const) { const id = raw.active?.[side]; defaults.active[side] = id && PANE_IDS.includes(id) ? id : null; defaults.dockWidth[side] = finite(raw.dockWidth?.[side],defaults.dockWidth[side],220,600) }
  return reconcile(defaults)
}
export function migrateWorkspaceLayout(old: WorkspaceLayoutConfig): PaneLayout {
  const layout = defaultPaneLayout()
  layout.panes.contents.autoHide = old.contentsMinimized
  for (const id of ['contents','geoprocessing','symbology'] as const) { layout.panes[id].frame = { ...old.panels[id].frame }; if (old.panels[id].floating) layout.panes[id].side = 'float' }
  if (!old.rightPaneOpen) for (const id of PANE_IDS.filter(id => id !== 'contents')) layout.panes[id].open = false
  layout.active.right = old.rightPaneOpen ? old.preset === 'analysis' ? 'geoprocessing' : 'symbology' : null
  return reconcile(layout)
}
export function applyPanePreset(layout: PaneLayout, preset: WorkspacePreset): PaneLayout {
  let next = defaultPaneLayout()
  next.dockWidth = { ...layout.dockWidth }
  if (preset === 'analysis') { next = openPane(next,'geoprocessing'); next.panes.contents.autoHide = true }
  if (preset === 'cartography') { next = openPane(next,'symbology'); next.panes.contents.autoHide = true }
  return next
}
export function loadPaneLayout(): PaneLayout {
  try { const saved = localStorage.getItem('arcweb-workspace-layout-v2'); if (saved) return normalizePaneLayout(JSON.parse(saved)) } catch { /* defaults */ }
  return defaultPaneLayout()
}
