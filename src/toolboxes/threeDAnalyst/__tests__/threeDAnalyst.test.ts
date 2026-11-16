import { describe, expect, it } from 'vitest'
import { createRasterGrid, rasterFromFeatureCollection, rasterToFeatureCollection } from '../../../rasterEngine'
import { testLayer, runTool } from '../../testUtils'
import { createTinTool, featureTo3DByAttributeTool, interpolateShapeTool, lineOfSightTool, viewshedTool } from '../index'

function rasterLayer(values: number[], width = 3, height = 3) {
  const grid = createRasterGrid(width, height, values, {
    origin: [0, height], resolution: [1, -1], crs: 'EPSG:4326',
  })
  return testLayer('Elevation', rasterToFeatureCollection(grid))
}

describe('3D Analyst tools', () => {
  it('creates Delaunay TIN triangles with elevation, slope and aspect attributes', async () => {
    const points = testLayer('Samples', [
      { type: 'Feature', properties: { z: 0 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { z: 10 }, geometry: { type: 'Point', coordinates: [1, 0] } },
      { type: 'Feature', properties: { z: 20 }, geometry: { type: 'Point', coordinates: [0, 1] } },
    ])
    const result = await runTool(createTinTool, [points], { points: points.id, elevationField: 'z' })
    expect(result.layers?.[0].data.features).toHaveLength(1)
    const triangle = result.layers![0].data.features[0]
    expect(triangle.geometry?.type).toBe('Polygon')
    expect((triangle.geometry as GeoJSON.Polygon).coordinates[0][0]).toHaveLength(3)
    expect(triangle.properties?.elevation).toBe(10)
    expect([triangle.properties?.z1, triangle.properties?.z2, triangle.properties?.z3].sort()).toEqual([0, 10, 20])
    expect(Number(triangle.properties?.slope)).toBeGreaterThan(0)
    expect(Number.isFinite(triangle.properties?.aspect)).toBe(true)
  })

  it('drapes point, line and polygon vertices over valid DEM cells', async () => {
    const raster = rasterLayer([0, 10, 20, 10, 20, 30, 20, 30, 40])
    const features = testLayer('Shapes', [
      { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [0.5, 2.5] } },
      { type: 'Feature', properties: { id: 2 }, geometry: { type: 'LineString', coordinates: [[0.5, 2.5], [2.5, 0.5]] } },
      { type: 'Feature', properties: { id: 3 }, geometry: { type: 'Polygon', coordinates: [[[0.5, 2.5], [1.5, 2.5], [1.5, 1.5], [0.5, 2.5]]] } },
    ])
    const result = await runTool(interpolateShapeTool, [features, raster], {
      features: features.id, raster: raster.id, valueField: 'value',
    })
    const output = result.layers![0].data.features
    expect(output[0].geometry).toEqual({ type: 'Point', coordinates: [0.5, 2.5, 0] })
    expect((output[1].geometry as GeoJSON.LineString).coordinates[1][2]).toBe(40)
    expect((output[2].geometry as GeoJSON.Polygon).coordinates[0][1][2]).toBe(10)

    const restoredGrid = rasterFromFeatureCollection(raster.data)
    expect(restoredGrid.width).toBe(3)
  })

  it('copies a numeric feature attribute to all coordinates as Z', async () => {
    const polygons = testLayer('Buildings', [{
      type: 'Feature', properties: { height: 12.5 },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }])
    const result = await runTool(featureTo3DByAttributeTool, [polygons], {
      features: polygons.id, heightField: 'height',
    })
    expect((result.layers![0].data.features[0].geometry as GeoJSON.Polygon).coordinates[0][2]).toEqual([1, 1, 12.5])
  })

  it('reports terrain obstruction for line of sight and preserves a 3D output line', async () => {
    const raster = rasterLayer([0, 0, 0, 0, 10, 0, 0, 0, 0])
    const points = testLayer('Endpoints', [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0.5, 1.5] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2.5, 1.5] } },
    ])
    const result = await runTool(lineOfSightTool, [points, raster], {
      points: points.id, raster: raster.id, observerIndex: 0, targetIndex: 1,
      observerHeight: 1, targetHeight: 1,
    })
    const feature = result.layers![0].data.features[0]
    expect(feature.properties?.visible).toBe(false)
    expect(feature.properties?.firstObstructionDistance).toBeGreaterThan(0)
    expect((feature.geometry as GeoJSON.LineString).coordinates[0]).toHaveLength(3)
  })

  it('marks visible and terrain-blocked cells while preserving NoData', async () => {
    const raster = rasterLayer([0, 0, 0, 0, 10, 0, 0, 0, 0])
    const observer = testLayer('Observer', [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0.5, 1.5] } },
    ])
    const result = await runTool(viewshedTool, [observer, raster], {
      points: observer.id, raster: raster.id, observerIndex: 0, observerHeight: 1,
    })
    const output = rasterFromFeatureCollection(result.layers![0].data)
    expect(output.values[3]).toBe(1)
    expect(output.values[4]).toBe(1)
    expect(output.values[5]).toBe(0)

    const nodata = rasterLayer([0, 0, 0, 0, Number.NaN, 0, 0, 0, 0])
    const nodataResult = await runTool(viewshedTool, [observer, nodata], {
      points: observer.id, raster: nodata.id, observerIndex: 0, observerHeight: 1,
    })
    expect(Number.isNaN(rasterFromFeatureCollection(nodataResult.layers![0].data).values[4])).toBe(true)

    const invalidTarget = testLayer('Invalid target', [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0.5, 1.5] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1.5, 1.5] } },
    ])
    expect(() => lineOfSightTool.execute({ layers: [invalidTarget, nodata], selectedLayerId: invalidTarget.id }, {
      points: invalidTarget.id, raster: nodata.id, observerIndex: 0, targetIndex: 1, observerHeight: 1, targetHeight: 1,
    })).toThrow(/valid, non-NoData elevation cells/)
  })
})
