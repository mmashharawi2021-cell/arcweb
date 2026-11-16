import { describe, expect, it } from 'vitest'
import { createMapLayer } from './geo'
import { buildProject, parseProject } from './project'
import type { LayoutDocument } from './layout/layoutStore'
import { applyWorkspacePreset, defaultWorkspaceLayout } from './workspaceLayout'

describe('project field aliases', () => {
  it('preserves aliases when a project is serialized and reopened', () => {
    const layer = createMapLayer('Places', {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { NAME: 'Central Library' },
        geometry: { type: 'Point', coordinates: [-73.9, 40.7] },
      }],
    })
    layer.fieldAliases = { NAME: 'Place name' }
    const layout: LayoutDocument = { paper: 'A4', orientation: 'landscape', elements: [] }
    const project = buildProject({
      name: 'Field aliases',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [layer],
      layout,
      workspaceLayout: applyWorkspacePreset(defaultWorkspaceLayout(), 'analysis'),
    })

    const restored = parseProject(JSON.stringify(project), layout)
    expect(restored.layers[0].fieldAliases).toEqual({ NAME: 'Place name' })
    expect(restored.workspaceLayout.preset).toBe('analysis')
    expect(restored.workspaceLayout.contentsMinimized).toBe(true)
    expect(restored.workspaceLayout.panels.geoprocessing.frame.width).toBe(390)
  })

  it('uses the standard workspace when opening a project without docking settings', () => {
    const layout: LayoutDocument = { paper: 'A4', orientation: 'landscape', elements: [] }
    const project = buildProject({
      name: 'Legacy project',
      basemap: 'osm',
      displayCrs: 'EPSG:4326',
      camera: null,
      bookmarks: [],
      layers: [],
      layout,
      workspaceLayout: defaultWorkspaceLayout(),
    })
    const legacy = { ...project, workspaceLayout: undefined }

    expect(parseProject(JSON.stringify(legacy), layout).workspaceLayout.preset).toBe('standard')
  })
})
