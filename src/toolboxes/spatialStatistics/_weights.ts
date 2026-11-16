import { getNumber, getOptionalText } from '../shared'
import type { ToolboxParameters, ToolParameter } from '../types'
import { fmt } from './_stats'

/**
 * Spatial weights for the pattern and cluster tools (ArcGIS "Conceptualization of
 * Spatial Relationships"). Points are planar (metres). Neighbour searches use an
 * x-sorted sweep so fixed-band and k-nearest queries avoid a full n² scan; the
 * inherently dense case (inverse distance without a threshold) is capped.
 */

export type Conceptualization = 'INVERSE_DISTANCE' | 'INVERSE_DISTANCE_SQUARED' | 'FIXED_DISTANCE_BAND' | 'K_NEAREST_NEIGHBORS'
export type DistanceMethod = 'EUCLIDEAN' | 'MANHATTAN'

/** Largest feature count for tools that compare every pair of features. */
export const MAX_PAIRWISE_FEATURES = 5_000
/** Largest feature count for the weights-based tools (neighbour search is sub-quadratic). */
export const MAX_WEIGHTED_FEATURES = 50_000
/** Largest number of neighbour links held in a weights matrix. */
export const MAX_NEIGHBOR_LINKS = 5_000_000

const conceptualizations: { value: Conceptualization; label: string }[] = [
  { value: 'INVERSE_DISTANCE', label: 'Inverse distance' },
  { value: 'INVERSE_DISTANCE_SQUARED', label: 'Inverse distance squared' },
  { value: 'FIXED_DISTANCE_BAND', label: 'Fixed distance band' },
  { value: 'K_NEAREST_NEIGHBORS', label: 'K nearest neighbors' },
]

export const conceptualizationParameter = (defaultValue: Conceptualization = 'INVERSE_DISTANCE'): ToolParameter => ({
  id: 'conceptualization', label: 'Conceptualization of spatial relationships', kind: 'select', defaultValue, options: conceptualizations,
})

export const distanceMethodParameter: ToolParameter = {
  id: 'distanceMethod', label: 'Distance method', kind: 'select', defaultValue: 'EUCLIDEAN',
  options: [{ value: 'EUCLIDEAN', label: 'Euclidean' }, { value: 'MANHATTAN', label: 'Manhattan' }],
}

export const thresholdParameter: ToolParameter = {
  id: 'threshold',
  label: 'Distance band / threshold in meters (blank = every feature gets ≥1 neighbor; 0 = no threshold for inverse distance)',
  kind: 'number', min: 0, step: 1,
}

export const neighborsParameter: ToolParameter = {
  id: 'neighbors', label: 'Number of neighbors (K nearest neighbors)', kind: 'number', defaultValue: 8, min: 1, step: 1,
}

export const standardizationParameter = (defaultValue: 'ROW' | 'NONE'): ToolParameter => ({
  id: 'standardization', label: 'Standardization', kind: 'select', defaultValue,
  options: [{ value: 'ROW', label: 'Row' }, { value: 'NONE', label: 'None' }],
})

export const distanceFunction = (method: DistanceMethod, xs: Float64Array, ys: Float64Array) =>
  method === 'MANHATTAN'
    ? (i: number, j: number) => Math.abs(xs[i] - xs[j]) + Math.abs(ys[i] - ys[j])
    : (i: number, j: number) => Math.hypot(xs[i] - xs[j], ys[i] - ys[j])

export function readDistanceMethod(parameters: ToolboxParameters): DistanceMethod {
  const method = getOptionalText(parameters, 'distanceMethod') || 'EUCLIDEAN'
  if (method !== 'EUCLIDEAN' && method !== 'MANHATTAN') throw new Error('Choose Euclidean or Manhattan distance.')
  return method
}

/** Reads an optional non-negative number; `null` when the parameter is blank. */
export function optionalNumber(parameters: ToolboxParameters, id: string, label: string): number | null {
  const value = parameters[id]
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  const number = getNumber(parameters, id, label)
  if (number < 0) throw new Error(`The ${label} cannot be negative.`)
  return number
}

export interface WeightsOptions {
  conceptualization: Conceptualization
  distanceMethod: DistanceMethod
  /** Metres; `null` = default threshold; 0 = no threshold (inverse distance only). */
  threshold: number | null
  k: number
  rowStandardize: boolean
  /** Include each feature as its own neighbour (Getis-Ord Gi*). */
  includeSelf: boolean
}

export function readWeightsOptions(parameters: ToolboxParameters, options: { standardization: boolean; includeSelf: boolean }): WeightsOptions {
  const conceptualization = (getOptionalText(parameters, 'conceptualization') || 'INVERSE_DISTANCE') as Conceptualization
  if (!conceptualizations.some((item) => item.value === conceptualization)) throw new Error('Choose a conceptualization of spatial relationships.')
  const kValue = optionalNumber(parameters, 'neighbors', 'number of neighbors')
  const k = kValue === null ? 8 : Math.floor(kValue)
  if (conceptualization === 'K_NEAREST_NEIGHBORS' && k < 1) throw new Error('The number of neighbors must be at least 1.')
  return {
    conceptualization,
    distanceMethod: readDistanceMethod(parameters),
    threshold: optionalNumber(parameters, 'threshold', 'distance threshold'),
    k,
    rowStandardize: options.standardization && (getOptionalText(parameters, 'standardization') || 'ROW') === 'ROW',
    includeSelf: options.includeSelf,
  }
}

/** Neighbour queries over planar points, using a sweep along x-sorted order. */
export class PointSweep {
  private readonly order: Int32Array
  private readonly rank: Int32Array
  readonly xs: Float64Array
  readonly distance: (i: number, j: number) => number

  constructor(xs: Float64Array, ys: Float64Array, method: DistanceMethod) {
    this.xs = xs
    this.distance = distanceFunction(method, xs, ys)
    const order = Array.from({ length: xs.length }, (_, index) => index).sort((a, b) => xs[a] - xs[b])
    this.order = Int32Array.from(order)
    this.rank = new Int32Array(xs.length)
    order.forEach((index, position) => { this.rank[index] = position })
  }

  /** Calls `visit` for every other point within `radius` (inclusive). */
  within(i: number, radius: number, visit: (j: number, distance: number) => void) {
    const { order, xs } = this
    const start = this.rank[i]
    for (let position = start - 1; position >= 0; position -= 1) {
      const j = order[position]
      if (xs[i] - xs[j] > radius) break
      const d = this.distance(i, j)
      if (d <= radius) visit(j, d)
    }
    for (let position = start + 1; position < order.length; position += 1) {
      const j = order[position]
      if (xs[j] - xs[i] > radius) break
      const d = this.distance(i, j)
      if (d <= radius) visit(j, d)
    }
  }

  /** The k nearest other points, closest first. */
  nearest(i: number, k: number): { index: number[]; distance: number[] } {
    const { order, xs } = this
    const index: number[] = []
    const distance: number[] = []
    let left = this.rank[i] - 1
    let right = this.rank[i] + 1
    while (left >= 0 || right < order.length) {
      const gapLeft = left >= 0 ? xs[i] - xs[order[left]] : Infinity
      const gapRight = right < order.length ? xs[order[right]] - xs[i] : Infinity
      const useLeft = gapLeft <= gapRight
      if (index.length === k && Math.min(gapLeft, gapRight) > distance[k - 1]) break
      const j = useLeft ? order[left--] : order[right++]
      const d = this.distance(i, j)
      if (index.length < k || d < distance[k - 1]) {
        let slot = index.length
        while (slot > 0 && distance[slot - 1] > d) slot -= 1
        index.splice(slot, 0, j)
        distance.splice(slot, 0, d)
        if (index.length > k) {
          index.pop()
          distance.pop()
        }
      }
    }
    return { index, distance }
  }

  /** Distance to the nearest other point, for every point. */
  nearestDistances(): Float64Array {
    const result = new Float64Array(this.xs.length)
    for (let i = 0; i < result.length; i += 1) result[i] = this.nearest(i, 1).distance[0] ?? Infinity
    return result
  }
}

export interface SpatialWeights {
  /** Neighbour indices per feature, ascending (includes the feature itself when `includeSelf`). */
  neighbors: Int32Array[]
  weights: Float64Array[]
  /** Threshold applied in metres, or null (k nearest neighbours / no threshold). */
  threshold: number | null
  /** Features with no neighbours other than themselves. */
  isolated: number
  links: number
  description: string
}

/** Weight of the neighbour pair (i, j), or 0 (binary search in the sorted row). */
export function weightOf(matrix: SpatialWeights, i: number, j: number): number {
  const row = matrix.neighbors[i]
  let low = 0
  let high = row.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (row[middle] === j) return matrix.weights[i][middle]
    if (row[middle] < j) low = middle + 1
    else high = middle - 1
  }
  return 0
}

export function buildWeights(points: { x: number; y: number }[], options: WeightsOptions, toolName: string): SpatialWeights {
  const n = points.length
  if (n > MAX_WEIGHTED_FEATURES) {
    throw new Error(`${toolName} supports at most ${MAX_WEIGHTED_FEATURES.toLocaleString()} features (got ${n.toLocaleString()}).`)
  }
  const xs = Float64Array.from(points, (point) => point.x)
  const ys = Float64Array.from(points, (point) => point.y)
  const sweep = new PointSweep(xs, ys, options.distanceMethod)
  const { conceptualization } = options
  const knn = conceptualization === 'K_NEAREST_NEIGHBORS'
  const inverse = conceptualization === 'INVERSE_DISTANCE' || conceptualization === 'INVERSE_DISTANCE_SQUARED'
  const power = conceptualization === 'INVERSE_DISTANCE_SQUARED' ? 2 : 1

  let threshold: number | null = null
  let defaulted = false
  if (!knn) {
    if (options.threshold === null || (options.threshold === 0 && !inverse)) {
      threshold = sweep.nearestDistances().reduce((max, value) => Math.max(max, value), 0)
      defaulted = true
      if (!(threshold > 0)) throw new Error('All features share one location, so no distance threshold can be derived.')
    } else if (options.threshold > 0) {
      threshold = options.threshold
    }
    if (threshold === null && n * (n - 1) > MAX_NEIGHBOR_LINKS) {
      throw new Error(`${toolName}: inverse distance without a threshold links every pair of features (${n.toLocaleString()} features is too many). Set a distance threshold or use K nearest neighbors.`)
    }
  }
  const k = Math.min(options.k, n - 1)
  // Distances below 1 m are treated as 1 m so coincident features do not get infinite weights.
  const weightFor = (d: number) => inverse ? 1 / Math.max(d, 1) ** power : 1

  const neighbors: Int32Array[] = []
  const weights: Float64Array[] = []
  let links = 0
  let isolated = 0
  for (let i = 0; i < n; i += 1) {
    const ids: number[] = []
    const values: number[] = []
    const add = (j: number, d: number) => {
      ids.push(j)
      values.push(weightFor(d))
    }
    if (knn) {
      const found = sweep.nearest(i, k)
      found.index.forEach((j, position) => add(j, found.distance[position]))
    } else if (threshold === null) {
      for (let j = 0; j < n; j += 1) if (j !== i) add(j, sweep.distance(i, j))
    } else {
      sweep.within(i, threshold, add)
    }
    if (!ids.length) isolated += 1
    if (options.includeSelf) {
      ids.push(i)
      // Self weight: 1 for binary weights; for inverse distance, the row's strongest neighbour weight.
      values.push(inverse ? values.reduce((max, value) => Math.max(max, value), 0) || 1 : 1)
    }
    links += ids.length
    if (links > MAX_NEIGHBOR_LINKS) {
      throw new Error(`${toolName}: the spatial weights exceed ${MAX_NEIGHBOR_LINKS.toLocaleString()} neighbor links. Use a smaller distance threshold or K nearest neighbors.`)
    }
    const sorted = ids.map((_, position) => position).sort((a, b) => ids[a] - ids[b])
    const row = Float64Array.from(sorted, (position) => values[position])
    if (options.rowStandardize) {
      const total = row.reduce((sum, value) => sum + value, 0)
      if (total > 0) for (let position = 0; position < row.length; position += 1) row[position] /= total
    }
    neighbors.push(Int32Array.from(sorted, (position) => ids[position]))
    weights.push(row)
  }

  const label = conceptualizations.find((item) => item.value === conceptualization)!.label
  const parts = [label]
  if (knn) parts.push(`k = ${k}`)
  else if (threshold === null) parts.push('no distance threshold')
  else parts.push(`threshold ${fmt(threshold, 8)} m${defaulted ? ' (default: every feature has at least one neighbor)' : ''}`)
  if (options.distanceMethod === 'MANHATTAN') parts.push('Manhattan distance')
  if (options.rowStandardize) parts.push('row standardized')
  return { neighbors, weights, threshold, isolated, links, description: parts.join(', ') }
}
