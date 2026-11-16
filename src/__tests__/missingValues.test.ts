import { describe, expect, it } from 'vitest'
import { createMapLayer } from '../geo'
import { finiteNumber } from '../numbers'
import { createRasterGrid, isNoData, rasterFromFeatureCollection, rasterToFeatureCollection } from '../rasterEngine'
import { buildGraduatedRenderer, getGraduatedClassCounts } from '../symbology'

describe('missing numeric values', () => {
  it('finiteNumber', () => {
    expect([0, '5', ' ', null, true, NaN, '1e3'].map(finiteNumber)).toEqual([0, 5, null, null, null, null, 1000])
  })

  it('treats a null raster value as NoData, not 0', () => {
    const grid = createRasterGrid(2, 1, [5, 7], { origin: [0, 1], resolution: [1, -1], crs: 'EPSG:4326' })
    const collection = rasterToFeatureCollection(grid)
    const nullable = collection.features[0].properties as Record<string, unknown>
    nullable.value = null
    const rebuilt = rasterFromFeatureCollection(collection)
    expect(isNoData(rebuilt.values[0], rebuilt.noData)).toBe(true)
    expect(rebuilt.values[1]).toBe(7)
  })

  it('graduated breaks and counts ignore null and blank values', () => {
    const features = [null, '', 10, 20, 30].map((value, index) => ({
      type: 'Feature' as const, properties: { value }, geometry: { type: 'Point' as const, coordinates: [index, 0] },
    }))
    const layer = createMapLayer('Pts', { type: 'FeatureCollection', features })
    const renderer = buildGraduatedRenderer(layer, 'value', 'equal-interval', 3, 'viridis')
    expect(renderer.breaks.every((item) => item > 0)).toBe(true)
    expect(getGraduatedClassCounts(layer, renderer).reduce((sum, count) => sum + count, 0)).toBe(3)
  })
})
