import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool } from '../types'
import { fmt, interpretPattern, layerSites, projectSites, statisticsTable, tidy, twoTailedP } from './_stats'
import { PointSweep, distanceMethodParameter, optionalNumber, readDistanceMethod } from './_weights'

const MAX_FEATURES = 200_000

const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Convex hull (Andrew's monotone chain), counter-clockwise without repeating the first vertex. */
export function convexHull(points: number[][]): number[][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const lower: number[][] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: number[][] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Area of the minimum-area enclosing rectangle (one side is always collinear with a hull edge). */
export function minimumEnclosingRectangleArea(points: number[][]): number {
  const hull = convexHull(points)
  if (hull.length < 3) return 0
  const area = (ux: number, uy: number) => {
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, y] of hull) {
      const u = x * ux + y * uy
      const v = -x * uy + y * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    return (maxU - minU) * (maxV - minV)
  }
  // Very large hulls fall back to the axis-aligned envelope to stay responsive.
  if (hull.length > 4_000) return area(1, 0)
  let best = Infinity
  for (let index = 0; index < hull.length; index += 1) {
    const [x1, y1] = hull[index]
    const [x2, y2] = hull[(index + 1) % hull.length]
    const length = Math.hypot(x2 - x1, y2 - y1)
    if (length > 0) best = Math.min(best, area((x2 - x1) / length, (y2 - y1) / length))
  }
  return best
}

/**
 * Average Nearest Neighbor (Esri): D̄o = Σdᵢ / n, D̄e = 0.5 / √(n / A), ANN = D̄o / D̄e,
 * SE = 0.26136 / √(n² / A), z = (D̄o − D̄e) / SE.
 */
export const averageNearestNeighborTool: ToolboxTool = {
  id: 'average-nearest-neighbor',
  name: 'Average Nearest Neighbor',
  category: 'Spatial Statistics',
  subcategory: 'Analyzing Patterns',
  description: 'Compare the average distance between each feature and its nearest neighbor to a random distribution, reporting the nearest neighbor ratio, z-score, and p-value.',
  keywords: ['ann', 'nearest neighbor index', 'nni', 'clustered', 'dispersed', 'random', 'point pattern'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    distanceMethodParameter,
    { id: 'area', label: 'Area in square meters (blank = minimum enclosing rectangle)', kind: 'number', min: 0 },
    { id: 'outputName', label: 'Output table name', kind: 'text', placeholder: 'Average nearest neighbor' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const method = readDistanceMethod(parameters)
    const areaInput = optionalNumber(parameters, 'area', 'area')
    const sites = layerSites(layer)
    if (sites.length < 3) throw new Error(`Average Nearest Neighbor requires at least 3 features with a location (found ${sites.length}).`)
    if (sites.length > MAX_FEATURES) throw new Error(`Average Nearest Neighbor supports at most ${MAX_FEATURES.toLocaleString()} features.`)
    const planar = projectSites(sites)
    const sweep = new PointSweep(Float64Array.from(planar, (site) => site.x), Float64Array.from(planar, (site) => site.y), method)
    const n = planar.length
    const observed = sweep.nearestDistances().reduce((sum, value) => sum + value, 0) / n
    const area = areaInput || minimumEnclosingRectangleArea(planar.map((site) => [site.x, site.y]))
    if (!(area > 0)) throw new Error('The features are collinear or coincident, so the study area is zero. Enter an area value.')

    const expected = 0.5 / Math.sqrt(n / area)
    const ratio = observed / expected
    const standardError = 0.26136 / Math.sqrt((n * n) / area)
    const z = (observed - expected) / standardError
    const p = twoTailedP(z)
    const { pattern, sentence } = interpretPattern(z, p, 'Dispersed')

    const table = statisticsTable(getOptionalText(parameters, 'outputName') || `${layer.name} Average Nearest Neighbor`, {
      NNObserved: tidy(observed),
      NNExpected: tidy(expected),
      NNRatio: tidy(ratio),
      NNZScore: tidy(z),
      PValue: tidy(p),
      Pattern: pattern,
      Features: n,
      Area: tidy(area),
      DistMethod: method,
    })
    return {
      message: `Average Nearest Neighbor (${layer.name}): observed mean distance ${fmt(observed)} m, expected ${fmt(expected)} m, nearest neighbor ratio ${fmt(ratio)}, z-score ${fmt(z, 4)}, p-value ${fmt(p, 4)} → ${pattern}. ${sentence} (n = ${n}, area ${fmt(area)} m²${areaInput ? '' : ' from the minimum enclosing rectangle'}).`,
      kind: 'success',
      layers: [table],
    }
  },
}
