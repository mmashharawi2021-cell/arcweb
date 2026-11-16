import type { Feature, Geometry, Point, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { runTool, testLayer } from '../../testUtils'
import { haversine } from '../../spatial'
import { localFrame, projectSites, twoTailedP } from '../_stats'
import { buildWeights } from '../_weights'
import { averageNearestNeighborTool } from '../averageNearestNeighbor'
import { centralFeatureTool } from '../centralFeature'
import { clusterOutlierAnalysisTool } from '../clusterOutlierAnalysis'
import { directionalDistributionTool } from '../directionalDistribution'
import { hotSpotAnalysisTool } from '../hotSpotAnalysis'
import { meanCenterTool } from '../meanCenter'
import { medianCenterTool } from '../medianCenter'
import { globalMoran, spatialAutocorrelationTool } from '../spatialAutocorrelation'
import { standardDistanceTool } from '../standardDistance'
import { spatialStatisticsTools } from '../index'

/** Exact metric offsets around lon 35, lat 31 (azimuthal equidistant). */
const origin = localFrame([{ lon: 35, lat: 31 }])
const ORIGIN: [number, number] = [35, 31]
const at = (x: number, y: number, properties: Record<string, unknown> = {}): Feature<Geometry> => ({
  type: 'Feature', properties, geometry: { type: 'Point', coordinates: origin.toLonLat(x, y) },
})
const metres = (lonLat: number[]) => origin.toPlane(lonLat[0], lonLat[1])

/** rows × cols grid of points with `spacing` metres, value(row, col) in field "v". */
const grid = (rows: number, cols: number, spacing: number, value: (row: number, col: number) => unknown) => {
  const features: Feature<Geometry>[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) features.push(at(col * spacing, row * spacing, { row, col, v: value(row, col) }))
  }
  return features
}

const props = (feature: Feature | undefined) => feature!.properties as Record<string, number & string>
const square = [at(-1000, -1000), at(1000, -1000), at(1000, 1000), at(-1000, 1000)]

describe('spatial statistics registry', () => {
  it('exports nine tools ordered by toolset then name', () => {
    expect(spatialStatisticsTools.map((tool) => tool.id)).toEqual([
      'average-nearest-neighbor', 'spatial-autocorrelation',
      'cluster-outlier-analysis', 'hot-spot-analysis',
      'central-feature', 'directional-distribution', 'mean-center', 'median-center', 'standard-distance',
    ])
    for (const tool of spatialStatisticsTools) {
      expect(tool.category).toBe('Spatial Statistics')
      expect(['Measuring Geographic Distributions', 'Analyzing Patterns', 'Mapping Clusters']).toContain(tool.subcategory)
    }
  })
})

describe('Measuring Geographic Distributions', () => {
  it('Mean Center of a symmetric square is its center', async () => {
    const layer = testLayer('square', square)
    const result = await runTool(meanCenterTool, [layer], { target: layer.id })
    const center = result.layers![0].data.features[0] as Feature<Point>
    expect(haversine(center.geometry.coordinates, ORIGIN)).toBeLessThan(0.01)
    expect(props(center).XCoord).toBeCloseTo(35, 7)
    expect(props(center).YCoord).toBeCloseTo(31, 7)
  })

  it('Mean Center honours weights, case field and dimension field; polygons use centroids', async () => {
    const layer = testLayer('weighted', [
      at(0, 0, { w: 3, group: 'a', z: 10 }), at(4000, 0, { w: 1, group: 'a', z: 20 }),
      at(0, 5000, { w: 1, group: 'b', z: 0 }), at(0, 7000, { w: 1, group: 'b', z: 0 }),
    ])
    const result = await runTool(meanCenterTool, [layer], { target: layer.id, weightField: 'w', caseField: 'group', dimensionField: 'z' })
    const [a, b] = result.layers![0].data.features as Feature<Point>[]
    const [ax, ay] = metres(a.geometry.coordinates)
    expect(ax).toBeCloseTo(1000, 0)
    expect(ay).toBeCloseTo(0, 0)
    expect(props(a).group).toBe('a')
    expect(props(a).ZCoord).toBeCloseTo(12.5, 9)
    expect(metres(b.geometry.coordinates)[1]).toBeCloseTo(6000, 0)

    const ring = [[-500, -500], [1500, -500], [1500, 1500], [-500, 1500], [-500, -500]].map(([x, y]) => origin.toLonLat(x, y))
    const polygons = testLayer('poly', [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } as Feature<Polygon>])
    const polygonCenter = (await runTool(meanCenterTool, [polygons], { target: polygons.id })).layers![0].data.features[0] as Feature<Point>
    const [px, py] = metres(polygonCenter.geometry.coordinates)
    expect(px).toBeCloseTo(500, -1)
    expect(py).toBeCloseTo(500, -1)
  })

  it('Median Center of four corners is the center, and of collinear points is the middle point', async () => {
    const corners = testLayer('square', square)
    const center = (await runTool(medianCenterTool, [corners], { target: corners.id })).layers![0].data.features[0] as Feature<Point>
    expect(haversine(center.geometry.coordinates, ORIGIN)).toBeLessThan(0.01)

    const line = testLayer('line', [at(0, 0), at(1000, 0), at(10_000, 0)])
    const median = (await runTool(medianCenterTool, [line], { target: line.id })).layers![0].data.features[0] as Feature<Point>
    const [x, y] = metres(median.geometry.coordinates)
    expect(x).toBeCloseTo(1000, 0)
    expect(Math.abs(y)).toBeLessThan(0.5)
  })

  it('Central Feature picks the feature with the smallest total distance', async () => {
    const layer = testLayer('cross', [at(-3000, 0), at(0, 2500), at(200, 100), at(3000, 0), at(0, -2500)])
    const result = await runTool(centralFeatureTool, [layer], { target: layer.id })
    const features = result.layers![0].data.features
    expect(features).toHaveLength(1)
    expect(props(features[0]).CF_ID).toBe(3)
    // With a heavy weight on the eastern point, the central feature moves east.
    const weighted = testLayer('weighted', [at(-3000, 0, { w: 1 }), at(0, 0, { w: 1 }), at(3000, 0, { w: 100 })])
    const moved = await runTool(centralFeatureTool, [weighted], { target: weighted.id, weightField: 'w' })
    expect(props(moved.layers![0].data.features[0]).CF_ID).toBe(3)
  })

  it('Directional Distribution: east–west spread gives rotation 90° with the long axis on Y', async () => {
    const layer = testLayer('ew', [at(-2000, 0), at(-1000, 0), at(1000, 0), at(2000, 0), at(0, 100), at(0, -100)])
    const result = await runTool(directionalDistributionTool, [layer], { target: layer.id })
    const ellipse = props(result.layers![0].data.features[0])
    expect(ellipse.Rotation).toBeCloseTo(90, 0)
    // σ = √2 · √(Σd² / n): long axis √2·√(10e6/6) ≈ 1825.7 m, short axis √2·√(2e4/6) ≈ 81.65 m.
    expect(ellipse.YStdDist).toBeGreaterThan(ellipse.XStdDist)
    expect(ellipse.YStdDist / 1825.74).toBeCloseTo(1, 2)
    expect(ellipse.XStdDist / 81.65).toBeCloseTo(1, 1)
    expect(result.layers![0].data.features[0].geometry.type).toBe('Polygon')
  })

  it('Directional Distribution: rotation follows a 30° trend; 2 std devs doubles the axes', async () => {
    const theta = (30 * Math.PI) / 180
    const features = [-3, -2, -1, 0, 1, 2, 3].flatMap((t) => [
      at(t * 1000 * Math.sin(theta) + 50 * Math.cos(theta), t * 1000 * Math.cos(theta) - 50 * Math.sin(theta)),
      at(t * 1000 * Math.sin(theta) - 50 * Math.cos(theta), t * 1000 * Math.cos(theta) + 50 * Math.sin(theta)),
    ])
    const layer = testLayer('trend', features)
    const one = props((await runTool(directionalDistributionTool, [layer], { target: layer.id })).layers![0].data.features[0])
    const two = props((await runTool(directionalDistributionTool, [layer], { target: layer.id, size: '2' })).layers![0].data.features[0])
    expect(one.Rotation).toBeCloseTo(30, 0)
    expect(one.YStdDist).toBeGreaterThan(one.XStdDist)
    expect(one.XStdDist).toBeCloseTo(Math.SQRT2 * 50, 0)
    expect(two.YStdDist / one.YStdDist).toBeCloseTo(2, 6)
  })

  it('Standard Distance of a square equals the corner distance √2·1000 m', async () => {
    const layer = testLayer('square', square)
    const one = await runTool(standardDistanceTool, [layer], { target: layer.id })
    const circle = one.layers![0].data.features[0] as Feature<Polygon>
    expect(props(circle).StdDist).toBeCloseTo(1414.21, 0)
    const vertex = circle.geometry.coordinates[0][0]
    expect(Math.hypot(...metres(vertex))).toBeCloseTo(1414.21, 0)
    const two = await runTool(standardDistanceTool, [layer], { target: layer.id, size: '2' })
    expect(props(two.layers![0].data.features[0]).StdDist).toBeCloseTo(2828.43, 0)
  })
})

describe('Analyzing Patterns', () => {
  it('Average Nearest Neighbor: a regular grid is dispersed', async () => {
    const layer = testLayer('grid', grid(10, 10, 1000, () => 1))
    const result = await runTool(averageNearestNeighborTool, [layer], { target: layer.id })
    const row = props(result.layers![0].data.features[0])
    expect(result.layers![0].data.features[0].geometry).toBeNull()
    expect(row.NNObserved).toBeCloseTo(1000, -1)
    expect(row.Area / 81e6).toBeCloseTo(1, 2)
    // D̄e = 0.5 / √(100 / 81e6) = 450 m → ratio ≈ 2.22.
    expect(row.NNExpected).toBeCloseTo(450, -1)
    expect(row.NNRatio).toBeGreaterThan(2.1)
    expect(row.NNZScore).toBeGreaterThan(10)
    expect(row.Pattern).toBe('Dispersed')
    expect(result.message).toMatch(/dispersed/i)
  })

  it('Average Nearest Neighbor: tight clusters are clustered', async () => {
    const centres = [[0, 0], [20_000, 0], [10_000, 17_000]]
    const features = centres.flatMap(([cx, cy]) => Array.from({ length: 15 }, (_, k) => at(cx + (k % 4) * 10, cy + Math.floor(k / 4) * 10)))
    const layer = testLayer('clusters', features)
    const row = props((await runTool(averageNearestNeighborTool, [layer], { target: layer.id })).layers![0].data.features[0])
    expect(row.NNRatio).toBeLessThan(0.1)
    expect(row.NNZScore).toBeLessThan(-2.58)
    expect(row.PValue).toBeLessThan(0.01)
    expect(row.Pattern).toBe('Clustered')
  })

  it("Global Moran's I: a checkerboard is perfectly negative", async () => {
    const layer = testLayer('checker', grid(6, 6, 1000, (row, col) => (row + col) % 2))
    const result = await runTool(spatialAutocorrelationTool, [layer], {
      target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1200, standardization: 'ROW',
    })
    const row = props(result.layers![0].data.features[0])
    expect(row.MoransI).toBeCloseTo(-1, 6)
    expect(row.ExpectedI).toBeCloseTo(-1 / 35, 9)
    expect(row.ZScore).toBeLessThan(-2.58)
    expect(row.Pattern).toBe('Dispersed')
    expect(result.message).toMatch(/I = -1/)
  })

  it("Global Moran's I: a gradient is significantly clustered (default inverse distance)", async () => {
    const layer = testLayer('gradient', grid(8, 8, 1000, (row, col) => row + col))
    const result = await runTool(spatialAutocorrelationTool, [layer], { target: layer.id, field: 'v' })
    const row = props(result.layers![0].data.features[0])
    expect(row.MoransI).toBeGreaterThan(0.5)
    expect(row.ZScore).toBeGreaterThan(2.58)
    expect(row.PValue).toBeLessThan(0.01)
    expect(row.Pattern).toBe('Clustered')
    expect(result.message).toMatch(/clustered/i)
  })

  it("Global Moran's I moments match a dense reference (asymmetric k-nearest weights)", () => {
    const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const next = random(7)
    const points = Array.from({ length: 40 }, () => ({ lon: 35 + next() * 0.1, lat: 31 + next() * 0.1 }))
    const planar = projectSites(points.map((point, row) => ({ ...point, row, feature: at(0, 0) })))
    const values = planar.map(() => next() * 100)
    const matrix = buildWeights(planar, {
      conceptualization: 'K_NEAREST_NEIGHBORS', distanceMethod: 'EUCLIDEAN', threshold: null, k: 4, rowStandardize: false, includeSelf: false,
    }, 'test')
    const result = globalMoran(values, matrix)

    const n = values.length
    const w = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    matrix.neighbors.forEach((row, i) => row.forEach((j, position) => { w[i][j] = matrix.weights[i][position] }))
    const mean = values.reduce((a, b) => a + b, 0) / n
    const z = values.map((value) => value - mean)
    let s0 = 0, s1 = 0, s2 = 0, cross = 0
    for (let i = 0; i < n; i += 1) {
      let rowSum = 0, colSum = 0
      for (let j = 0; j < n; j += 1) {
        s0 += w[i][j]
        s1 += 0.5 * (w[i][j] + w[j][i]) ** 2
        cross += w[i][j] * z[i] * z[j]
        rowSum += w[i][j]
        colSum += w[j][i]
      }
      s2 += (rowSum + colSum) ** 2
    }
    const m2 = z.reduce((sum, value) => sum + value * value, 0)
    const m4 = z.reduce((sum, value) => sum + value ** 4, 0)
    const index = (n / s0) * cross / m2
    const kurtosis = n * m4 / (m2 * m2)
    const a = n * ((n * n - 3 * n + 3) * s1 - n * s2 + 3 * s0 * s0)
    const b = kurtosis * ((n * n - n) * s1 - 2 * n * s2 + 6 * s0 * s0)
    const c = (n - 1) * (n - 2) * (n - 3) * s0 * s0
    const variance = (a - b) / c - 1 / (n - 1) ** 2
    expect(result.index).toBeCloseTo(index, 12)
    expect(result.variance).toBeCloseTo(variance, 12)
    expect(result.z).toBeCloseTo((index + 1 / (n - 1)) / Math.sqrt(variance), 9)
    expect(result.p).toBeCloseTo(twoTailedP(result.z), 12)
  })
})

describe('Mapping Clusters', () => {
  const block = (row: number, col: number) => row >= 3 && row <= 5 && col >= 3 && col <= 5
  const blockGrid = () => testLayer('block', grid(10, 10, 1000, (row, col) => block(row, col) ? 10 : 1))

  it('Hot Spot Analysis: a block of high values is a 99% hot spot; distant cells are not', async () => {
    const layer = blockGrid()
    const result = await runTool(hotSpotAnalysisTool, [layer], { target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1500 })
    const output = result.layers![0]
    expect(output.renderer).toMatchObject({ type: 'unique', field: 'Gi_Bin' })
    expect(output.data.features).toHaveLength(100)
    for (const feature of output.data.features) {
      const { row, col, Gi_Bin: bin } = props(feature)
      const gap = Math.max(Math.max(3 - row, row - 5, 0), Math.max(3 - col, col - 5, 0))
      if (gap === 0) expect(bin, `cell ${row},${col}`).toBe(3)
      if (gap >= 2) expect(bin, `cell ${row},${col}`).toBeLessThanOrEqual(0)
    }
    // Hand-computed Gi* for the block center: (90 − 1.81·9) / (2.575636 · √(819/99)) = 9.94988.
    const center = output.data.features.find((feature) => props(feature).row === 4 && props(feature).col === 4)
    expect(props(center).GiZScore).toBeCloseTo(9.94988, 4)
    expect(props(center).GiPValue).toBeLessThan(1e-6)
    expect(props(center).NNeighbors).toBe(9)
    expect(result.message).toMatch(/9 hot spot|hot spot/)
  })

  it('Hot Spot Analysis: FDR correction keeps the core hot spot', async () => {
    const layer = blockGrid()
    const result = await runTool(hotSpotAnalysisTool, [layer], { target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1500, fdr: 'yes' })
    const center = result.layers![0].data.features.find((feature) => props(feature).row === 4 && props(feature).col === 4)
    expect(props(center).Gi_Bin).toBe(3)
  })

  it("Cluster and Outlier Analysis: a high-value block is HH", async () => {
    const layer = blockGrid()
    const result = await runTool(clusterOutlierAnalysisTool, [layer], { target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1500 })
    const output = result.layers![0]
    expect(output.renderer).toMatchObject({ type: 'unique', field: 'COType' })
    const center = output.data.features.find((feature) => props(feature).row === 4 && props(feature).col === 4)
    expect(props(center).COType).toBe('HH')
    expect(props(center).LMiIndex).toBeGreaterThan(0)
    expect(props(center).LMiZScore).toBeGreaterThan(2.58)
    const far = output.data.features.find((feature) => props(feature).row === 9 && props(feature).col === 0)
    expect(['', 'LL']).toContain(props(far).COType)
  })

  it("Cluster and Outlier Analysis: a lone high value amid lows is HL", async () => {
    const layer = testLayer('outlier', grid(7, 7, 1000, (row, col) => row === 3 && col === 3 ? 10 : 1))
    const parameters = { target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1500 }
    const result = await runTool(clusterOutlierAnalysisTool, [layer], parameters)
    const center = result.layers![0].data.features.find((feature) => props(feature).row === 3 && props(feature).col === 3)
    // zᵢ·lag / Sᵢ² with all neighbours equal reduces to z_high / z_low = −48.
    expect(props(center).LMiIndex).toBeCloseTo(-48, 6)
    expect(props(center).LMiZScore).toBeLessThan(-2.58)
    expect(props(center).COType).toBe('HL')
    const neighbour = result.layers![0].data.features.find((feature) => props(feature).row === 3 && props(feature).col === 4)
    expect(props(neighbour).COType).not.toBe('HH')
  })

  it('Cluster and Outlier Analysis: seeded permutation pseudo p-values are reproducible', async () => {
    const layer = blockGrid()
    const permuted = { target: layer.id, field: 'v', conceptualization: 'FIXED_DISTANCE_BAND', threshold: 1500, permutations: '99', seed: 42 }
    const first = await runTool(clusterOutlierAnalysisTool, [layer], permuted)
    const second = await runTool(clusterOutlierAnalysisTool, [layer], permuted)
    const pValues = (output: typeof first) => output.layers![0].data.features.map((feature) => props(feature).LMiPValue)
    expect(pValues(first)).toEqual(pValues(second))
    // No permutation of 8 neighbours drawn from 99 features (8 of them high) beats an all-high neighbourhood: p = 1/(99+1).
    const center = first.layers![0].data.features.find((feature) => props(feature).row === 4 && props(feature).col === 4)
    expect(props(center).LMiPValue).toBeCloseTo(0.01, 9)
    expect(props(center).COType).toBe('HH')
    expect(first.message).toMatch(/99 permutations \(seed 42\)/)
  })

  it('K nearest neighbors defaults to 8 neighbors', async () => {
    const layer = blockGrid()
    const result = await runTool(clusterOutlierAnalysisTool, [layer], { target: layer.id, field: 'v', conceptualization: 'K_NEAREST_NEIGHBORS' })
    expect(result.layers![0].data.features.every((feature) => props(feature).NNeighbors === 8)).toBe(true)
  })
})

describe('error paths', () => {
  it('rejects too few features', async () => {
    const two = testLayer('two', [at(0, 0, { v: 1 }), at(1000, 0, { v: 2 })])
    await expect(runTool(averageNearestNeighborTool, [two], { target: two.id })).rejects.toThrow(/at least 3/)
    await expect(runTool(spatialAutocorrelationTool, [two], { target: two.id, field: 'v' })).rejects.toThrow(/at least 4/)
    await expect(runTool(directionalDistributionTool, [two], { target: two.id })).rejects.toThrow(/at least 3/)
    await expect(runTool(hotSpotAnalysisTool, [two], { target: two.id, field: 'v' })).rejects.toThrow(/at least 3/)
  })

  it('rejects non-numeric and constant fields', async () => {
    const layer = testLayer('text', grid(3, 3, 1000, (row) => `name ${row}`))
    await expect(runTool(spatialAutocorrelationTool, [layer], { target: layer.id, field: 'v' })).rejects.toThrow(/numeric/)
    await expect(runTool(hotSpotAnalysisTool, [layer], { target: layer.id, field: 'v' })).rejects.toThrow(/numeric/)
    await expect(runTool(meanCenterTool, [layer], { target: layer.id, weightField: 'v' })).rejects.toThrow(/numeric/)
    const constant = testLayer('constant', grid(3, 3, 1000, () => 5))
    await expect(runTool(clusterOutlierAnalysisTool, [constant], { target: constant.id, field: 'v' })).rejects.toThrow(/same/)
    await expect(runTool(spatialAutocorrelationTool, [constant], { target: constant.id, field: 'missing' })).rejects.toThrow(/does not exist/)
  })

  it('rejects negative weights and an over-dense inverse distance matrix', async () => {
    const negative = testLayer('negative', [at(0, 0, { w: -1 }), at(1000, 0, { w: 1 })])
    await expect(runTool(meanCenterTool, [negative], { target: negative.id, weightField: 'w' })).rejects.toThrow(/negative/)
    const big = testLayer('big', grid(50, 50, 100, (row, col) => row * col))
    await expect(runTool(spatialAutocorrelationTool, [big], { target: big.id, field: 'v', threshold: 0 })).rejects.toThrow(/too many/)
  })
})
