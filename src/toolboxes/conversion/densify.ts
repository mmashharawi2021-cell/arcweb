import { isolate } from '../../bidi'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { distanceMeters, interpolateGreatCircle } from './_utils'

const MAX_OUTPUT_VERTICES = 5_000_000

type Method = 'geodesic' | 'linear'

function interpolate(a: Position, b: Position, t: number, method: Method): Position {
  const [x, y] = method === 'geodesic' ? interpolateGreatCircle(a, b, t) : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return a.length > 2 && b.length > 2 ? [x, y, a[2] + (b[2] - a[2]) * t] : [x, y]
}

/**
 * Inserts vertices so that no segment is longer than `maxLength` metres. Original vertices are kept;
 * new ones are spaced evenly along each long segment (great circle or straight in lon/lat).
 */
export function densifyPositions(positions: Position[], maxLength: number, method: Method, budget: { added: number }): Position[] {
  if (positions.length < 2) return positions
  const output: Position[] = [positions[0]]
  for (let index = 1; index < positions.length; index += 1) {
    const a = positions[index - 1]
    const b = positions[index]
    const steps = Math.ceil(distanceMeters(a, b) / maxLength)
    for (let step = 1; step < steps; step += 1) output.push(interpolate(a, b, step / steps, method))
    budget.added += Math.max(0, steps - 1)
    if (budget.added > MAX_OUTPUT_VERTICES) {
      throw new Error(`Densify would add more than ${MAX_OUTPUT_VERTICES.toLocaleString()} vertices. Use a larger maximum segment length.`)
    }
    output.push(b)
  }
  return output
}

export function densifyGeometry(geometry: Geometry, maxLength: number, method: Method, budget: { added: number }): Geometry {
  const line = (positions: Position[]) => densifyPositions(positions, maxLength, method, budget)
  switch (geometry.type) {
    case 'LineString': return { type: 'LineString', coordinates: line(geometry.coordinates) }
    case 'MultiLineString': return { type: 'MultiLineString', coordinates: geometry.coordinates.map(line) }
    case 'Polygon': return { type: 'Polygon', coordinates: geometry.coordinates.map(line) }
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((rings) => rings.map(line)) }
    case 'GeometryCollection': return { type: 'GeometryCollection', geometries: geometry.geometries.map((child) => densifyGeometry(child, maxLength, method, budget)) }
    default: return geometry
  }
}

export const densifyTool: ToolboxTool = {
  id: 'densify',
  name: 'Densify',
  category: 'Conversion',
  subcategory: 'Cartography & Topology',
  description: 'Add vertices along line and polygon edges so that no segment is longer than a maximum distance. Use before projecting long edges.',
  keywords: ['densify', 'vertices', 'segment', 'great circle', 'geodesic', 'add vertex', 'distance'],
  parameters: [
    { id: 'target', label: 'Input features (lines or polygons)', kind: 'layer', required: true },
    { id: 'distance', label: 'Maximum segment length (metres)', kind: 'number', required: true, defaultValue: 100, min: 0.01, step: 10 },
    {
      id: 'method', label: 'Densification method', kind: 'select', defaultValue: 'geodesic',
      options: [
        { value: 'geodesic', label: 'Geodesic — follow the great circle' },
        { value: 'linear', label: 'Linear — straight in latitude/longitude' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Layer name + Densified' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const maxLength = getNumber(parameters, 'distance', 'maximum segment length')
    if (maxLength <= 0) throw new Error('The maximum segment length must be greater than zero.')
    const method: Method = getOptionalText(parameters, 'method') === 'linear' ? 'linear' : 'geodesic'
    const budget = { added: 0 }
    const features: Feature[] = layer.data.features.filter((feature) => feature.geometry).map((feature) => ({
      type: 'Feature',
      properties: { ...(feature.properties ?? {}) },
      geometry: densifyGeometry(feature.geometry, maxLength, method, budget),
    }))
    assertHasFeatures(features, 'The input layer has no features with geometry.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Densified`, { type: 'FeatureCollection', features }, layer.sourceCrs)
    const pointOnly = layer.geometry === 'Point'
    return {
      message: `${isolate(output.name)}: added ${budget.added.toLocaleString()} vertices to ${features.length.toLocaleString()} features.${pointOnly ? ' Points cannot be densified.' : ''}`,
      kind: pointOnly ? 'warning' : 'success',
      layers: [output],
    }
  },
}
