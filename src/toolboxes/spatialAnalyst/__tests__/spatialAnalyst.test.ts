import { describe, expect, it } from 'vitest'
import { writeArrayBuffer } from 'geotiff'
import {
  aspectTool, contourTool, extractByMaskTool, fillTool, flowAccumulationTool, flowDirectionTool,
  hillshadeTool, idwTool, importGeoTiffTool, kernelDensityTool, rasterCalculatorTool, rasterFromFeatureCollection,
  rasterToFeatureCollection, reclassifyTool, slopeTool, tinInterpolationTool, zonalStatisticsTool,
} from '../index'
import { createRasterGrid } from '../../../rasterEngine'
import { testLayer, runTool } from '../../testUtils'

function rasterLayer(name: string, values: number[], width = 3, height = 3, crs = 'EPSG:4326') {
  const grid = createRasterGrid(width, height, values, { origin: [0, height], resolution: [1, -1], crs })
  return testLayer(name, rasterToFeatureCollection(grid))
}

function values(layer: { data: { features: { properties?: Record<string, unknown> | null }[] } }) {
  return rasterFromFeatureCollection(layer.data).values
}

describe('Spatial Analyst terrain tools', () => {
  it('calculates slope, aspect and shaded relief on a planar surface', async () => {
    const elevation = rasterLayer('Plane', [0, 1, 2, 0, 1, 2, 0, 1, 2], 3, 3, 'EPSG:3857')
    const slope = await runTool(slopeTool, [elevation], { raster: elevation.id })
    expect(values(slope.layers![0])[4]).toBeCloseTo(45, 1)
    const aspect = await runTool(aspectTool, [elevation], { raster: elevation.id })
    expect(values(aspect.layers![0])[4]).toBeCloseTo(270, 1)
    const shade = await runTool(hillshadeTool, [elevation], { raster: elevation.id, azimuth: 270, altitude: 45 })
    expect(values(shade.layers![0])[4]).toBeGreaterThan(0)
    expect(values(shade.layers![0])[4]).toBeLessThanOrEqual(255)
  })

  it('makes contour lines at an interval crossing cell values', async () => {
    const elevation = rasterLayer('Small', [0, 1, 0, 1], 2, 2)
    const result = await runTool(contourTool, [elevation], { raster: elevation.id, interval: 0.5 })
    expect(result.layers![0].data.features.length).toBeGreaterThan(0)
    expect(result.layers![0].data.features[0].geometry?.type).toBe('LineString')
    expect(() => contourTool.execute({ layers: [elevation], selectedLayerId: elevation.id }, { raster: elevation.id, interval: 0 })).toThrow(/greater than zero/)
  })
})

describe('Spatial Analyst interpolation and raster tools', () => {
  it('interpolates point values and calculates kernel density', async () => {
    const points = testLayer('Samples', [
      { type: 'Feature', properties: { value: 0 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { value: 10 }, geometry: { type: 'Point', coordinates: [0.02, 0] } },
    ])
    const idw = await runTool(idwTool, [points], { points: points.id, valueField: 'value', cellSize: 0.01 })
    expect(idw.layers![0].data.features.length).toBeGreaterThan(0)
    expect(values(idw.layers![0]).some((value) => value > 0 && value < 10)).toBe(true)
    const density = await runTool(kernelDensityTool, [points], { points: points.id, radius: 0.02, cellSize: 0.01 })
    expect(values(density.layers![0]).some((value) => value > 0)).toBe(true)
    expect(() => idwTool.execute({ layers: [points], selectedLayerId: points.id }, { points: points.id, valueField: 'missing' })).toThrow(/no point features/)
  })

  it('linearly interpolates within a Delaunay TIN hull and leaves exterior cells NoData', async () => {
    const points = testLayer('Triangle samples', [
      { type: 'Feature', properties: { value: 0 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { value: 2 }, geometry: { type: 'Point', coordinates: [2, 0] } },
      { type: 'Feature', properties: { value: 2 }, geometry: { type: 'Point', coordinates: [0, 2] } },
    ])
    const result = await runTool(tinInterpolationTool, [points], { points: points.id, valueField: 'value', cellSize: 1 })
    const interpolated = values(result.layers![0])
    expect(interpolated[0]).toBeCloseTo(2)
    expect(Number.isNaN(interpolated[1])).toBe(true)
    expect(interpolated[2]).toBeCloseTo(1)
    expect(interpolated[3]).toBeCloseTo(2)
  })

  it('evaluates aligned raster math without eval and rejects misaligned inputs', async () => {
    const a = rasterLayer('A', [1, 2, 3, 4], 2, 2)
    const b = rasterLayer('B', [10, 20, 30, 40], 2, 2)
    const result = await runTool(rasterCalculatorTool, [a, b], { rasterA: a.id, rasterB: b.id, expression: 'A * 2 + B' })
    expect([...values(result.layers![0])]).toEqual([12, 24, 36, 48])
    const shifted = testLayer('Shifted', rasterToFeatureCollection(createRasterGrid(2, 2, [1, 1, 1, 1], { origin: [1, 2], resolution: [1, -1] })))
    expect(() => rasterCalculatorTool.execute({ layers: [a, shifted], selectedLayerId: a.id }, { rasterA: a.id, rasterB: shifted.id, expression: 'A + B' })).toThrow(/identical dimensions/)
    expect(() => rasterCalculatorTool.execute({ layers: [a, b], selectedLayerId: a.id }, { rasterA: a.id, rasterB: b.id, expression: 'globalThis.alert(1)' })).toThrow(/unsupported character|Unexpected token/)
  })

  it('reclassifies inclusive ranges and extracts cells by polygon mask', async () => {
    const raster = rasterLayer('Values', [1, 2, 3, 4], 2, 2)
    const reclass = await runTool(reclassifyTool, [raster], { raster: raster.id, ranges: '1-2:5;3-4:9' })
    expect([...values(reclass.layers![0])]).toEqual([5, 5, 9, 9])
    const mask = testLayer('Mask', [{
      type: 'Feature', properties: {}, geometry: {
        type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 2], [0, 2], [0, 0]]],
      },
    }])
    const extracted = await runTool(extractByMaskTool, [raster, mask], { raster: raster.id, mask: mask.id })
    expect([...values(extracted.layers![0])].filter(Number.isFinite)).toEqual([1, 3])
    expect(() => reclassifyTool.execute({ layers: [raster], selectedLayerId: raster.id }, { raster: raster.id, ranges: 'broken' })).toThrow(/Invalid reclassification/)
  })

  it('reports zonal count, minimum, maximum, sum and mean', async () => {
    const raster = rasterLayer('Values', [1, 2, 3, 4], 2, 2)
    const zones = testLayer('Zones', [{
      type: 'Feature', properties: { zone: 'all' }, geometry: {
        type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      },
    }])
    const result = await runTool(zonalStatisticsTool, [raster, zones], { raster: raster.id, zones: zones.id })
    expect(result.layers![0].data.features[0].properties).toMatchObject({ COUNT: 4, MIN: 1, MAX: 4, SUM: 10, MEAN: 2.5 })
  })

  it('reads a GeoTIFF in-browser and gives a useful error for invalid files', async () => {
    const bytes = writeArrayBuffer(new Float32Array([1, 2, 3, 4]), {
      width: 2, height: 2, ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 10, 20, 0], GeographicTypeGeoKey: 4326,
    })
    const imported = await runTool(importGeoTiffTool, [], { file: new File([bytes], 'synthetic.tif') })
    expect(imported.layers![0].data.features).toHaveLength(4)
    expect([...values(imported.layers![0])]).toEqual([1, 2, 3, 4])
    await expect(runTool(importGeoTiffTool, [], { file: new File(['not a tiff'], 'invalid.tif', { type: 'image/tiff' }) }))
      .rejects.toThrow(/Could not read GeoTIFF/)
  })
})

describe('Spatial Analyst hydrology tools', () => {
  it('fills an enclosed sink and computes D8 direction and accumulation', async () => {
    const depression = rasterLayer('Depression', [5, 5, 5, 5, 0, 5, 5, 5, 5])
    const filled = await runTool(fillTool, [depression], { raster: depression.id })
    expect(values(filled.layers![0])[4]).toBe(5)

    const slope = rasterLayer('Slope', [3, 2, 1, 3, 2, 1, 3, 2, 1])
    const directions = await runTool(flowDirectionTool, [slope], { raster: slope.id })
    expect(values(directions.layers![0])[4]).toBe(1)
    const accumulation = await runTool(flowAccumulationTool, [slope], { raster: slope.id })
    expect(values(accumulation.layers![0])[5]).toBe(3)
  })
})
