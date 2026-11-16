export type WorkspacePreset = 'standard' | 'analysis' | 'cartography'
export type WorkspacePanelId = 'contents' | 'geoprocessing' | 'attributeTable' | 'symbology'

export interface PanelFrame {
  left: number
  top: number
  width: number
  height: number
}

export interface WorkspacePanelState {
  floating: boolean
  frame: PanelFrame
}

export interface WorkspaceLayoutConfig {
  preset: WorkspacePreset
  fullCanvas: boolean
  contentsMinimized: boolean
  rightPaneOpen: boolean
  tableMinimized: boolean
  panels: Record<WorkspacePanelId, WorkspacePanelState>
}

const defaultPanels: Record<WorkspacePanelId, WorkspacePanelState> = {
  contents: { floating: false, frame: { left: 270, top: 115, width: 300, height: 520 } },
  geoprocessing: { floating: false, frame: { left: 850, top: 115, width: 380, height: 620 } },
  attributeTable: { floating: false, frame: { left: 220, top: 350, width: 900, height: 320 } },
  symbology: { floating: false, frame: { left: 850, top: 115, width: 350, height: 620 } },
}

export function defaultWorkspaceLayout(): WorkspaceLayoutConfig {
  return {
    preset: 'standard',
    fullCanvas: false,
    contentsMinimized: false,
    rightPaneOpen: true,
    tableMinimized: false,
    panels: {
      contents: { floating: false, frame: { ...defaultPanels.contents.frame } },
      geoprocessing: { floating: false, frame: { ...defaultPanels.geoprocessing.frame } },
      attributeTable: { floating: false, frame: { ...defaultPanels.attributeTable.frame } },
      symbology: { floating: false, frame: { ...defaultPanels.symbology.frame } },
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayoutConfig {
  const defaults = defaultWorkspaceLayout()
  if (!isRecord(value)) return defaults

  const panels = isRecord(value.panels) ? value.panels : {}
  const normalizedPanels = { ...defaults.panels }
  for (const id of Object.keys(defaults.panels) as WorkspacePanelId[]) {
    const saved = panels[id]
    if (!isRecord(saved)) continue
    const frame = isRecord(saved.frame) ? saved.frame : {}
    normalizedPanels[id] = {
      floating: saved.floating === true,
      frame: {
        left: boundedNumber(frame.left, defaults.panels[id].frame.left, 0, 10000),
        top: boundedNumber(frame.top, defaults.panels[id].frame.top, 0, 10000),
        width: boundedNumber(frame.width, defaults.panels[id].frame.width, 220, 1800),
        height: boundedNumber(frame.height, defaults.panels[id].frame.height, 160, 1400),
      },
    }
  }

  return {
    preset: value.preset === 'analysis' || value.preset === 'cartography' ? value.preset : 'standard',
    fullCanvas: value.fullCanvas === true,
    contentsMinimized: value.contentsMinimized === true,
    rightPaneOpen: value.rightPaneOpen !== false,
    tableMinimized: value.tableMinimized === true,
    panels: normalizedPanels,
  }
}

export function applyWorkspacePreset(
  current: WorkspaceLayoutConfig,
  preset: WorkspacePreset,
): WorkspaceLayoutConfig {
  const layout = normalizeWorkspaceLayout(current)
  const panels = { ...layout.panels }
  for (const id of Object.keys(panels) as WorkspacePanelId[]) {
    panels[id] = { ...panels[id], floating: false }
  }

  if (preset === 'analysis') {
    panels.geoprocessing.frame.width = 390
    return {
      ...layout,
      preset,
      fullCanvas: false,
      contentsMinimized: true,
      rightPaneOpen: true,
      tableMinimized: false,
      panels,
    }
  }

  if (preset === 'cartography') {
    return {
      ...layout,
      preset,
      fullCanvas: false,
      contentsMinimized: true,
      rightPaneOpen: false,
      tableMinimized: true,
      panels,
    }
  }

  return {
    ...layout,
    preset,
    fullCanvas: false,
    contentsMinimized: false,
    rightPaneOpen: true,
    tableMinimized: false,
    panels,
  }
}
