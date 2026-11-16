import type { FeatureCollection } from 'geojson'
import { fieldNames, getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'

const FIELD_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u

/** Add Field: adds an attribute field (with an optional default value) to every feature of the input layer. */
export const addFieldTool: ToolboxTool = {
  id: 'add-field',
  name: 'Add Field',
  category: 'Data Management',
  subcategory: 'Fields',
  description: 'Add a new attribute field to a layer, optionally filled with a default value.',
  keywords: ['attributes', 'column', 'schema', 'new field'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'fieldName', label: 'Field name', kind: 'text', required: true },
    {
      id: 'fieldType', label: 'Field type', kind: 'select', defaultValue: 'TEXT',
      options: [
        { value: 'TEXT', label: 'Text' },
        { value: 'DOUBLE', label: 'Double (decimal number)' },
        { value: 'LONG', label: 'Long (integer)' },
      ],
    },
    { id: 'defaultValue', label: 'Default value', kind: 'text', placeholder: 'Blank by default' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const fieldName = getText(parameters, 'fieldName', 'a field name')
    if (!FIELD_NAME.test(fieldName)) {
      throw new Error(`"${fieldName}" is not a valid field name. Use letters, digits and underscores, starting with a letter or underscore.`)
    }
    if (fieldNames(layer).some((name) => name.toLowerCase() === fieldName.toLowerCase())) {
      throw new Error(`A field named "${fieldName}" already exists.`)
    }
    const type = getOptionalText(parameters, 'fieldType') || 'TEXT'
    const raw = getOptionalText(parameters, 'defaultValue')
    let defaultValue: string | number | null = raw
    if (type !== 'TEXT') {
      if (!raw) defaultValue = null
      else {
        const number = Number(raw)
        if (!Number.isFinite(number)) throw new Error(`The default value "${raw}" is not a number.`)
        if (type === 'LONG' && !Number.isInteger(number)) throw new Error(`The default value "${raw}" is not an integer.`)
        defaultValue = number
      }
    }
    const data: FeatureCollection = {
      ...layer.data,
      features: layer.data.features.map((feature) => ({
        ...feature,
        properties: { ...(feature.properties ?? {}), [fieldName]: defaultValue },
      })),
    }
    return {
      message: `Added "${fieldName}" (${type}) to ${layer.name}.`,
      updates: [{ layerId: layer.id, updates: { data, customFields: [...layer.customFields, fieldName] } }],
    }
  },
}
