import { featureCollection } from '@turf/helpers'
import type { RendererConfig } from '../../store'
import { getLayer, getOptionalText, getText, outputLayer } from '../shared'
import { detach } from '../spatial'
import type { ToolboxTool } from '../types'
import { seededRandom, significanceCutoffs, tidy, twoTailedP, valueSites } from './_stats'
import type { SpatialWeights } from './_weights'
import {
  buildWeights, conceptualizationParameter, distanceMethodParameter, neighborsParameter, optionalNumber, readWeightsOptions,
  standardizationParameter, thresholdParameter,
} from './_weights'
import { isolate } from '../../bidi'

/** Largest number of neighbour draws (features × neighbours × permutations) for the permutation test. */
const MAX_PERMUTATION_WORK = 50_000_000

export const clusterOutlierRenderer: RendererConfig = {
  type: 'unique',
  field: 'COType',
  colors: { HH: '#d62f27', HL: '#f4a582', LH: '#92c5de', LL: '#4575b5', '': '#e8e8d8' },
}

/** Swaps two pool slots, keeping the feature → slot lookup in sync. */
function swap(pool: Int32Array, where: Int32Array, a: number, b: number) {
  const first = pool[a]
  const second = pool[b]
  pool[a] = second
  pool[b] = first
  where[second] = a
  where[first] = b
}

export interface LocalMoranResult {
  index: number[]
  z: number[]
  p: number[]
}

/**
 * Anselin Local Moran's I with Esri's analytical moments (neighbours exclude the feature itself):
 *   Iᵢ = (xᵢ − X̄) / Sᵢ² · Σⱼ wᵢⱼ (xⱼ − X̄),  Sᵢ² = Σⱼ≠ᵢ (xⱼ − X̄)² / (n − 1)
 *   E[Iᵢ] = −Σⱼ wᵢⱼ / (n − 1),  V[Iᵢ] = E[Iᵢ²] − E[Iᵢ]²,  E[Iᵢ²] = A − B
 *   A = (n − b₂ᵢ) Σⱼ wᵢⱼ² / (n − 1),  B = (2b₂ᵢ − n) Σₖ≠ₕ wᵢₖwᵢₕ / ((n − 1)(n − 2))
 *   b₂ᵢ = (n − 1) Σⱼ≠ᵢ (xⱼ − X̄)⁴ / (Σⱼ≠ᵢ (xⱼ − X̄)²)²  (kurtosis of the other values)
 * With `permutations` > 0 the p-value is a conditional-permutation pseudo p-value,
 * (R + 1) / (M + 1), drawn with a seeded RNG for reproducibility; the z-score stays analytical.
 */
export function localMoran(values: number[], matrix: SpatialWeights, permutations = 0, seed = 1): LocalMoranResult {
  const n = values.length
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const z = values.map((value) => value - mean)
  let total2 = 0
  let total4 = 0
  for (const value of z) {
    total2 += value * value
    total4 += value ** 4
  }
  const random = seededRandom(seed)
  const pool = Int32Array.from({ length: n }, (_, position) => position)
  const where = Int32Array.from(pool)
  const index: number[] = []
  const zScores: number[] = []
  const pValues: number[] = []
  for (let i = 0; i < n; i += 1) {
    const others2 = total2 - z[i] * z[i]
    const others4 = total4 - z[i] ** 4
    const s2 = others2 / (n - 1)
    let lag = 0
    let sumW = 0
    let sumW2 = 0
    const neighbors = matrix.neighbors[i]
    const weights = matrix.weights[i]
    const draws: number[] = []
    for (let position = 0; position < neighbors.length; position += 1) {
      const j = neighbors[position]
      if (j === i) continue
      const w = weights[position]
      lag += w * z[j]
      sumW += w
      sumW2 += w * w
      draws.push(w)
    }
    const value = s2 > 0 ? (z[i] / s2) * lag : 0
    const expected = -sumW / (n - 1)
    const b2 = others2 > 0 ? ((n - 1) * others4) / (others2 * others2) : 0
    const a = ((n - b2) * sumW2) / (n - 1)
    const b = ((2 * b2 - n) * (sumW * sumW - sumW2)) / ((n - 1) * (n - 2))
    const variance = a - b - expected * expected
    const zScore = variance > 0 ? (value - expected) / Math.sqrt(variance) : 0
    let p = twoTailedP(zScore)

    if (permutations > 0 && draws.length && s2 > 0) {
      // Conditional permutation: hold xᵢ fixed, redraw its neighbours' values from the other n − 1 features.
      // Park feature i in the last pool slot so draws come from the other n − 1 features.
      swap(pool, where, where[i], n - 1)
      const factor = z[i] / s2
      let permutedSum = 0
      const permuted = new Float64Array(permutations)
      for (let m = 0; m < permutations; m += 1) {
        let sum = 0
        for (let d = 0; d < draws.length; d += 1) {
          // Partial Fisher–Yates shuffle over the first n − 1 slots.
          swap(pool, where, d, d + Math.floor(random() * (n - 1 - d)))
          sum += draws[d] * z[pool[d]]
        }
        permuted[m] = factor * sum
        permutedSum += permuted[m]
      }
      const permutedMean = permutedSum / permutations
      let extreme = 0
      for (const sample of permuted) if (value >= permutedMean ? sample >= value : sample <= value) extreme += 1
      p = (extreme + 1) / (permutations + 1)
    }
    index.push(value)
    zScores.push(zScore)
    pValues.push(p)
  }
  return { index, z: zScores, p: pValues }
}

export const clusterOutlierAnalysisTool: ToolboxTool = {
  id: 'cluster-outlier-analysis',
  name: "Cluster and Outlier Analysis (Anselin Local Moran's I)",
  category: 'Spatial Statistics',
  subcategory: 'Mapping Clusters',
  description: "Identify statistically significant clusters (HH, LL) and spatial outliers (HL, LH) with Anselin Local Moran's I. Adds LMiIndex, LMiZScore, LMiPValue, and COType.",
  keywords: ['local moran', 'lisa', 'anselin', 'outlier', 'cluster', 'high-high', 'low-low', 'hot spot'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    { id: 'field', label: 'Input field', kind: 'field', layerParameter: 'target', required: true },
    conceptualizationParameter('INVERSE_DISTANCE'),
    distanceMethodParameter,
    standardizationParameter('ROW'),
    thresholdParameter,
    neighborsParameter,
    {
      id: 'fdr', label: 'Apply false discovery rate (FDR) correction', kind: 'select', defaultValue: 'no',
      options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
    },
    {
      id: 'permutations', label: 'Number of permutations (0 = analytical p-values)', kind: 'select', defaultValue: '0',
      options: ['0', '99', '199', '499', '999', '9999'].map((value) => ({ value, label: value })),
    },
    { id: 'seed', label: 'Random seed (permutations)', kind: 'number', defaultValue: 1, step: 1 },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Cluster and outlier' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const field = getText(parameters, 'field', 'an input field')
    const fdr = getOptionalText(parameters, 'fdr') === 'yes'
    const permutations = Math.floor(Number(getOptionalText(parameters, 'permutations') || '0'))
    if (!Number.isFinite(permutations) || permutations < 0) throw new Error('Choose a valid number of permutations.')
    const seed = optionalNumber(parameters, 'seed', 'random seed') ?? 1
    const options = readWeightsOptions(parameters, { standardization: true, includeSelf: false })
    const { sites, excluded } = valueSites(layer, field, 3, 'Cluster and Outlier Analysis')
    const matrix = buildWeights(sites, options, 'Cluster and Outlier Analysis')
    if (permutations > 0 && matrix.links * permutations > MAX_PERMUTATION_WORK) {
      throw new Error(`${permutations} permutations over ${matrix.links.toLocaleString()} neighbor links is too much work for the browser. Use fewer permutations, fewer neighbors, or analytical p-values.`)
    }
    const values = sites.map((site) => site.value)
    const result = localMoran(values, matrix, permutations, seed)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const cutoffs = significanceCutoffs(result.p, fdr)
    const significant = (p: number) => fdr ? p <= cutoffs.p95 : p < 0.05

    const types = sites.map((site, i) => {
      if (!significant(result.p[i]) || result.index[i] === 0) return ''
      const high = site.value > mean
      if (result.index[i] > 0) return high ? 'HH' : 'LL'
      return high ? 'HL' : 'LH'
    })
    const features = sites.map((site, i) => detach(site.feature, {
      ...(site.feature.properties ?? {}),
      SOURCE_ID: site.row + 1,
      LMiIndex: tidy(result.index[i]),
      LMiZScore: tidy(result.z[i]),
      LMiPValue: tidy(result.p[i]),
      NNeighbors: matrix.neighbors[i].length,
      COType: types[i],
    }))
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Cluster and Outlier (${field})`, featureCollection(features))
    output.renderer = clusterOutlierRenderer
    output.strokeColor = '#6b6b6b'
    output.strokeWidth = 1
    output.opacity = 0.9

    const count = (type: string) => types.filter((item) => item === type).length
    const notes: string[] = []
    if (excluded) notes.push(`${excluded} feature(s) without a location or value were excluded`)
    if (matrix.isolated) notes.push(`${matrix.isolated} feature(s) have no neighbors`)
    if (sites.length < 30) notes.push('fewer than 30 features may give unreliable results')
    return {
      message: `${isolate(output.name)}: HH ${count('HH')}, LL ${count('LL')}, HL ${count('HL')}, LH ${count('LH')} at 95% confidence${fdr ? ' (FDR corrected)' : ''}${permutations ? `, pseudo p-values from ${permutations} permutations (seed ${seed})` : ''}; ${count('')} not significant. [${matrix.description}]${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
      kind: notes.length ? 'warning' : 'success',
      layers: [output],
    }
  },
}
