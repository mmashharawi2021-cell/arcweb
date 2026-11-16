import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { getCollectionBounds } from '../../geo'
import { buildProject, parseProject } from '../../project'
import { defaultWorkspaceLayout } from '../../workspaceLayout'
import { toolboxTools } from '../registry'
import { testLayer } from '../testUtils'
import type { ToolboxParameters } from '../types'

/**
 * Rows with a null geometry are real at runtime (standalone tables from Frequency, Summary
 * Statistics, Excel to Table…, or features Repair Geometry could not fix), but MapLayer's GeoJSON
 * typing does not model them, so the compiler cannot enforce null checks. These tests pin the
 * runtime behaviour instead.
 */
const square = (x: number): Feature => ({ type: 'Feature', properties: { name: `p${x}`, value: x, height: x * 3 }, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 0.01, 0], [x + 0.01, 0.01], [x, 0.01], [x, 0]]] } })
const point = (x: number): Feature => ({ type: 'Feature', properties: { name: `q${x}`, value: x }, geometry: { type: 'Point', coordinates: [x, 0.005] } })
const line = (x: number): Feature => ({ type: 'Feature', properties: { name: `l${x}`, value: x }, geometry: { type: 'LineString', coordinates: [[x, 0], [x + 0.01, 0.01]] } })
const tableRow = (i: number) => ({ type: 'Feature' as const, properties: { name: `row${i}`, value: i }, geometry: null })
const NULL_ACCESS = /of null|of undefined|null is not|is not a function|Cannot read/i

function mixedLayers() {
  return [
    testLayer('polygons', [square(0), tableRow(1), square(0.005), tableRow(2)]),
    testLayer('points', [point(0.002), tableRow(3), point(0.004)]),
    testLayer('lines', [line(0), tableRow(4)]),
  ]
}

describe('null-geometry rows (audit regression)', () => {
  it('no geoprocessing tool crashes on layers that mix features with null-geometry rows', async () => {
    const layers = mixedLayers()
    const crashes: string[] = []
    let completed = 0
    for (const tool of toolboxTools) {
      if (tool.parameters.some((parameter) => parameter.kind === 'file')) continue
      for (const layer of layers) {
        const values: ToolboxParameters = {}
        for (const parameter of tool.parameters) {
          if (parameter.kind === 'layer') values[parameter.id] = layer.id
          else if (parameter.kind === 'layers') values[parameter.id] = layers.map((item) => item.id).join(',')
          else if (parameter.kind === 'field') values[parameter.id] = 'value'
          else if ('defaultValue' in parameter && parameter.defaultValue !== undefined) values[parameter.id] = parameter.defaultValue
          else if (parameter.kind === 'number') values[parameter.id] = 10
        }
        try {
          await tool.execute({ layers, selectedLayerId: layer.id }, values)
          completed += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // Validation errors ("Choose a field…") are fine; a null dereference is not.
          if (NULL_ACCESS.test(message)) crashes.push(`${tool.id} [${layer.name}]: ${message}`)
        }
      }
    }
    expect(crashes).toEqual([])
    // Guard against a vacuous pass: many tools must actually process the mixed data.
    expect(completed).toBeGreaterThanOrEqual(100)
  }, 120_000)

  it('ignores null geometries when computing extents', () => {
    const [polygons] = mixedLayers()
    expect(getCollectionBounds([polygons.data])).toEqual([0, 0, 0.015, 0.01])
    expect(getCollectionBounds([testLayer('table', [tableRow(1)]).data])).toBeNull()
  })

  it('keeps null-geometry rows when a project is saved and reopened', () => {
    const table = testLayer('Frequency', [tableRow(1), tableRow(2)])
    const layout = { paper: 'A4' as const, orientation: 'landscape' as const, elements: [] }
    const project = buildProject({ name: 'Tables', basemap: 'osm', displayCrs: 'EPSG:4326', camera: null, bookmarks: [], layers: [table], layout, workspaceLayout: defaultWorkspaceLayout() })
    const restored = parseProject(JSON.stringify(project), layout)
    expect(restored.layers[0].geometry).toBe('Unknown')
    expect(restored.layers[0].data.features.map((feature) => [feature.properties?.name, feature.geometry])).toEqual([['row1', null], ['row2', null]])
  })
})
