import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { getLayer, outputLayer } from '../shared'
import {
  assertHasFeatures, collectFields, fillSchema, isPolygon, makeSpatialIndex, pairBudget, renameCollidingFields, renameProperties,
  type PolygonFeature,
} from '../spatial'
import type { ToolboxTool } from '../types'
import { outputName, outputNameParameter, subtractPolygons, type PolygonGeometry } from './_utils'

const FID_INPUT = 'FID_INPUT'
const FID_UPDATE = 'FID_UPDATE'

/** Symmetrical Difference: the areas covered by exactly one of the two polygon layers. */
export const symmetricalDifferenceTool: ToolboxTool = {
  id: 'symmetrical-difference',
  name: 'Symmetrical Difference',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Keep the portions of two polygon layers that do not overlap each other (exclusive or).',
  keywords: ['xor', 'exclusive', 'difference', 'overlay', 'polygon'],
  parameters: [
    { id: 'target', label: 'Input features (polygons)', kind: 'layer', required: true },
    { id: 'update', label: 'Update features (polygons)', kind: 'layer', required: true },
    outputNameParameter('Symmetrical difference output'),
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const updateLayer = getLayer(context, parameters, 'update')
    if (inputLayer.id === updateLayer.id) throw new Error('Choose two different polygon layers.')
    const inputs = inputLayer.data.features.filter(isPolygon)
    const updates = updateLayer.data.features.filter(isPolygon)
    assertHasFeatures(inputs, 'Symmetrical Difference requires polygon features in the input layer.')
    assertHasFeatures(updates, 'Symmetrical Difference requires polygon features in the update layer.')

    const inputFields = collectFields(inputs)
    const mapping = renameCollidingFields([FID_INPUT, FID_UPDATE, ...inputFields], collectFields(updates))
    const spend = pairBudget('Symmetrical Difference')
    const results: Feature<PolygonGeometry>[] = []
    const leftovers = (features: PolygonFeature[], others: PolygonFeature[], properties: (feature: PolygonFeature, position: number) => Record<string, unknown>) => {
      const index = makeSpatialIndex(others)
      features.forEach((feature, position) => {
        const candidates = index.search(feature)
        spend(candidates.length)
        const geometry = subtractPolygons(feature, candidates)
        if (geometry) results.push({ type: 'Feature', geometry, properties: properties(feature, position) })
      })
    }
    leftovers(inputs, updates, (feature, position) => ({ [FID_INPUT]: position + 1, ...(feature.properties ?? {}), [FID_UPDATE]: -1 }))
    leftovers(updates, inputs, (feature, position) => ({ [FID_INPUT]: -1, [FID_UPDATE]: position + 1, ...renameProperties(feature.properties, mapping) }))
    assertHasFeatures(results, 'The two layers cover exactly the same area; nothing is left.')
    const fields = [FID_INPUT, ...inputFields, FID_UPDATE, ...mapping.values()]
    const output = outputLayer(outputName(parameters, `${inputLayer.name} SymDiff`), featureCollection(fillSchema(results, fields)), inputLayer.sourceCrs)
    return { message: `${output.name}: ${results.length.toLocaleString()} non-overlapping polygon pieces.`, layers: [output] }
  },
}
