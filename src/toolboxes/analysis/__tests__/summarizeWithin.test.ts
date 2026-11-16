import type { Feature, Geometry, Polygon, Point } from 'geojson'
import { describe, expect, it } from 'vitest'
import { runTool, testLayer } from '../../testUtils'
import { summarizeWithinTool } from '../summarizeWithin'

const zone = (x1: number, x2: number): Feature<Polygon> => ({
  type: 'Feature', properties: { zone: x1 },
  geometry: { type: 'Polygon', coordinates: [[[x1, 0], [x2, 0], [x2, 1], [x1, 1], [x1, 0]]] },
})
const point = (x: number, properties: Record<string, unknown> = {}): Feature<Point> =>
  ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, 0.5] } })

describe('Summarize Within', () => {
  it('counts included features and calculates requested numeric statistics per zone', async () => {
    const zones = testLayer('zones', [zone(0, 1), zone(1, 2)] as Feature<Geometry>[])
    const population = testLayer('population', [point(0.25, { POP: 10 }), point(0.75, { POP: 20 }), point(1.75, { POP: 5 })] as Feature<Geometry>[])
    const result = await runTool(summarizeWithinTool, [zones, population], {
      zones: zones.id, summary: population.id, statistics: 'POP SUM, POP MEAN, POP COUNT',
    })
    expect(result.layers?.[0].data.features.map((feature) => feature.properties)).toEqual([
      { zone: 0, FEATURE_COUNT: 2, SUM_POP: 30, MEAN_POP: 15, COUNT_POP: 2 },
      { zone: 1, FEATURE_COUNT: 1, SUM_POP: 5, MEAN_POP: 5, COUNT_POP: 1 },
    ])
    expect(result.layers?.[0].customFields).toContain('SUM_POP')
  })

  it('keeps empty zones with zero count and rejects non-polygon zone layers', async () => {
    const zones = testLayer('zones', [zone(0, 1)] as Feature<Geometry>[])
    const points = testLayer('points', [point(5, { POP: 1 })] as Feature<Geometry>[])
    const result = await runTool(summarizeWithinTool, [zones, points], { zones: zones.id, summary: points.id })
    expect(result.layers?.[0].data.features[0].properties).toMatchObject({ FEATURE_COUNT: 0 })
    const nonPolygons = testLayer('not zones', [point(0)] as Feature<Geometry>[])
    await expect(runTool(summarizeWithinTool, [nonPolygons, points], { zones: nonPolygons.id, summary: points.id })).rejects.toThrow(/polygon/)
    await expect(runTool(summarizeWithinTool, [zones, points], { zones: zones.id, summary: points.id, statistics: 'POP MEDIAN' })).rejects.toThrow(/statistics/i)
  })
})
