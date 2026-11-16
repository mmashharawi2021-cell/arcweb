import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { MapLayer } from '../../store'
import type { ToolboxTool } from '../types'

/** Copy Features: creates an independent output layer with the same features and attributes. */
export const copyFeaturesTool: ToolboxTool = {
  id: 'copy-features',
  name: 'Copy Features',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Copy features and their attributes to a new layer.',
  keywords: ['copy', 'duplicate', 'features', 'export'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Copied features' },
  ],
  execute: (context, parameters) => {
    const source = getLayer(context, parameters, 'target')
    const data = {
      ...source.data,
      features: source.data.features.map((feature) => ({
        ...feature,
        properties: feature.properties ? { ...feature.properties } : null,
        geometry: feature.geometry ? structuredClone(feature.geometry) : null,
      })),
    }
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${source.name} Copy`, data as MapLayer['data'], source.sourceCrs)
    output.customFields = [...(source.customFields ?? [])]
    return { message: `${output.name}: copied ${data.features.length.toLocaleString()} features.`, layers: [output] }
  },
}
