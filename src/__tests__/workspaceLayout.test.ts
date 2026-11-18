import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../geo'
import { buildProject, parseProject } from '../project'
import type { LayoutDocument } from '../layout/layoutStore'
import { applyWorkspacePreset, defaultWorkspaceLayout, normalizeWorkspaceLayout } from '../workspaceLayout'

describe('workspace layout presets', () => {
  it('configures Analysis Focus with minimized Contents and an expanded Geoprocessing pane', () => {
    const floating = defaultWorkspaceLayout()
    floating.panels.contents.floating = true
    const analysis = applyWorkspacePreset(floating, 'analysis')

    expect(analysis.contentsMinimized).toBe(true)
    expect(analysis.rightPaneOpen).toBe(true)
    expect(analysis.panels.geoprocessing.frame.width).toBeGreaterThan(300)
    expect(Object.values(analysis.panels).every((panel) => !panel.floating)).toBe(true)
  })

  it('maximizes the canvas in Cartography Focus and restores standard panel visibility', () => {
    const cartography = applyWorkspacePreset(defaultWorkspaceLayout(), 'cartography')
    expect(cartography.contentsMinimized).toBe(true)
    expect(cartography.rightPaneOpen).toBe(false)
    expect(cartography.tableMinimized).toBe(true)

    const standard = applyWorkspacePreset(cartography, 'standard')
    expect(standard.contentsMinimized).toBe(false)
    expect(standard.rightPaneOpen).toBe(true)
    expect(standard.tableMinimized).toBe(false)
  })

  it('normalizes invalid persisted panel geometry to safe bounds', () => {
    const layout = normalizeWorkspaceLayout({
      preset: 'unknown',
      panels: { contents: { floating: true, frame: { left: -40, top: 50, width: 10, height: 9000 } } },
    })
    expect(layout.preset).toBe('standard')
    expect(layout.panels.contents).toMatchObject({
      floating: true,
      frame: { left: 0, top: 50, width: 220, height: 1400 },
    })
    expect(layout.panels.geoprocessing.floating).toBe(false)
  })
})

describe('project workspace persistence', () => {
  const document: LayoutDocument = { paper: 'A4', orientation: 'landscape', elements: [] }

  function projectWith(workspaceLayout: ReturnType<typeof defaultWorkspaceLayout>) {
    return buildProject({
      name: 'Workspace layout',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [createMapLayer('Places', { type: 'FeatureCollection', features: [] })],
      layout: document,
      workspaceLayout,
    })
  }

  it('round-trips the active preset, floating flags, and panel geometry', () => {
    const workspaceLayout = defaultWorkspaceLayout()
    workspaceLayout.preset = 'analysis'
    workspaceLayout.panels.geoprocessing.floating = true
    workspaceLayout.panels.geoprocessing.frame = { left: 540, top: 82, width: 460, height: 700 }

    const project = parseProject(JSON.stringify(projectWith(workspaceLayout)), document)
    expect(project.workspaceLayout).toEqual(normalizeWorkspaceLayout(workspaceLayout))
  })

  it('defaults older project files without workspace settings to Standard Layout', () => {
    const project = projectWith(defaultWorkspaceLayout())
    const legacy = { ...project, workspaceLayout: undefined }
    expect(parseProject(JSON.stringify(legacy), document).workspaceLayout.preset).toBe('standard')
  })
})
