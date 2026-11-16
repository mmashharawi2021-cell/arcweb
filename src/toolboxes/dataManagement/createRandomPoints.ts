import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { featureCollection } from '@turf/helpers'
import type { Feature, Point, Position } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { geometryBBox, haversine, isPolygon } from '../spatial'
import type { PolygonFeature } from '../spatial'
import type { ToolboxTool } from '../types'
import { collectionBBox, METERS_PER_DEGREE, optionalNumber, outputNameParameter } from './_utils'

const MAX_POINTS = 100_000

/** Grid hash so the minimum-distance test only checks neighbouring cells instead of every placed point. */
function distanceGuard(minimum: number) {
  const cells = new Map<string, Position[]>()
  const size = minimum / METERS_PER_DEGREE
  const cell = (value: number) => Math.floor(value / size)
  return {
    accepts(position: Position): boolean {
      if (minimum <= 0) return true
      // Longitude cells shrink towards the poles, so widen the longitude search accordingly.
      const reach = Math.ceil(1 / Math.max(Math.cos((position[1] * Math.PI) / 180), 0.01))
      const [cx, cy] = [cell(position[0]), cell(position[1])]
      for (let x = cx - reach; x <= cx + reach; x += 1) {
        for (let y = cy - 1; y <= cy + 1; y += 1) {
          for (const other of cells.get(`${x}:${y}`) ?? []) if (haversine(position, other) < minimum) return false
        }
      }
      return true
    },
    add(position: Position) {
      if (minimum <= 0) return
      const key = `${cell(position[0])}:${cell(position[1])}`
      const list = cells.get(key)
      if (list) list.push(position)
      else cells.set(key, [position])
    },
  }
}

/** Create Random Points: randomly placed points inside constraining polygons or within a layer's extent. */
export const createRandomPointsTool: ToolboxTool = {
  id: 'create-random-points',
  name: 'Create Random Points',
  category: 'Data Management',
  subcategory: 'Sampling',
  description: 'Generate random points inside each polygon of a constraining layer, or within a layer\'s extent, with an optional minimum distance between points.',
  keywords: ['random', 'sample', 'sampling', 'points', 'stochastic', 'survey'],
  parameters: [
    { id: 'constraint', label: 'Constraining layer', kind: 'layer', required: true },
    {
      id: 'mode', label: 'Constrain to', kind: 'select', defaultValue: 'FEATURES',
      options: [
        { value: 'FEATURES', label: 'Each polygon (count per polygon)' },
        { value: 'EXTENT', label: 'Layer extent (count in total)' },
      ],
    },
    { id: 'count', label: 'Number of points', kind: 'number', required: true, min: 1, step: 1, defaultValue: 10 },
    { id: 'minDistance', label: 'Minimum allowed distance (m)', kind: 'number', min: 0, defaultValue: 0 },
    outputNameParameter('Random points'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'constraint')
    const count = Math.round(getNumber(parameters, 'count', 'number of points'))
    if (count < 1) throw new Error('The number of points must be at least 1.')
    const minimum = optionalNumber(parameters, 'minDistance', 'minimum distance') ?? 0
    if (minimum < 0) throw new Error('The minimum distance cannot be negative.')
    const polygons = layer.data.features.filter(isPolygon) as PolygonFeature[]
    const byFeature = (getOptionalText(parameters, 'mode') || 'FEATURES') === 'FEATURES' && polygons.length > 0

    const areas: { bbox: [number, number, number, number]; polygon: PolygonFeature | null; cid: number }[] = byFeature
      ? polygons.map((polygon, index) => ({ bbox: geometryBBox(polygon.geometry), polygon, cid: index + 1 }))
      : (() => {
        const bbox = collectionBBox(layer.data.features)
        if (!bbox) throw new Error('The constraining layer has no features with geometry.')
        return [{ bbox, polygon: null, cid: 1 }]
      })()
    if (areas.length * count > MAX_POINTS) throw new Error(`That would create ${(areas.length * count).toLocaleString()} points (limit ${MAX_POINTS.toLocaleString()}).`)

    const guard = distanceGuard(minimum)
    const points: Feature<Point>[] = []
    let shortfall = 0
    for (const { bbox, polygon, cid } of areas) {
      let placed = 0
      for (let attempt = 0; placed < count && attempt < count * 500; attempt += 1) {
        const position: Position = [bbox[0] + Math.random() * (bbox[2] - bbox[0]), bbox[1] + Math.random() * (bbox[3] - bbox[1])]
        if (polygon && !booleanPointInPolygon(position, polygon)) continue
        if (!guard.accepts(position)) continue
        guard.add(position)
        points.push({ type: 'Feature', properties: { CID: cid }, geometry: { type: 'Point', coordinates: position } })
        placed += 1
      }
      shortfall += count - placed
    }
    if (!points.length) throw new Error('No points could be placed; the constraining areas may be too small for the minimum distance.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Random Points`, featureCollection(points))
    return {
      message: `${output.name}: created ${points.length.toLocaleString()} random points${byFeature ? ` in ${areas.length.toLocaleString()} polygons` : ' within the layer extent'}.${shortfall ? ` ${shortfall} points could not be placed while honouring the minimum distance.` : ''}`,
      kind: shortfall ? 'warning' : 'success',
      layers: [output],
    }
  },
}
