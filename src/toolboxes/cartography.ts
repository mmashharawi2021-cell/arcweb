import type { RendererConfig } from '../store'
import { calculateClassBreaks, sampleCategoricalRamp, sampleContinuousRamp } from '../symbology'
import type { ToolboxTool } from './types'
import { fieldNames, getLayer, getNumber, getText } from './shared'

function numericValues(values: unknown[]): number[] {
  const numbers = values.flatMap((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return [value]
    if (typeof value === 'string' && value.trim() !== '') {
      const number = Number(value)
      if (Number.isFinite(number)) return [number]
    }
    return []
  })
  if (numbers.length < 2) throw new Error('The selected field needs at least two numeric values.')
  return numbers
}

export const cartographyTools: ToolboxTool[] = [
  {
    id: 'single-symbol',
    name: 'Single Symbol',
    category: 'Cartography',
    description: 'Render every feature with the layer’s current symbol colors.',
    keywords: ['renderer', 'symbology', 'uniform'],
    parameters: [{ id: 'target', label: 'Input layer', kind: 'layer', required: true }],
    execute: (context, parameters) => {
      const layer = getLayer(context, parameters, 'target')
      return {
        message: `Applied single-symbol rendering to ${layer.name}.`,
        updates: [{ layerId: layer.id, updates: { renderer: { type: 'single' } } }],
      }
    },
  },
  {
    id: 'unique-values',
    name: 'Unique Values',
    category: 'Cartography',
    description: 'Assign distinct categorical colors from an attribute field.',
    keywords: ['renderer', 'categorical', 'thematic', 'categories'],
    parameters: [
      { id: 'target', label: 'Input layer', kind: 'layer', required: true },
      { id: 'field', label: 'Category field', kind: 'field', layerParameter: 'target', required: true },
    ],
    execute: (context, parameters) => {
      const layer = getLayer(context, parameters, 'target')
      const field = getText(parameters, 'field', 'a category field')
      const categories = [...new Set(layer.data.features.map((feature) => feature.properties?.[field]).filter((value) => value !== null && value !== undefined).map(String))]
      if (!categories.length) throw new Error(`Field "${field}" has no values to symbolize.`)
      if (categories.length > 100) throw new Error(`Field "${field}" has ${categories.length} unique values; choose a field with at most 100 categories.`)
      const palette = sampleCategoricalRamp('vivid', categories.length)
      const colors = Object.fromEntries(categories.map((category, index) => [category, palette[index]]))
      const renderer: RendererConfig = { type: 'unique', field, colors, ramp: 'vivid' }
      return {
        message: `Applied unique-value colors for ${categories.length} categories in ${layer.name}.`,
        updates: [{ layerId: layer.id, updates: { renderer } }],
      }
    },
  },
  {
    id: 'graduated-colors',
    name: 'Graduated Colors',
    category: 'Cartography',
    description: 'Classify numeric attributes with equal-interval, quantile, or natural-breaks intervals.',
    keywords: ['renderer', 'numeric', 'quantile', 'jenks', 'thematic'],
    parameters: [
      { id: 'target', label: 'Input layer', kind: 'layer', required: true },
      { id: 'field', label: 'Numeric field', kind: 'field', layerParameter: 'target', required: true },
      { id: 'method', label: 'Classification method', kind: 'select', required: true, defaultValue: 'quantile', options: [
        { value: 'equal-interval', label: 'Equal interval' },
        { value: 'quantile', label: 'Quantile' },
        { value: 'natural-breaks', label: 'Natural breaks (Jenks)' },
      ] },
      { id: 'classes', label: 'Number of classes', kind: 'number', required: true, defaultValue: 5, min: 2, max: 7, step: 1 },
    ],
    execute: (context, parameters) => {
      const layer = getLayer(context, parameters, 'target')
      const field = getText(parameters, 'field', 'a numeric field')
      if (!fieldNames(layer).includes(field)) throw new Error(`Field "${field}" does not exist on ${layer.name}.`)
      const values = numericValues(layer.data.features.map((feature) => feature.properties?.[field]))
      const requested = getNumber(parameters, 'classes', 'a class count')
      if (!Number.isInteger(requested) || requested < 2 || requested > 7) throw new Error('Class count must be an integer from 2 to 7.')
      const method = getText(parameters, 'method', 'a classification method')
      if (method !== 'equal-interval' && method !== 'quantile' && method !== 'natural-breaks') throw new Error('Choose a supported classification method.')
      const breaks = calculateClassBreaks(values, method, requested)
      const colors = sampleContinuousRamp('yl-or-rd', breaks.length + 1)
      const renderer: RendererConfig = { type: 'graduated', field, method, breaks, colors, ramp: 'yl-or-rd', classCount: requested }
      return {
        message: `Applied ${method === 'quantile' ? 'quantile' : 'natural breaks'} classification in ${layer.name}.`,
        updates: [{ layerId: layer.id, updates: { renderer } }],
      }
    },
  },
]
