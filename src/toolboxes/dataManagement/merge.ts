import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { getLayers, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, collectFields, fillSchema, renameCollidingFields } from '../spatial'
import type { ToolboxTool } from '../types'

/** Merge: appends the features of several layers of the same geometry type into one layer. */
export const mergeTool: ToolboxTool = {
  id: 'merge',
  name: 'Merge',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Combine multiple layers of the same geometry type into a single layer, keeping all attribute fields.',
  keywords: ['append', 'combine', 'layers', 'union all', 'stack'],
  parameters: [
    { id: 'inputs', label: 'Input layers (two or more)', kind: 'layers', required: true },
    {
      id: 'source', label: 'Add source field', kind: 'select', defaultValue: 'yes',
      options: [
        { value: 'yes', label: 'Yes — record each feature\'s source layer' },
        { value: 'no', label: 'No' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Merged layer' },
  ],
  execute: (context, parameters) => {
    const inputs = getLayers(context, parameters, 'inputs')
    if (inputs.length < 2) throw new Error('Choose at least two layers to merge.')
    const kinds = new Set(inputs.filter((layer) => layer.data.features.length).map((layer) => layer.geometry))
    if (kinds.size > 1 || kinds.has('Mixed')) {
      const summary = inputs.map((layer) => `${layer.name} (${layer.geometry})`).join(', ')
      throw new Error(`Merge needs layers of the same geometry type. Selected: ${summary}.`)
    }

    const allFields = collectFields(inputs.flatMap((layer) => layer.data.features))
    const addSource = getOptionalText(parameters, 'source') !== 'no'
    const sourceField = addSource ? renameCollidingFields(allFields, ['MERGE_SRC']).get('MERGE_SRC') ?? 'MERGE_SRC' : ''
    const features: Feature[] = inputs.flatMap((layer) => layer.data.features.map((feature) => ({
      type: 'Feature' as const,
      geometry: feature.geometry,
      properties: { ...(feature.properties ?? {}), ...(addSource ? { [sourceField]: layer.name } : {}) },
    })))
    assertHasFeatures(features, 'The selected layers contain no features.')

    const fields = addSource ? [...allFields, sourceField] : allFields
    const output = outputLayer(
      getOptionalText(parameters, 'outputName') || `${inputs[0].name} Merge`,
      featureCollection(fillSchema(features as Feature<NonNullable<Feature['geometry']>>[], fields)),
    )
    return {
      message: `${output.name}: merged ${features.length.toLocaleString()} features from ${inputs.length} layers.`,
      layers: [output],
    }
  },
}
