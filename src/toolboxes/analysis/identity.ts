import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, outputLayer } from '../shared'
import {
  assertHasFeatures, collectFields, fillSchema, isPolygon, makeSpatialIndex, pairBudget, renameCollidingFields, renameProperties,
  usableFeatures,
} from '../spatial'
import type { ToolboxTool } from '../types'
import { outputName, outputNameParameter, overlayGeometry } from './_utils'

const FID_INPUT = 'FID_INPUT'
const FID_IDENTITY = 'FID_IDENTITY'

/**
 * Identity: keeps the full extent of the input features, split where identity polygons
 * overlap them. Overlapping pieces gain the identity attributes; the rest get FID_IDENTITY = -1.
 */
export const identityTool: ToolboxTool = {
  id: 'identity',
  name: 'Identity',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Split input features by identity polygons and add the identity attributes where they overlap, keeping all input areas.',
  keywords: ['overlay', 'split', 'attributes', 'polygon'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'identity', label: 'Identity features (polygons)', kind: 'layer', required: true },
    outputNameParameter('Identity output'),
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const identityLayer = getLayer(context, parameters, 'identity')
    if (inputLayer.id === identityLayer.id) throw new Error('Choose a different identity layer.')
    const inputs = usableFeatures(inputLayer)
    const identities = identityLayer.data.features.filter(isPolygon)
    assertHasFeatures(inputs, 'The input layer has no usable geometries.')
    assertHasFeatures(identities, 'The identity layer must contain polygon features.')

    const inputFields = collectFields(inputs)
    const mapping = renameCollidingFields([FID_INPUT, FID_IDENTITY, ...inputFields], collectFields(identities))
    const identityNumbers = new Map(identityLayer.data.features.map((feature, position) => [feature, position + 1]))
    const index = makeSpatialIndex(identities)
    const spend = pairBudget('Identity')
    const results: Feature<Geometry>[] = []

    inputLayer.data.features.forEach((feature, position) => {
      if (!feature.geometry) return
      const input = feature as Feature<Geometry>
      const base = { [FID_INPUT]: position + 1, ...(input.properties ?? {}) }
      const candidates = index.search(input)
      spend(candidates.length)
      for (const identity of candidates) {
        const geometry = overlayGeometry(input, [identity], 'inside')
        if (geometry) {
          results.push({
            type: 'Feature', geometry,
            properties: { ...base, [FID_IDENTITY]: identityNumbers.get(identity) ?? -1, ...renameProperties(identity.properties, mapping) },
          })
        }
      }
      const rest = overlayGeometry(input, candidates, 'outside')
      if (rest) results.push({ type: 'Feature', geometry: rest, properties: { ...base, [FID_IDENTITY]: -1 } })
    })
    assertHasFeatures(results, 'Identity could not produce any features.')
    const fields = [FID_INPUT, ...inputFields, FID_IDENTITY, ...mapping.values()]
    const output = outputLayer(outputName(parameters, `${inputLayer.name} Identity`), featureCollection(fillSchema(results, fields)), inputLayer.sourceCrs)
    return { message: `${isolate(output.name)}: ${results.length.toLocaleString()} features.`, layers: [output] }
  },
}
