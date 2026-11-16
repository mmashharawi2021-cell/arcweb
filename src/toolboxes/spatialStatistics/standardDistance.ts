import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { caseProperties, distributionGroups, distributionNotes, localFrame, planarPolygon, projectSites, roundPosition, tidy } from './_stats'

/**
 * Standard distance (Esri): SD = √(Σw(x − X̄w)² / Σw + Σw(y − Ȳw)² / Σw), drawn as a circle
 * about the (weighted) mean center with radius = SD × the chosen number of standard deviations.
 */
export function standardDistance(points: { x: number; y: number; weight: number }[]) {
  let total = 0
  let centerX = 0
  let centerY = 0
  for (const point of points) {
    total += point.weight
    centerX += point.weight * point.x
    centerY += point.weight * point.y
  }
  centerX /= total
  centerY /= total
  let spread = 0
  for (const point of points) spread += point.weight * ((point.x - centerX) ** 2 + (point.y - centerY) ** 2)
  return { centerX, centerY, distance: Math.sqrt(spread / total) }
}

export const standardDistanceTool: ToolboxTool = {
  id: 'standard-distance',
  name: 'Standard Distance',
  category: 'Spatial Statistics',
  subcategory: 'Measuring Geographic Distributions',
  description: 'Measure how compactly features are distributed around their mean center, drawn as a circle with the standard distance radius.',
  keywords: ['dispersion', 'spread', 'compactness', 'circle', 'standard deviation', 'distribution'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    {
      id: 'size', label: 'Circle size', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '1 standard deviation' }, { value: '2', label: '2 standard deviations' }, { value: '3', label: '3 standard deviations' }],
    },
    { id: 'weightField', label: 'Weight field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Standard distance' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const weightField = getOptionalText(parameters, 'weightField')
    const caseField = getOptionalText(parameters, 'caseField')
    const size = Number(getOptionalText(parameters, 'size') || '1')
    if (![1, 2, 3].includes(size)) throw new Error('Choose a circle size of 1, 2, or 3 standard deviations.')
    const { groups, excluded, skippedCases } = distributionGroups(layer, { weightField, caseField, minimum: 2, toolName: 'Standard Distance' })

    const circles: Feature<Polygon>[] = []
    for (const { caseValue, sites } of groups) {
      const frame = localFrame(sites)
      const result = standardDistance(projectSites(sites, frame))
      if (!(result.distance > 0)) continue
      const radius = size * result.distance
      const [lon, lat] = roundPosition(frame.toLonLat(result.centerX, result.centerY))
      circles.push({
        type: 'Feature',
        geometry: planarPolygon(frame, (angle) => [result.centerX + radius * Math.cos(angle), result.centerY + radius * Math.sin(angle)]),
        properties: { ...caseProperties(caseField, caseValue), CenterX: lon, CenterY: lat, StdDist: tidy(radius) },
      })
    }
    if (!circles.length) throw new Error('All features share one location, so the standard distance is zero.')

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Standard Distance`, featureCollection(circles))
    output.opacity = 0.35
    return {
      message: `${isolate(output.name)}: ${circles.length === 1 ? `standard distance ${circles[0].properties!.StdDist} m (${size} std. dev.)` : `${circles.length} circles (one per case, ${size} std. dev.)`}.${distributionNotes(excluded, skippedCases, 2)}`,
      layers: [output],
    }
  },
}
