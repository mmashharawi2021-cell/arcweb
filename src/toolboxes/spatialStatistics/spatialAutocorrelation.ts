import { isolate } from '../../bidi'
import { getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'
import { fmt, interpretPattern, statisticsTable, tidy, twoTailedP, valueSites } from './_stats'
import type { SpatialWeights } from './_weights'
import {
  buildWeights, conceptualizationParameter, distanceMethodParameter, neighborsParameter, readWeightsOptions,
  standardizationParameter, thresholdParameter, weightOf,
} from './_weights'

export interface MoranResult {
  index: number
  expected: number
  variance: number
  z: number
  p: number
}

/**
 * Global Moran's I with Esri's analytical moments:
 *   I = (n / S0) · ΣᵢΣⱼ wᵢⱼ zᵢ zⱼ / Σ zᵢ²,  E[I] = −1 / (n − 1),  V[I] = E[I²] − E[I]²
 *   E[I²] = (A − B) / C
 *   A = n[(n² − 3n + 3)S1 − nS2 + 3S0²],  B = D[(n² − n)S1 − 2nS2 + 6S0²],  C = (n − 1)(n − 2)(n − 3)S0²
 *   S1 = ½ ΣᵢΣⱼ (wᵢⱼ + wⱼᵢ)²,  S2 = Σᵢ (Σⱼ wᵢⱼ + Σⱼ wⱼᵢ)²
 * D is the sample kurtosis n·Σz⁴ / (Σz²)² (Cliff & Ord's b₂).
 */
export function globalMoran(values: number[], matrix: SpatialWeights): MoranResult {
  const n = values.length
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const z = values.map((value) => value - mean)
  let m2 = 0
  let m4 = 0
  for (const value of z) {
    m2 += value * value
    m4 += value ** 4
  }
  let s0 = 0
  let cross = 0
  let s1 = 0
  const rowSums = new Float64Array(n)
  const columnSums = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const neighbors = matrix.neighbors[i]
    const weights = matrix.weights[i]
    for (let position = 0; position < neighbors.length; position += 1) {
      const j = neighbors[position]
      const w = weights[position]
      if (j === i || w === 0) continue
      s0 += w
      rowSums[i] += w
      columnSums[j] += w
      cross += w * z[i] * z[j]
      const reverse = weightOf(matrix, j, i)
      s1 += (w + reverse) ** 2
      // Ordered pair (j, i) has no weight of its own: it still contributes (0 + wᵢⱼ)².
      if (reverse === 0) s1 += w * w
    }
  }
  if (s0 === 0) throw new Error('No feature has a neighbor with the chosen spatial relationships. Increase the distance threshold or number of neighbors.')
  s1 /= 2
  let s2 = 0
  for (let i = 0; i < n; i += 1) s2 += (rowSums[i] + columnSums[i]) ** 2

  const index = (n / s0) * (cross / m2)
  const expected = -1 / (n - 1)
  const kurtosis = (n * m4) / (m2 * m2)
  const a = n * ((n * n - 3 * n + 3) * s1 - n * s2 + 3 * s0 * s0)
  const b = kurtosis * ((n * n - n) * s1 - 2 * n * s2 + 6 * s0 * s0)
  const c = (n - 1) * (n - 2) * (n - 3) * s0 * s0
  const variance = (a - b) / c - expected * expected
  const z0 = variance > 0 ? (index - expected) / Math.sqrt(variance) : Number.NaN
  return { index, expected, variance, z: z0, p: twoTailedP(z0) }
}

export const spatialAutocorrelationTool: ToolboxTool = {
  id: 'spatial-autocorrelation',
  name: "Spatial Autocorrelation (Global Moran's I)",
  category: 'Spatial Statistics',
  subcategory: 'Analyzing Patterns',
  description: "Measure spatial autocorrelation from feature locations and values with Global Moran's I, reporting the index, expected index, variance, z-score, and p-value.",
  keywords: ['moran', "moran's i", 'global', 'autocorrelation', 'clustered', 'dispersed', 'random', 'pattern'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    { id: 'field', label: 'Input field', kind: 'field', layerParameter: 'target', required: true },
    conceptualizationParameter('INVERSE_DISTANCE'),
    distanceMethodParameter,
    standardizationParameter('ROW'),
    thresholdParameter,
    neighborsParameter,
    { id: 'outputName', label: 'Output table name', kind: 'text', placeholder: "Global Moran's I" },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const field = getText(parameters, 'field', 'an input field')
    const options = readWeightsOptions(parameters, { standardization: true, includeSelf: false })
    const { sites, excluded } = valueSites(layer, field, 4, 'Spatial Autocorrelation')
    const matrix = buildWeights(sites, options, 'Spatial Autocorrelation')
    const result = globalMoran(sites.map((site) => site.value), matrix)
    if (!Number.isFinite(result.z)) throw new Error("The variance of Moran's I is not positive for this data; the z-score cannot be computed.")
    const { pattern, sentence } = interpretPattern(result.z, result.p, 'Clustered')

    const table = statisticsTable(getOptionalText(parameters, 'outputName') || `${layer.name} Global Moran's I`, {
      Field: field,
      MoransI: tidy(result.index),
      ExpectedI: tidy(result.expected),
      Variance: tidy(result.variance),
      ZScore: tidy(result.z),
      PValue: tidy(result.p),
      Pattern: pattern,
      Features: sites.length,
      Weights: matrix.description,
    })
    const notes: string[] = []
    if (excluded) notes.push(`${excluded} feature(s) without a location or value were excluded`)
    if (matrix.isolated) notes.push(`${matrix.isolated} feature(s) have no neighbors`)
    return {
      message: `Global Moran's I (${isolate(field)}): I = ${fmt(result.index)}, expected I = ${fmt(result.expected)}, variance = ${fmt(result.variance)}, z-score = ${fmt(result.z, 4)}, p-value = ${fmt(result.p, 4)} → ${pattern}. ${sentence} [${matrix.description}; n = ${sites.length}]${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
      kind: matrix.isolated ? 'warning' : 'success',
      layers: [table],
    }
  },
}
