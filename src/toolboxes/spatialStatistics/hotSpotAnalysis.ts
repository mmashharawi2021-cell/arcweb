import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { RendererConfig } from '../../store'
import { getLayer, getOptionalText, getText, outputLayer } from '../shared'
import { detach } from '../spatial'
import type { ToolboxTool } from '../types'
import { confidenceBin, significanceCutoffs, tidy, twoTailedP, valueSites } from './_stats'
import type { SpatialWeights } from './_weights'
import {
  buildWeights, conceptualizationParameter, distanceMethodParameter, neighborsParameter, readWeightsOptions, thresholdParameter,
} from './_weights'

/** ArcGIS Pro hot spot colors keyed by Gi_Bin. */
export const hotSpotRenderer: RendererConfig = {
  type: 'unique',
  field: 'Gi_Bin',
  colors: {
    '-3': '#4575b5', '-2': '#849eba', '-1': '#c0ccbe', '0': '#ffffbf', '1': '#fab984', '2': '#ed7551', '3': '#d62f27',
  },
}

/**
 * Getis-Ord Gi* (Esri), with each feature included as its own neighbour:
 *   Gi* = (Σⱼ wᵢⱼxⱼ − X̄ Σⱼ wᵢⱼ) / (S √[(n Σⱼ wᵢⱼ² − (Σⱼ wᵢⱼ)²) / (n − 1)])
 *   X̄ = Σxⱼ / n,  S = √(Σxⱼ² / n − X̄²)
 * Gi* is itself a z-score.
 */
export function getisOrdGiStar(values: number[], matrix: SpatialWeights): number[] {
  const n = values.length
  const mean = values.reduce((sum, value) => sum + value, 0) / n
  const s = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / n - mean * mean)
  return values.map((_, i) => {
    let weighted = 0
    let sumW = 0
    let sumW2 = 0
    const neighbors = matrix.neighbors[i]
    const weights = matrix.weights[i]
    for (let position = 0; position < neighbors.length; position += 1) {
      const w = weights[position]
      weighted += w * values[neighbors[position]]
      sumW += w
      sumW2 += w * w
    }
    const denominator = s * Math.sqrt((n * sumW2 - sumW * sumW) / (n - 1))
    return denominator > 0 ? (weighted - mean * sumW) / denominator : 0
  })
}

export const hotSpotAnalysisTool: ToolboxTool = {
  id: 'hot-spot-analysis',
  name: 'Hot Spot Analysis (Getis-Ord Gi*)',
  category: 'Spatial Statistics',
  subcategory: 'Mapping Clusters',
  description: 'Identify statistically significant hot spots and cold spots with the Getis-Ord Gi* statistic. Adds GiZScore, GiPValue, and Gi_Bin (−3 to 3 at 99/95/90% confidence).',
  keywords: ['hot spot', 'hotspot', 'cold spot', 'getis', 'ord', 'gi*', 'gi star', 'cluster', 'local'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    { id: 'field', label: 'Input field', kind: 'field', layerParameter: 'target', required: true },
    conceptualizationParameter('FIXED_DISTANCE_BAND'),
    distanceMethodParameter,
    thresholdParameter,
    neighborsParameter,
    {
      id: 'fdr', label: 'Apply false discovery rate (FDR) correction', kind: 'select', defaultValue: 'no',
      options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Hot spots' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const field = getText(parameters, 'field', 'an input field')
    const fdr = getOptionalText(parameters, 'fdr') === 'yes'
    const options = readWeightsOptions(parameters, { standardization: false, includeSelf: true })
    const { sites, excluded } = valueSites(layer, field, 3, 'Hot Spot Analysis')
    const matrix = buildWeights(sites, options, 'Hot Spot Analysis')
    const zScores = getisOrdGiStar(sites.map((site) => site.value), matrix)
    const pValues = zScores.map(twoTailedP)
    const cutoffs = significanceCutoffs(pValues, fdr)
    const bins = zScores.map((z, i) => confidenceBin(z, pValues[i], cutoffs, fdr))

    const features = sites.map((site, i) => detach(site.feature, {
      ...(site.feature.properties ?? {}),
      SOURCE_ID: site.row + 1,
      GiZScore: tidy(zScores[i]),
      GiPValue: tidy(pValues[i]),
      NNeighbors: matrix.neighbors[i].length,
      Gi_Bin: bins[i],
    }))
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Hot Spots (${field})`, featureCollection(features))
    output.renderer = hotSpotRenderer
    output.strokeColor = '#6b6b6b'
    output.strokeWidth = 1
    output.opacity = 0.9

    const hot = bins.filter((bin) => bin > 0).length
    const cold = bins.filter((bin) => bin < 0).length
    const notes: string[] = []
    if (excluded) notes.push(`${excluded} feature(s) without a location or value were excluded`)
    if (matrix.isolated) notes.push(`${matrix.isolated} feature(s) have no neighbors`)
    if (sites.length < 30) notes.push('fewer than 30 features may give unreliable results')
    return {
      message: `${isolate(output.name)}: ${hot} hot spot and ${cold} cold spot feature(s) significant at ≥90% confidence${fdr ? ' (FDR corrected)' : ''} out of ${sites.length}. [${matrix.description}]${notes.length ? ` Note: ${notes.join('; ')}.` : ''}`,
      kind: notes.length ? 'warning' : 'success',
      layers: [output],
    }
  },
}
