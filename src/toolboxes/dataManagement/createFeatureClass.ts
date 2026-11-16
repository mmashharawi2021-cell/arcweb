import { getOptionalText, getText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'

const FIELD_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u

function parseFields(text: string): string[] {
  if (!text.trim()) return []
  const names: string[] = []
  for (const definition of text.split(',')) {
    const match = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*$/u.exec(definition)
    if (!match || !FIELD_NAME.test(match[1])) throw new Error(`Invalid field name "${definition}". Use comma-separated field names; field types are not represented by the current layer schema.`)
    if (names.some((name) => name.toLowerCase() === match[1].toLowerCase())) throw new Error(`Field "${match[1]}" is listed more than once.`)
    names.push(match[1])
  }
  return names
}

/** Create Feature Class: create a new empty layer with an optional attribute schema. */
export const createFeatureClassTool: ToolboxTool = {
  id: 'create-feature-class',
  name: 'Create Feature Class',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Create an empty layer and define its attribute fields.',
  keywords: ['create', 'feature class', 'new layer', 'schema', 'fields'],
  parameters: [
    { id: 'name', label: 'Feature class name', kind: 'text', required: true },
    {
      id: 'geometryType', label: 'Geometry type', kind: 'select', defaultValue: 'Point',
      options: [
        { value: 'Point', label: 'Point' },
        { value: 'Line', label: 'Line' },
        { value: 'Polygon', label: 'Polygon' },
      ],
    },
    { id: 'fields', label: 'Fields (optional; comma-separated names)', kind: 'text', placeholder: 'NAME, POPULATION' },
  ],
  execute: (_context, parameters) => {
    const name = getText(parameters, 'name', 'a feature class name')
    const fields = parseFields(getOptionalText(parameters, 'fields'))
    const geometryType = getOptionalText(parameters, 'geometryType') || 'Point'
    if (!['Point', 'Line', 'Polygon'].includes(geometryType)) throw new Error(`Unknown geometry type: ${geometryType}.`)
    const layer = outputLayer(name, { type: 'FeatureCollection', features: [] })
    layer.geometry = geometryType as 'Point' | 'Line' | 'Polygon'
    layer.customFields = fields
    return { message: `${layer.name}: created an empty feature class with ${fields.length} fields.`, layers: [layer] }
  },
}
