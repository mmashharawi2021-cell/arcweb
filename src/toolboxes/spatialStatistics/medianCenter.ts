import { featureCollection } from '@turf/helpers'
import type { Feature, Point } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { caseProperties, distributionGroups, distributionNotes, localFrame, projectSites, roundPosition } from './_stats'

const TOLERANCE_METRES = 1e-6
const MAX_ITERATIONS = 10_000

/**
 * Weiszfeld's algorithm for the (weighted) geometric median: the location that
 * minimizes the sum of Euclidean distances to all features.
 */
export function weiszfeld(points: { x: number; y: number; weight: number }[]): [number, number] {
  let total = 0
  let x = 0
  let y = 0
  for (const point of points) {
    total += point.weight
    x += point.weight * point.x
    y += point.weight * point.y
  }
  x /= total
  y /= total
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let sumX = 0
    let sumY = 0
    let sumW = 0
    let pullX = 0
    let pullY = 0
    let coincidentWeight = 0
    for (const point of points) {
      if (point.weight <= 0) continue
      const distance = Math.hypot(point.x - x, point.y - y)
      if (distance < 1e-9) {
        coincidentWeight += point.weight
        continue
      }
      const factor = point.weight / distance
      sumX += factor * point.x
      sumY += factor * point.y
      sumW += factor
      pullX += factor * (point.x - x)
      pullY += factor * (point.y - y)
    }
    // Sitting on a data point: it is the median when the other points' pull does not exceed its weight.
    if (sumW === 0 || (coincidentWeight > 0 && Math.hypot(pullX, pullY) <= coincidentWeight)) break
    const nextX = sumX / sumW
    const nextY = sumY / sumW
    const step = Math.hypot(nextX - x, nextY - y)
    x = nextX
    y = nextY
    if (step < TOLERANCE_METRES) break
  }
  return [x, y]
}

/** Median Center: the location minimizing the total distance to all features (Weiszfeld iteration). */
export const medianCenterTool: ToolboxTool = {
  id: 'median-center',
  name: 'Median Center',
  category: 'Spatial Statistics',
  subcategory: 'Measuring Geographic Distributions',
  description: 'Identify the location that minimizes the overall Euclidean distance to the features (geometric median), optionally weighted and grouped by case.',
  keywords: ['center', 'centre', 'geometric median', 'weiszfeld', 'central tendency', 'distribution'],
  parameters: [
    { id: 'target', label: 'Input feature class', kind: 'layer', required: true },
    { id: 'weightField', label: 'Weight field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Median center' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const weightField = getOptionalText(parameters, 'weightField')
    const caseField = getOptionalText(parameters, 'caseField')
    const { groups, excluded, skippedCases } = distributionGroups(layer, { weightField, caseField, minimum: 1, toolName: 'Median Center' })

    const centers: Feature<Point>[] = groups.map(({ caseValue, sites }) => {
      const frame = localFrame(sites)
      const [x, y] = weiszfeld(projectSites(sites, frame))
      const [lon, lat] = roundPosition(frame.toLonLat(x, y))
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { ...caseProperties(caseField, caseValue), XCoord: lon, YCoord: lat },
      }
    })

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Median Center`, featureCollection(centers))
    output.pointRadius = 8
    return {
      message: `${output.name}: ${centers.length === 1 ? `median center at ${centers[0].properties!.YCoord}, ${centers[0].properties!.XCoord}` : `${centers.length} median centers (one per case)`}.${distributionNotes(excluded, skippedCases, 1)}`,
      layers: [output],
    }
  },
}
