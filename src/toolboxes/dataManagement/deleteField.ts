import type { FeatureCollection } from 'geojson'
import { fieldNames, getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'
import { parseFieldList } from './_utils'
import { isolate } from '../../bidi'

/** Delete Field: removes one or more attribute fields from every feature of the input layer. */
export const deleteFieldTool: ToolboxTool = {
  id: 'delete-field',
  name: 'Delete Field',
  category: 'Data Management',
  subcategory: 'Fields',
  description: 'Remove attribute fields and their values from every feature.',
  keywords: ['attributes', 'column', 'schema', 'remove', 'drop field'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'field', label: 'Field to delete', kind: 'field', layerParameter: 'target', required: true },
    { id: 'moreFields', label: 'Additional fields (optional)', kind: 'text', placeholder: 'Comma-separated, e.g. TEMP, OLD_ID' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const available = fieldNames(layer)
    const first = getText(parameters, 'field', 'a field')
    if (!available.includes(first)) throw new Error(`Field "${first}" does not exist.`)
    const fields = [...new Set([first, ...parseFieldList(getOptionalText(parameters, 'moreFields'), available)])]
    const doomed = new Set(fields)
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) }
        for (const field of fields) delete properties[field]
        return { ...feature, properties }
      }),
    }
    return {
      message: `Deleted ${fields.map((field) => `"${isolate(field)}"`).join(', ')} from ${isolate(layer.name)}.`,
      updates: [{
        layerId: layer.id,
        updates: {
          data,
          customFields: layer.customFields.filter((name) => !doomed.has(name)),
          labelField: doomed.has(layer.labelField) ? '' : layer.labelField,
          fieldAliases: Object.fromEntries(Object.entries(layer.fieldAliases ?? {}).filter(([name]) => !doomed.has(name))),
        },
      }],
    }
  },
}
