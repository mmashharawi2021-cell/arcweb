import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { getLayer, outputLayer } from '../shared'
import { assertHasFeatures, collectFields, fillSchema, isPolygon, makeSpatialIndex, pairBudget } from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPolygonGeometry, outputName, outputNameParameter, subtractPolygons, type PolygonGeometry } from './_utils'

/**
 * Update: replaces the parts of the input polygons covered by the update polygons with
 * the update polygons themselves. The output keeps the input schema; update features
 * carry their values for fields that also exist in the input.
 */
export const updateTool: ToolboxTool = {
  id: 'update',
  name: 'Update',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Replace the areas of input polygons that overlap the update polygons with the update polygons and their attributes.',
  keywords: ['replace', 'overlay', 'polygon', 'patch'],
  parameters: [
    { id: 'target', label: 'Input features (polygons)', kind: 'layer', required: true },
    { id: 'update', label: 'Update features (polygons)', kind: 'layer', required: true },
    outputNameParameter('Update output'),
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const updateLayer = getLayer(context, parameters, 'update')
    if (inputLayer.id === updateLayer.id) throw new Error('Choose a different update layer.')
    const inputs = inputLayer.data.features.filter(isPolygon)
    const updates = updateLayer.data.features.filter(isPolygon)
    assertHasFeatures(inputs, 'Update requires polygon features in the input layer.')
    assertHasFeatures(updates, 'Update requires polygon features in the update layer.')

    const index = makeSpatialIndex(updates)
    const spend = pairBudget('Update')
    const results: Feature<PolygonGeometry>[] = []
    for (const feature of inputs) {
      const candidates = index.search(feature)
      spend(candidates.length)
      const geometry = subtractPolygons(feature, candidates)
      if (geometry) results.push({ type: 'Feature', geometry, properties: { ...(feature.properties ?? {}) } })
    }
    for (const feature of updates) {
      const geometry = cleanPolygonGeometry(feature.geometry)
      if (geometry) results.push({ type: 'Feature', geometry, properties: { ...(feature.properties ?? {}) } })
    }
    assertHasFeatures(results, 'Update could not produce any polygon features.')
    const output = outputLayer(
      outputName(parameters, `${inputLayer.name} Update`),
      featureCollection(fillSchema(results, collectFields(inputs))),
      inputLayer.sourceCrs,
    )
    return { message: `${isolate(output.name)}: ${results.length.toLocaleString()} polygons (${updates.length.toLocaleString()} from the update layer).`, layers: [output] }
  },
}
