import type { Feature, Geometry, Point, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayer, getNumber } from '../shared'
import { assertHasFeatures, haversine, makeSpatialIndex } from '../spatial'
import type { ToolboxTool } from '../types'
import { downloadParameter, outputName, outputNameParameter, round, tableResult, type Row } from './_utils'

const MAX_ROWS = 200_000
const METERS_PER_DEGREE = 111_320

function points(layer: MapLayer, role: string) {
  const result: { feature: Feature<Point>; number: number }[] = []
  layer.data.features.forEach((feature, index) => {
    if (!feature.geometry) return
    if (feature.geometry.type !== 'Point') throw new Error(`Point Distance needs point features; the ${role} layer contains ${feature.geometry.type} geometry.`)
    result.push({ feature: feature as Feature<Point>, number: index + 1 })
  })
  assertHasFeatures(result, `The ${role} layer has no points.`)
  return result
}

/** A search rectangle around a position that is guaranteed to contain the radius circle. */
function searchBox(position: Position, radius: number): Feature<Geometry> {
  const dy = (radius / METERS_PER_DEGREE) * 1.01
  const dx = Math.min(180, dy / Math.max(0.01, Math.cos(Math.min(89.9, Math.abs(position[1]) + dy) * Math.PI / 180)))
  const [x, y] = position
  return {
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [[[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy], [x - dx, y - dy]]] },
  }
}

/**
 * Point Distance: a table of the geodesic distance between every input point and every
 * near point within the search radius (INPUT_FID, NEAR_FID, DISTANCE in metres).
 */
export const pointDistanceTool: ToolboxTool = {
  id: 'point-distance',
  name: 'Point Distance',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Compute the distances between all input points and all near points within a search radius, as a table.',
  keywords: ['distance', 'points', 'pairs', 'table', 'proximity', 'matrix'],
  parameters: [
    { id: 'target', label: 'Input features (points)', kind: 'layer', required: true },
    { id: 'near', label: 'Near features (points)', kind: 'layer', required: true },
    { id: 'radius', label: 'Search radius in meters (0 = unlimited)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
    downloadParameter,
    outputNameParameter('Point distance table'),
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const nearLayer = getLayer(context, parameters, 'near')
    const radius = parameters.radius === undefined || parameters.radius === '' ? 0 : getNumber(parameters, 'radius', 'search radius')
    if (radius < 0) throw new Error('The search radius cannot be negative.')
    const inputs = points(inputLayer, 'input')
    const nears = points(nearLayer, 'near')
    const sameLayer = inputLayer.id === nearLayer.id
    if (radius === 0 && inputs.length * nears.length > MAX_ROWS) {
      throw new Error(`Point Distance would produce more than ${MAX_ROWS.toLocaleString()} rows. Set a search radius.`)
    }
    const numbers = new Map(nears.map((item) => [item.feature, item.number]))
    const index = radius > 0 ? makeSpatialIndex(nears.map((item) => item.feature)) : null

    const rows: Row[] = []
    for (const input of inputs) {
      const position = input.feature.geometry.coordinates
      const candidates = index ? index.search(searchBox(position, radius)) : nears.map((item) => item.feature)
      const found: Row[] = []
      for (const near of candidates) {
        const nearNumber = numbers.get(near) ?? -1
        if (sameLayer && nearNumber === input.number) continue
        const distance = haversine(position, near.geometry.coordinates)
        if (radius > 0 && distance > radius) continue
        found.push({ INPUT_FID: input.number, NEAR_FID: nearNumber, DISTANCE: round(distance, 3) })
      }
      found.sort((a, b) => (a.NEAR_FID as number) - (b.NEAR_FID as number))
      rows.push(...found)
      if (rows.length > MAX_ROWS) throw new Error(`Point Distance exceeds ${MAX_ROWS.toLocaleString()} rows. Use a smaller search radius.`)
    }
    assertHasFeatures(rows, 'No point pairs fall within the search radius.')
    const { layer, downloads } = tableResult(parameters, outputName(parameters, `${inputLayer.name} PointDistance`), rows, ['INPUT_FID', 'NEAR_FID', 'DISTANCE'])
    return { message: `${layer.name}: ${rows.length.toLocaleString()} point pairs (DISTANCE in meters).`, layers: [layer], downloads }
  },
}
