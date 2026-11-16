import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { outputNameParameter } from './_utils'

/** Feature Class To Feature Class: copies a layer, optionally keeping only records with a given field value. */
export const featureClassToFeatureClassTool: ToolboxTool = {
  id: 'feature-class-to-feature-class',
  name: 'Feature Class To Feature Class',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Copy a layer, optionally retaining only records matching a field value.',
  keywords: ['copy', 'subset', 'filter', 'export', 'export features'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'field', label: 'Filter field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'value', label: 'Exact value (optional)', kind: 'text', placeholder: 'Leave blank to copy all records' },
    outputNameParameter('Output features'),
  ],
  execute: (context, parameters) => {
    const source = getLayer(context, parameters, 'target')
    const field = getOptionalText(parameters, 'field')
    const value = getOptionalText(parameters, 'value')
    const features = field
      ? source.data.features.filter((feature) => String(feature.properties?.[field] ?? '') === value)
      : source.data.features
    if (!features.length) throw new Error(field ? 'No features match the selected field value.' : 'The input layer has no features to copy.')
    const name = getOptionalText(parameters, 'outputName') || `${source.name} copy`
    const copies = features.map((feature) => ({ type: 'Feature' as const, properties: { ...(feature.properties ?? {}) }, geometry: feature.geometry }))
    const output = outputLayer(name, featureCollection(copies), source.sourceCrs)
    return { message: `${isolate(name)}: copied ${features.length.toLocaleString()} features.`, layers: [output] }
  },
}
