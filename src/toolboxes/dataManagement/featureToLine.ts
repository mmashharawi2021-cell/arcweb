import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, LineString, MultiLineString } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'

/** Feature To Line: converts polygon boundaries (outer rings and holes) to line features. */
export const featureToLineTool: ToolboxTool = {
  id: 'feature-to-line',
  name: 'Feature To Line',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Convert polygon boundaries to line features, keeping attributes. Existing lines are copied unchanged.',
  keywords: ['boundary', 'outline', 'polygon to line', 'perimeter', 'convert'],
  parameters: [
    { id: 'target', label: 'Input layer (polygons or lines)', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Feature lines' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const lines: Feature<LineString | MultiLineString>[] = usableFeatures(layer).flatMap((feature) => {
      const geometry = feature.geometry
      const rings = geometry.type === 'Polygon' ? geometry.coordinates
        : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
          : geometry.type === 'LineString' ? [geometry.coordinates]
            : geometry.type === 'MultiLineString' ? geometry.coordinates
              : []
      const usable = rings.filter((ring) => ring.length > 1)
      if (!usable.length) return []
      return [{
        type: 'Feature' as const,
        properties: { ...(feature.properties ?? {}) },
        geometry: usable.length === 1
          ? { type: 'LineString' as const, coordinates: usable[0] }
          : { type: 'MultiLineString' as const, coordinates: usable },
      }]
    })
    assertHasFeatures(lines, 'Feature To Line needs polygon or line features; the input layer has none.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Lines`, featureCollection(lines))
    return { message: `${isolate(output.name)}: created ${lines.length.toLocaleString()} line features.`, layers: [output] }
  },
}
