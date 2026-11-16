import type { Feature } from 'geojson'
import { fieldNames, getLayer, getLayers, getOptionalText } from '../shared'
import type { ToolboxTool } from '../types'
import { geometryFamily, idAllocator } from './_utils'
import { isolate } from '../../bidi'

/**
 * Append: adds the features of one or more input layers to an existing target layer.
 * TEST requires the input fields to match the target schema; NO_TEST maps matching
 * fields, fills missing ones with null and drops fields the target lacks.
 */
export const appendTool: ToolboxTool = {
  id: 'append',
  name: 'Append',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Append the features of input layers into an existing target layer, matching attribute fields by name.',
  keywords: ['add records', 'load', 'insert', 'combine', 'merge into'],
  parameters: [
    { id: 'inputs', label: 'Input layers', kind: 'layers', required: true },
    { id: 'target', label: 'Target layer', kind: 'layer', required: true },
    {
      id: 'schema', label: 'Schema type', kind: 'select', defaultValue: 'NO_TEST',
      options: [
        { value: 'NO_TEST', label: 'Use the field map — match by name, ignore extra fields' },
        { value: 'TEST', label: 'Input fields must match the target schema' },
      ],
    },
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const inputs = getLayers(context, parameters, 'inputs').filter((layer) => layer.id !== target.id)
    if (!inputs.length) throw new Error('Choose at least one input layer other than the target.')
    const test = getOptionalText(parameters, 'schema') === 'TEST'
    const targetFields = fieldNames(target)
    const targetFamily = target.data.features.map((feature) => geometryFamily(feature.geometry)).find(Boolean) ?? null

    for (const layer of inputs) {
      const families = new Set(layer.data.features.map((feature) => geometryFamily(feature.geometry)).filter(Boolean))
      if (targetFamily && [...families].some((family) => family !== targetFamily)) {
        throw new Error(`${isolate(layer.name)} has ${[...families].join('/')} geometry but the target ${isolate(target.name)} holds ${targetFamily} features.`)
      }
      if (test) {
        const inputFields = fieldNames(layer)
        const extra = inputFields.filter((field) => !targetFields.includes(field))
        const missing = targetFields.filter((field) => !inputFields.includes(field))
        if (extra.length || missing.length) {
          throw new Error(`Schema mismatch for ${isolate(layer.name)}.${extra.length ? ` Not in target: ${extra.map(isolate).join(', ')}.` : ''}${missing.length ? ` Missing: ${missing.map(isolate).join(', ')}.` : ''} Use the field map option to append anyway.`)
        }
      }
    }

    const nextId = idAllocator(target)
    const appended: Feature[] = inputs.flatMap((layer) => layer.data.features.map((feature) => {
      // An empty target without a schema adopts the input attributes as they are.
      const properties: Record<string, unknown> = targetFields.length ? {} : { ...(feature.properties ?? {}) }
      for (const field of targetFields) properties[field] = feature.properties?.[field] ?? null
      return { type: 'Feature' as const, id: nextId(), properties, geometry: feature.geometry }
    }))
    if (!appended.length) throw new Error('The input layers contain no features.')
    return {
      message: `Appended ${appended.length.toLocaleString()} features from ${inputs.length} layer${inputs.length === 1 ? '' : 's'} into ${isolate(target.name)}.`,
      updates: [{ layerId: target.id, updates: { data: { ...target.data, features: [...target.data.features, ...appended] } } }],
    }
  },
}
