import { describe, expect, it } from 'vitest'
import { bufferTool } from '../analysis/buffer'
import { tabulateIntersectionTool } from '../analysis/tabulateIntersection'
import { alterFieldTool } from '../dataManagement/alterField'
import { findIdenticalTool } from '../dataManagement/findIdentical'
import { deleteIdenticalTool } from '../dataManagement/deleteIdentical'
import { featuresToGeoJsonTool } from '../conversion/featuresToGeoJson'
import { xyTableToPointTool } from '../conversion/xyTableToPoint'
import { runTool, testLayer } from '../testUtils'

const point = { type: 'Feature' as const, properties: { '\u0633\u0643\u0627\u0646': 10 }, geometry: { type: 'Point' as const, coordinates: [35, 31] } }

describe('bidi isolation at tool display boundaries', () => {
  it.each([
    { tool: findIdenticalTool, expected: '\u2068Stations Identical\u2069: 1 sets of identical records (Shape, \u2068\u0633\u0643\u0627\u0646\u2069).' },
    { tool: deleteIdenticalTool, expected: '\u2068Stations\u2069: deleted 1 identical records (Shape, \u2068\u0633\u0643\u0627\u0646\u2069); 1 remain.' },
  ])('keeps the fixed Shape keyword unwrapped in $tool.name', async ({ tool, expected }) => {
    const input = testLayer('Stations', [point, point])
    const result = await runTool(tool, [input], { target: input.id, fields: 'Shape, \u0633\u0643\u0627\u0646' })
    expect(result.message).toBe(expected)
  })

  it('keeps generated measurement labels unwrapped in tabulation feedback', async () => {
    const zones = testLayer('Zones', [{ type: 'Feature', properties: { zone: 'A' }, geometry: {
      type: 'Polygon', coordinates: [[[34, 30], [36, 30], [36, 32], [34, 32], [34, 30]]],
    } }])
    const points = testLayer('Points', [point])
    const result = await runTool(tabulateIntersectionTool, [zones, points], { zones: zones.id, zoneField: 'zone', classes: points.id })
    expect(result.message).toBe('\u2068Zones TabulateIntersection\u2069: 1 zone/class rows (PNT_COUNT).')
  })

  it('isolates the output layer name in Buffer feedback without changing output data', async () => {
    const input = testLayer('\u0645\u062d\u0637\u0627\u062a 7', [point])
    const result = await runTool(bufferTool, [input], { target: input.id, distance: 5 })
    expect(result.message).toBe('\u2068\u0645\u062d\u0637\u0627\u062a 7 Buffer\u2069: created 1 buffer polygons.')
    expect(result.layers![0].name).toBe('\u0645\u062d\u0637\u0627\u062a 7 Buffer')
    expect(result.layers![0].data.features[0].properties?.['\u0633\u0643\u0627\u0646']).toBe(10)
  })

  it('isolates renamed field names only in feedback, preserving raw property keys', async () => {
    const input = testLayer('Stations', [point])
    const result = await runTool(alterFieldTool, [input], { target: input.id, field: '\u0633\u0643\u0627\u0646', newName: '\u0627\u0644\u0633\u0643\u0627\u0646' })
    expect(result.message).toBe('Renamed "\u2068\u0633\u0643\u0627\u0646\u2069" to "\u2068\u0627\u0644\u0633\u0643\u0627\u0646\u2069".')
    expect(result.updates![0].updates.data!.features[0].properties).toEqual({ '\u0627\u0644\u0633\u0643\u0627\u0646': 10 })
  })

  it('isolates missing field and layer names in thrown errors', async () => {
    const input = testLayer('\u0645\u062d\u0637\u0627\u062a', [point])
    await expect(runTool(alterFieldTool, [input], { target: input.id, field: '\u0645\u0641\u0642\u0648\u062f', newName: 'next' }))
      .rejects.toThrow('Field "\u2068\u0645\u0641\u0642\u0648\u062f\u2069" was not found in \u2068\u0645\u062d\u0637\u0627\u062a\u2069.')
  })

  it('isolates XY field-list entries independently while keeping fixed axis labels unchanged', async () => {
    const input = testLayer('Table', [point])
    await expect(runTool(xyTableToPointTool, [input], { table: input.id, xField: '\u0634\u0631\u0642', yField: 'lat' }))
      .rejects.toThrow('The X field "\u2068\u0634\u0631\u0642\u2069" was not found. Available fields: \u2068\u0633\u0643\u0627\u0646\u2069.')
  })

  it('isolates exported file names in feedback, leaving file names and downloaded properties untouched', async () => {
    const input = testLayer('\u0645\u062d\u0637\u0627\u062a', [point])
    const result = await runTool(featuresToGeoJsonTool, [input], { target: input.id })
    expect(result.message).toBe('Prepared \u2068\u0645\u062d\u0637\u0627\u062a.geojson\u2069 (1 features).')
    expect(result.downloads![0].fileName).toBe('\u0645\u062d\u0637\u0627\u062a.geojson')
    const downloaded = JSON.parse(await result.downloads![0].blob.text())
    expect(downloaded.features[0].properties).toEqual({ '\u0633\u0643\u0627\u0646': 10 })
  })
})
