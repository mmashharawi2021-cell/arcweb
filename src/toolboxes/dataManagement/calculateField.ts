import { isolate } from '../../bidi'
import { calculateField } from '../../fieldCalculator'
import { fieldNames, getLayer, getText } from '../shared'
import type { ToolboxTool } from '../types'

/** Calculate Field: evaluates a safe arithmetic/text expression for every feature. */
export const calculateFieldTool: ToolboxTool = {
  id: 'calculate-field',
  name: 'Calculate Field',
  category: 'Data Management',
  subcategory: 'Fields',
  description: 'Calculate numeric or text values using a safe field expression.',
  keywords: ['calculator', 'expression', 'attributes', 'math', 'field calculator'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'fieldName', label: 'Output field', kind: 'text', required: true },
    { id: 'expression', label: 'Expression', kind: 'text', required: true, placeholder: '[population] / [area]' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const fieldName = getText(parameters, 'fieldName', 'an output field')
    const expression = getText(parameters, 'expression', 'an expression')
    const data = calculateField(layer.data, fieldName, expression)
    const isExisting = fieldNames(layer).includes(fieldName)
    return {
      message: `Calculated "${isolate(fieldName)}" for ${data.features.length.toLocaleString()} features.`,
      updates: [{
        layerId: layer.id,
        updates: { data, customFields: isExisting ? layer.customFields : [...layer.customFields, fieldName] },
      }],
    }
  },
}
