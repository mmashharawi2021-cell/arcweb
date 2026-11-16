import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { outputLayer } from '../shared'
import { createTinTriangles, fieldParameter, getElevationSamples, getLayerField, outputNameParameter, THREE_D_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

export const createTinTool: ToolboxTool = {
  id: 'createTin',
  name: 'Create TIN',
  category: THREE_D_CATEGORY,
  subcategory: '3D Features',
  description: 'Build a Delaunay triangular irregular network from point elevations, with per-triangle elevation, slope and aspect.',
  keywords: ['tin', 'triangulation', 'elevation', 'slope', 'aspect', '3d'],
  parameters: [
    { id: 'points', label: 'Input point features', kind: 'layer', required: true },
    fieldParameter('elevationField', 'Elevation field', 'points'),
    outputNameParameter('TIN'),
  ],
  execute: (context, parameters) => {
    const { layer, field } = getLayerField(context, parameters, 'points', 'elevationField')
    const samples = getElevationSamples(layer, field)
    const triangles = createTinTriangles(samples)
    const features: Feature[] = triangles.map(({ vertices, slope, aspect }) => {
      const [a, b, c] = vertices
      return {
        type: 'Feature',
        properties: {
          elevation: (a.z + b.z + c.z) / 3,
          z1: a.z, z2: b.z, z3: c.z, slope, aspect,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z], [a.x, a.y, a.z],
          ]],
        },
      }
    })
    const name = typeof parameters.outputName === 'string' && parameters.outputName.trim() ? parameters.outputName.trim() : 'TIN'
    const output = outputLayer(name, featureCollection(features), layer.sourceCrs)
    output.fillColor = '#47b5a1'
    output.strokeColor = '#123b43'
    output.opacity = 0.8
    return { message: `${name}: created ${features.length} TIN triangles from ${samples.length} unique points.`, layers: [output] }
  },
}
