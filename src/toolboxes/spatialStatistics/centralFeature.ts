import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { detach } from '../spatial'
import type { ToolboxTool } from '../types'
import { distributionGroups, distributionNotes, localFrame, projectSites, tidy } from './_stats'
import { MAX_PAIRWISE_FEATURES, distanceFunction, readDistanceMethod } from './_weights'

/**
 * Central Feature: the feature with the smallest accumulated (weighted) distance to
 * every other feature in its case. Ties are all reported, as in ArcGIS.
 */
export const centralFeatureTool: ToolboxTool = {
  id: 'central-feature',
  name: 'Central Feature',
  category: 'Spatial Statistics',
  subcategory: 'Measuring Geographic Distributions',
  description: 'Identify the most centrally located feature: the one with the shortest total (weighted) distance to all other features.',
  keywords: ['center', 'centre', 'most central', 'medoid', 'central tendency', 'distribution'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    {
      id: 'distanceMethod', label: 'Distance method', kind: 'select', defaultValue: 'EUCLIDEAN',
      options: [{ value: 'EUCLIDEAN', label: 'Euclidean' }, { value: 'MANHATTAN', label: 'Manhattan' }],
    },
    { id: 'weightField', label: 'Weight field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Central feature' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const weightField = getOptionalText(parameters, 'weightField')
    const caseField = getOptionalText(parameters, 'caseField')
    const method = readDistanceMethod(parameters)
    const { groups, excluded, skippedCases } = distributionGroups(layer, { weightField, caseField, minimum: 1, toolName: 'Central Feature' })
    const largest = Math.max(...groups.map((group) => group.sites.length))
    if (largest > MAX_PAIRWISE_FEATURES) {
      throw new Error(`Central Feature compares every pair of features; a case has ${largest.toLocaleString()} features (limit ${MAX_PAIRWISE_FEATURES.toLocaleString()}).`)
    }

    const results: Feature<Geometry>[] = []
    for (const { sites } of groups) {
      const planar = projectSites(sites, localFrame(sites))
      const xs = Float64Array.from(planar, (site) => site.x)
      const ys = Float64Array.from(planar, (site) => site.y)
      const distance = distanceFunction(method, xs, ys)
      const totals = planar.map((_, i) => {
        let sum = 0
        for (let j = 0; j < planar.length; j += 1) if (j !== i) sum += planar[j].weight * distance(i, j)
        return sum
      })
      const best = Math.min(...totals)
      const tolerance = Math.max(1e-9, Math.abs(best) * 1e-12)
      planar.forEach((site, i) => {
        if (totals[i] - best <= tolerance) {
          results.push(detach(site.feature, { ...(site.feature.properties ?? {}), CF_ID: site.row + 1, CF_SumDist: tidy(totals[i]) }))
        }
      })
    }

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Central Feature`, featureCollection(results))
    output.pointRadius = 8
    return {
      message: `${output.name}: ${results.length === 1 ? `feature ${results[0].properties!.CF_ID} is the central feature` : `${results.length} central features across ${groups.length} case(s)`} (CF_SumDist = total ${weightField ? 'weighted ' : ''}distance in meters).${distributionNotes(excluded, skippedCases, 1)}`,
      layers: [output],
    }
  },
}
