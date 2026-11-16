import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Point } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { caseProperties, distributionGroups, distributionNotes, localFrame, projectSites, roundPosition, tidy } from './_stats'

/** Mean Center: the (weighted) average location of the features, one point per case. */
export const meanCenterTool: ToolboxTool = {
  id: 'mean-center',
  name: 'Mean Center',
  category: 'Spatial Statistics',
  subcategory: 'Measuring Geographic Distributions',
  description: 'Identify the geographic center (center of concentration) of a set of features, optionally weighted and grouped by case.',
  keywords: ['center', 'centre', 'average location', 'centroid', 'central tendency', 'distribution'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    { id: 'weightField', label: 'Weight field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'dimensionField', label: 'Dimension field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Mean center' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const weightField = getOptionalText(parameters, 'weightField')
    const caseField = getOptionalText(parameters, 'caseField')
    const dimensionField = getOptionalText(parameters, 'dimensionField')
    const { groups, excluded, skippedCases } = distributionGroups(layer, { weightField, caseField, extraField: dimensionField, minimum: 1, toolName: 'Mean Center' })

    const centers: Feature<Point>[] = groups.map(({ caseValue, sites }) => {
      const frame = localFrame(sites)
      const planar = projectSites(sites, frame)
      let total = 0
      let x = 0
      let y = 0
      let z = 0
      for (const site of planar) {
        total += site.weight
        x += site.weight * site.x
        y += site.weight * site.y
        z += site.weight * (site.extra ?? 0)
      }
      const [lon, lat] = roundPosition(frame.toLonLat(x / total, y / total))
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          ...caseProperties(caseField, caseValue),
          XCoord: lon,
          YCoord: lat,
          ...(dimensionField ? { ZCoord: tidy(z / total) } : {}),
        },
      }
    })

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Mean Center`, featureCollection(centers))
    output.pointRadius = 8
    return {
      message: `${isolate(output.name)}: ${centers.length === 1 ? `mean center at ${centers[0].properties!.YCoord}, ${centers[0].properties!.XCoord}` : `${centers.length} mean centers (one per case)`}.${distributionNotes(excluded, skippedCases, 1)}`,
      layers: [output],
    }
  },
}
