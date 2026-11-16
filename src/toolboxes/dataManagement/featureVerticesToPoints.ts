import { isolate } from '../../bidi'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { Feature, Geometry, Position } from 'geojson'
import type { ToolboxTool } from '../types'

type VertexMode = 'ALL' | 'START' | 'END' | 'MID'

function paths(geometry: Geometry): Position[][] {
  switch (geometry.type) {
    case 'Point': return [[geometry.coordinates]]
    case 'MultiPoint': return geometry.coordinates.map((position) => [position])
    case 'LineString': return [geometry.coordinates]
    case 'MultiLineString': return geometry.coordinates
    case 'Polygon': return geometry.coordinates
    case 'MultiPolygon': return geometry.coordinates.flat()
    case 'GeometryCollection': return geometry.geometries.flatMap(paths)
  }
}

function midpoint(path: Position[]): Position | null {
  if (!path.length) return null
  const distances = path.slice(1).map((position, index) => Math.hypot(position[0] - path[index][0], position[1] - path[index][1]))
  const total = distances.reduce((sum, distance) => sum + distance, 0)
  if (!total) return path[0]
  let remaining = total / 2
  for (let index = 0; index < distances.length; index += 1) {
    if (remaining <= distances[index]) {
      const ratio = remaining / distances[index]
      return path[index].map((coordinate, ordinate) => coordinate + ((path[index + 1][ordinate] ?? coordinate) - coordinate) * ratio)
    }
    remaining -= distances[index]
  }
  return path[path.length - 1]
}

/** Feature Vertices To Points: generate point features at vertices or path endpoints/midpoints. */
export const featureVerticesToPointsTool: ToolboxTool = {
  id: 'feature-vertices-to-points',
  name: 'Feature Vertices To Points',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Create points at every vertex, path start/end, or path midpoint.',
  keywords: ['vertices', 'points', 'start', 'end', 'midpoint', 'convert'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    {
      id: 'pointLocation', label: 'Point location', kind: 'select', defaultValue: 'ALL',
      options: [
        { value: 'ALL', label: 'All vertices' },
        { value: 'START', label: 'Start of each part' },
        { value: 'END', label: 'End of each part' },
        { value: 'MID', label: 'Midpoint of each part' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Feature vertices' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const mode = (getOptionalText(parameters, 'pointLocation') || 'ALL').toUpperCase() as VertexMode
    if (!['ALL', 'START', 'END', 'MID'].includes(mode)) throw new Error(`Unknown point location: ${mode}.`)
    const features: Feature[] = []
    layer.data.features.forEach((feature, featureIndex) => {
      if (!feature.geometry) return
      paths(feature.geometry).forEach((path, partIndex) => {
        const vertices = path.length > 1 && path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1]
          ? path.slice(0, -1) : path
        const positions = mode === 'ALL' ? vertices
          : mode === 'START' ? vertices.slice(0, 1)
            : mode === 'END' ? vertices.slice(-1)
              : [midpoint(vertices)].filter((position): position is Position => position !== null)
        positions.forEach((position, vertexIndex) => features.push({
          type: 'Feature',
          properties: { ...(feature.properties ?? {}), ORIG_FID: featureIndex + 1, PART_ID: partIndex + 1, VERTEX_ID: vertexIndex + 1 },
          geometry: { type: 'Point', coordinates: [...position] },
        }))
      })
    })
    if (!features.length) throw new Error('The input layer has no usable geometry vertices.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Vertices`, { type: 'FeatureCollection', features }, layer.sourceCrs)
    output.customFields = [...new Set([...(layer.customFields ?? []), 'ORIG_FID', 'PART_ID', 'VERTEX_ID'])]
    return { message: `${isolate(output.name)}: created ${features.length.toLocaleString()} points.`, layers: [output] }
  },
}
