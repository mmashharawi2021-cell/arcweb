import { describe, expect, it } from 'vitest'
import { createRasterGrid, rasterFromFeatureCollection, rasterToFeatureCollection } from '../../../rasterEngine'
import { testLayer, runTool } from '../../testUtils'
import { isoClusterTool } from '../isoCluster'
import { majorityFilterTool } from '../majorityFilter'
import { polygonToRasterTool } from '../polygonToRaster'
import { rasterToPolygonTool } from '../rasterToPolygon'
import { spectralIndicesTool } from '../spectralIndices'

function rasterLayer(name: string, values: number[], width = 3, height = 1) {
  const grid = createRasterGrid(width, height, values, {
    origin: [0, height], resolution: [1, -1], crs: 'EPSG:4326',
  })
  return testLayer(name, rasterToFeatureCollection(grid))
}

function rasterValues(layer: { data: { features: { properties?: Record<string, unknown> | null }[] } }) {
  return rasterFromFeatureCollection(layer.data).values
}

describe('Image Analyst tools', () => {
  it('calculates NDVI from two separate raster bands', async () => {
    const nir = rasterLayer('NIR', [0.8, 0.6, 0], 3)
    const red = rasterLayer('Red', [0.2, 0.2, 0], 3)
    const result = await runTool(spectralIndicesTool, [nir, red], {
      index: 'NDVI', bandRasters: `${nir.id},${red.id}`,
    })
    expect(rasterValues(result.layers![0])[0]).toBeCloseTo(0.6)
    expect(rasterValues(result.layers![0])[1]).toBeCloseTo(0.5)
    expect(Number.isNaN(rasterValues(result.layers![0])[2])).toBe(true)
  })

  it('uses the correct Green/NIR and SWIR/NIR spectral index formulas', async () => {
    const green = rasterLayer('Green', [0.3], 1)
    const nir = rasterLayer('NIR', [0.7], 1)
    const swir = rasterLayer('SWIR', [0.4], 1)
    const ndwi = await runTool(spectralIndicesTool, [green, nir], {
      index: 'NDWI', bandRasters: `${green.id},${nir.id}`,
    })
    const ndbi = await runTool(spectralIndicesTool, [swir, nir], {
      index: 'NDBI', bandRasters: `${swir.id},${nir.id}`,
    })
    expect(rasterValues(ndwi.layers![0])[0]).toBeCloseTo(-0.4)
    expect(rasterValues(ndbi.layers![0])[0]).toBeCloseTo(-0.3 / 1.1)
  })

  it('reads selected samples from a synthetic multi-band GeoTIFF', async () => {
    const { writeArrayBuffer } = await import('geotiff')
    const bytes = writeArrayBuffer([
      [[8, 6]],
      [[2, 2]],
    ], {
      width: 2, height: 1, ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 10, 20, 0], GeographicTypeGeoKey: 4326,
    })
    const result = await runTool(spectralIndicesTool, [], {
      index: 'NDVI',
      file: new File([bytes], 'synthetic-multiband.tif'),
      nirBand: 1,
      redBand: 2,
    })
    expect(rasterValues(result.layers![0])[0]).toBeCloseTo(0.6)
    expect(rasterValues(result.layers![0])[1]).toBeCloseTo(0.5)
  })

  it('classifies synthetic raster samples deterministically with K-means', async () => {
    const bandA = rasterLayer('Band A', [0, 0.1, 9.9, 10], 4)
    const bandB = rasterLayer('Band B', [1, 1.1, 10.9, 11], 4)
    const parameters = { bandRasters: `${bandA.id},${bandB.id}`, classes: 2, iterations: 20 }
    const first = await runTool(isoClusterTool, [bandA, bandB], parameters)
    const second = await runTool(isoClusterTool, [bandA, bandB], parameters)
    const firstValues = [...rasterValues(first.layers![0])]
    expect(firstValues).toEqual([...rasterValues(second.layers![0])])
    expect(firstValues[0]).toBe(firstValues[1])
    expect(firstValues[2]).toBe(firstValues[3])
    expect(firstValues[0]).not.toBe(firstValues[2])
  })

  it('filters a categorical raster and rasterizes polygon values', async () => {
    const categories = rasterLayer('Categories', [1, 1, 1, 1, 2, 1, 1, 1, 1], 3, 3)
    const filtered = await runTool(majorityFilterTool, [categories], { raster: categories.id })
    expect(rasterValues(filtered.layers![0])[4]).toBe(1)

    const polygons = testLayer('Values', [{
      type: 'Feature', properties: { code: 8 }, geometry: {
        type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      },
    }])
    const rasterized = await runTool(polygonToRasterTool, [polygons], {
      polygons: polygons.id, valueField: 'code', cellSize: 1,
    })
    expect([...rasterValues(rasterized.layers![0])]).toEqual([8, 8, 8, 8])
  })

  it('converts contiguous values into clean polygons with holes', async () => {
    const raster = rasterLayer('Ring cells', [1, 1, 1, 1, Number.NaN, 1, 1, 1, 1], 3, 3)
    const result = await runTool(rasterToPolygonTool, [raster], { raster: raster.id })
    const feature = result.layers![0].data.features[0]
    expect(result.layers![0].data.features).toHaveLength(1)
    expect(feature.geometry?.type).toBe('Polygon')
    if (feature.geometry?.type !== 'Polygon') throw new Error('Expected polygon output.')
    expect(feature.geometry.coordinates).toHaveLength(2)
    for (const ring of feature.geometry.coordinates) {
      expect(ring.length).toBeGreaterThanOrEqual(4)
      expect(ring[0]).toEqual(ring[ring.length - 1])
    }
    expect(feature.properties).toMatchObject({ value: 1, cellCount: 8 })
  })
})
