import { isolate } from '../../bidi'
import centroid from '@turf/centroid'
import { featureCollection } from '@turf/helpers'
import pointOnFeature from '@turf/point-on-feature'
import type { Feature, Point } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'

/** Feature To Point: one representative point per feature, carrying the feature's attributes. */
export const featureToPointTool: ToolboxTool = {
  id: 'feature-to-point',
  name: 'Feature To Point',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Create a point layer from the centroids of polygon, line or multipoint features.',
  keywords: ['centroid', 'center', 'label point', 'inside', 'convert'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    {
      id: 'location', label: 'Point location', kind: 'select', defaultValue: 'centroid',
      options: [
        { value: 'centroid', label: 'Centroid — geometric center (may fall outside the feature)' },
        { value: 'inside', label: 'Inside — guaranteed to lie on the feature' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Feature points' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const inside = getOptionalText(parameters, 'location') === 'inside'
    const points: Feature<Point>[] = usableFeatures(layer).map((feature) => ({
      type: 'Feature',
      properties: { ...(feature.properties ?? {}) },
      geometry: (inside ? pointOnFeature(feature) : centroid(feature)).geometry,
    }))
    assertHasFeatures(points, 'The input layer has no features with geometry.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Points`, featureCollection(points))
    return { message: `${isolate(output.name)}: created ${points.length.toLocaleString()} points.`, layers: [output] }
  },
}
