import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Point, Position } from 'geojson'
import { fieldNames, getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, haversine, renameCollidingFields } from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPath, outputNameParameter, yesNoParameter } from './_utils'

const MAX_POINTS = 500_000

/** Positions at the given ascending distances (m) along a path, walking the segments once. */
export function positionsAlong(path: Position[], distances: number[]): Position[] {
  const result: Position[] = []
  let segment = 1
  let start = 0
  let segmentLength = haversine(path[0], path[1])
  for (const distance of distances) {
    while (segment < path.length - 1 && distance > start + segmentLength) {
      start += segmentLength
      segment += 1
      segmentLength = haversine(path[segment - 1], path[segment])
    }
    const t = segmentLength > 0 ? Math.min(1, Math.max(0, (distance - start) / segmentLength)) : 0
    const [a, b] = [path[segment - 1], path[segment]]
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return result
}

/** Generate Points Along Lines: points at a fixed distance or percentage along every line (or polygon boundary). */
export const generatePointsAlongLinesTool: ToolboxTool = {
  id: 'generate-points-along-lines',
  name: 'Generate Points Along Lines',
  category: 'Data Management',
  subcategory: 'Sampling',
  description: 'Create points at regular intervals along lines or polygon boundaries, by distance (m) or by percentage of each line\'s length, optionally including end points.',
  keywords: ['interval', 'stations', 'chainage', 'densify', 'sample', 'along', 'equal distance'],
  parameters: [
    { id: 'target', label: 'Input line or polygon layer', kind: 'layer', required: true },
    {
      id: 'placement', label: 'Point placement', kind: 'select', defaultValue: 'DISTANCE',
      options: [{ value: 'DISTANCE', label: 'By distance (m)' }, { value: 'PERCENTAGE', label: 'By percentage of length' }],
    },
    { id: 'value', label: 'Distance (m) or percentage', kind: 'number', required: true, min: 0, defaultValue: 100 },
    yesNoParameter('endPoints', 'Include end points', 'no', 'Yes — add start and end points', 'No'),
    outputNameParameter('Points along lines'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const byPercent = getOptionalText(parameters, 'placement') === 'PERCENTAGE'
    const value = getNumber(parameters, 'value', byPercent ? 'percentage' : 'distance')
    if (value <= 0 || (byPercent && value > 100)) throw new Error(byPercent ? 'The percentage must be between 0 and 100.' : 'The distance must be greater than zero.')
    const endPoints = getOptionalText(parameters, 'endPoints') === 'yes'
    const origField = renameCollidingFields(fieldNames(layer), ['ORIG_FID']).get('ORIG_FID') ?? 'ORIG_FID'

    const points: Feature<Point>[] = []
    let sources = 0
    layer.data.features.forEach((feature, index) => {
      const geometry = feature.geometry
      if (!geometry) return
      const paths: Position[][] = geometry.type === 'LineString' ? [geometry.coordinates]
        : geometry.type === 'MultiLineString' || geometry.type === 'Polygon' ? geometry.coordinates
          : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : []
      const usable = paths.map(cleanPath).filter((path) => path.length > 1)
      if (usable.length) sources += 1
      for (const path of usable) {
        let total = 0
        for (let vertex = 1; vertex < path.length; vertex += 1) total += haversine(path[vertex - 1], path[vertex])
        const step = byPercent ? (total * value) / 100 : value
        const distances: number[] = endPoints ? [0] : []
        if (step > 0) {
          const intervals = Math.floor(total / step + 1e-9)
          if (points.length + intervals > MAX_POINTS) throw new Error(`More than ${MAX_POINTS.toLocaleString()} points would be created. Use a larger distance.`)
          for (let k = 1; k <= intervals; k += 1) {
            const distance = k * step
            if (distance < total - 1e-6) distances.push(distance)
          }
        }
        if (endPoints) distances.push(total)
        positionsAlong(path, distances).forEach((position, order) => {
          const distance = distances[order]
          points.push({ type: 'Feature', properties: { ...(feature.properties ?? {}), [origField]: index + 1, DISTANCE_M: Number(distance.toFixed(3)) }, geometry: { type: 'Point', coordinates: position } })
        })
      }
    })
    if (!sources) throw new Error('Generate Points Along Lines needs line or polygon features.')
    assertHasFeatures(points, 'The lines are shorter than the interval; enable end points or use a smaller distance.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Points Along`, featureCollection(points), layer.sourceCrs)
    return { message: `${isolate(output.name)}: created ${points.length.toLocaleString()} points along ${sources.toLocaleString()} features.`, layers: [output] }
  },
}
