import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../geo'
import type { LayoutDocument } from '../layout/layoutStore'
import { buildTemplate } from '../layout/templates'
import { buildProject, parseProject } from '../project'
import type { AnalysisRecord } from '../store'
import { defaultWorkspaceLayout } from '../workspaceLayout'

function sampleLayer() {
  const layer = createMapLayer('Buildings', {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'b1', properties: { h: 12 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
  })
  layer.extrusion = { field: 'h', multiplier: 2 }
  return layer
}

const record: AnalysisRecord = {
  id: 'r1', toolId: 'buffer', toolName: 'Buffer', startedAt: '2026-11-15T10:00:00.000Z', durationMs: 42, status: 'succeeded',
  message: 'Created 1 buffer.', parameters: { target: 'x', distance: 100 }, summary: 'Input: Buildings · Distance: 100',
  selectedOnly: true, outputLayerNames: ['Buildings_Buffer'],
}

describe('project persistence of analysis, table and 3D state', () => {
  it('round-trips history, table views, scene settings, extrusion and a title-block layout on Letter paper', () => {
    const layer = sampleLayer()
    const layout: LayoutDocument = { paper: 'Letter', orientation: 'portrait', elements: buildTemplate('side-panel', 'Letter', 'portrait') }
    const project = buildProject({
      name: 'Persistence', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [layer], layout,
      workspaceLayout: defaultWorkspaceLayout(),
      scene: { terrain: 'layer', terrainLayerId: layer.id, exaggeration: 2.5, hillshade: false },
      analysisHistory: [record],
      tableViews: { [layer.id]: { sort: { field: 'h', direction: -1 }, filters: { h: '>10' } }, gone: { sort: null, filters: { a: 'b' } } },
    })
    const restored = parseProject(JSON.stringify(project), { paper: 'A4', orientation: 'landscape', elements: [] })

    expect(restored.analysisHistory).toEqual([record])
    expect(restored.tableViews).toEqual({ [layer.id]: { sort: { field: 'h', direction: -1 }, filters: { h: '>10' } } })
    expect(restored.map.scene).toEqual({ terrain: 'layer', terrainLayerId: layer.id, exaggeration: 2.5, hillshade: false })
    expect(restored.layers[0].extrusion).toEqual({ field: 'h', multiplier: 2 })
    expect(restored.layout.paper).toBe('Letter')
    const block = restored.layout.elements.find((element) => element.type === 'titleblock')
    expect(block && block.type === 'titleblock' && block.fields.some((field) => field.value === '{date}')).toBe(true)
  })

  it('opens older projects without the new sections using safe defaults', () => {
    const legacy = {
      format: 'arcweb-project', version: 1, name: 'Old', map: { basemap: 'osm', displayCrs: 'EPSG:4326' },
      layers: [{ id: 'L', name: 'Old layer', data: { type: 'FeatureCollection', features: [] } }],
      layout: { paper: 'A3', orientation: 'portrait', elements: [] },
    }
    const restored = parseProject(JSON.stringify(legacy), { paper: 'A4', orientation: 'landscape', elements: [] })
    expect(restored.analysisHistory).toEqual([])
    expect(restored.tableViews).toEqual({})
    expect(restored.map.scene).toMatchObject({ terrain: 'none', exaggeration: 1.5 })
    expect(restored.layers[0]).not.toHaveProperty('extrusion')
  })

  it('sanitises malformed new sections instead of failing', () => {
    const layer = sampleLayer()
    const project = JSON.parse(JSON.stringify(buildProject({
      name: 'Bad', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [layer],
      layout: { paper: 'A4', orientation: 'landscape', elements: [] }, workspaceLayout: defaultWorkspaceLayout(),
    })))
    project.map.scene = { terrain: 'mars', exaggeration: 99 }
    project.analysisHistory = [{ toolName: 'No id' }, record, 'junk']
    project.tableViews = { [layer.id]: { sort: { field: 'h', direction: 7 }, filters: { h: 3, name: 'x' } } }
    project.layers[0].extrusion = { field: '', multiplier: 'tall' }
    project.layout.elements = [{ type: 'titleblock', x: 1, y: 1, w: 50, h: 30, fields: [{ label: 'A' }, 'bad'] }]
    const restored = parseProject(JSON.stringify(project), { paper: 'A4', orientation: 'landscape', elements: [] })
    expect(restored.map.scene).toMatchObject({ terrain: 'none', exaggeration: 5 })
    expect(restored.analysisHistory.map((item) => item.id)).toEqual(['r1'])
    expect(restored.tableViews[layer.id]).toEqual({ sort: null, filters: { name: 'x' } })
    expect(restored.layers[0].extrusion).toBeUndefined()
    expect(restored.layout.elements[0]).toMatchObject({ type: 'titleblock', title: 'Map Title', fields: [{ label: 'A', value: '' }], frame: true })
  })
})

// Scale limits are project data, not interface preferences.
describe('layer scale ranges', () => {
  const load = (minScale?: number, maxScale?: number) => {
    const layer = { ...sampleLayer(), minScale, maxScale }
    return parseProject(JSON.stringify(buildProject({ name: 'Scales', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [layer], layout: { paper: 'A4', orientation: 'landscape', elements: [] }, workspaceLayout: defaultWorkspaceLayout() })), { paper: 'A4', orientation: 'landscape', elements: [] }).layers[0]
  }
  it('round-trips both denominators', () => {
    expect(load(500000, 1000)).toMatchObject({ minScale: 500000, maxScale: 1000 })
  })
  it('drops contradictory and equal bounds', () => {
    expect(load(1000, 500000)).not.toHaveProperty('minScale')
    expect(load(1000, 1000)).not.toHaveProperty('maxScale')
  })
  it('clamps finite values and ignores invalid numbers', () => {
    expect(load(1e12, -10)).toMatchObject({ minScale: 1e9, maxScale: 1 })
    expect(load(NaN, Infinity)).not.toHaveProperty('minScale')
  })
})
