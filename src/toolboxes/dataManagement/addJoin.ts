import { isolate } from '../../bidi'
import { fieldNames, getLayer, getOptionalText, getText, outputLayer } from '../shared'
import type { Feature } from 'geojson'
import type { ToolboxTool } from '../types'

function resolve(layer: ReturnType<typeof getLayer>, requested: string): string {
  const match = fieldNames(layer).find((name) => name === requested) ??
    fieldNames(layer).find((name) => name.toLowerCase() === requested.toLowerCase())
  if (!match) throw new Error(`Field "${isolate(requested)}" was not found in ${isolate(layer.name)}.`)
  return match
}

function joinKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return `${typeof value}:${String(value)}`
}

/** Add Join: persist an attribute-table join in a new copy of the input layer. */
export const addJoinTool: ToolboxTool = {
  id: 'add-join',
  name: 'Add Join',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Join a table or layer to the input features by matching fields and save the joined result as a new layer.',
  keywords: ['join', 'table', 'attributes', 'relate', 'matching fields'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'inputField', label: 'Input join field', kind: 'field', layerParameter: 'target', required: true },
    { id: 'joinTable', label: 'Join table / layer', kind: 'layer', required: true },
    { id: 'joinField', label: 'Join table field', kind: 'field', layerParameter: 'joinTable', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Joined layer' },
  ],
  execute: (context, parameters) => {
    const input = getLayer(context, parameters, 'target')
    const table = getLayer(context, parameters, 'joinTable')
    const inputField = resolve(input, getText(parameters, 'inputField', 'an input join field'))
    const joinField = resolve(table, getText(parameters, 'joinField', 'a join table field'))
    const fields = fieldNames(table).filter((field) => field !== joinField)
    const used = new Set(fieldNames(input).map((field) => field.toLowerCase()))
    const outputFields = fields.map((field) => {
      const base = `${table.name}_${field}`
      let candidate = base
      let suffix = 1
      while (used.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}`
      used.add(candidate.toLowerCase())
      return [field, candidate] as const
    })
    const index = new Map<string, Record<string, unknown>[]>()
    for (const row of table.data.features) {
      const key = joinKey(row.properties?.[joinField])
      if (key === null) continue
      const matches = index.get(key) ?? []
      matches.push(row.properties ?? {})
      index.set(key, matches)
    }
    const features: Feature[] = []
    for (const feature of input.data.features) {
      const matches = index.get(joinKey(feature.properties?.[inputField]) ?? '') ?? []
      const rows = matches.length ? matches : [{}]
      for (const row of rows) {
        const properties: Record<string, unknown> = { ...(feature.properties ?? {}) }
        outputFields.forEach(([source, output]) => { properties[output] = row[source] ?? null })
        features.push({ ...feature, properties })
      }
    }
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${input.name} Joined`, { ...input.data, features }, input.sourceCrs)
    output.customFields = [...new Set([...(input.customFields ?? []), ...outputFields.map(([, field]) => field)])]
    return { message: `${isolate(output.name)}: joined ${features.length.toLocaleString()} features using ${isolate(inputField)} = ${isolate(joinField)}.`, layers: [output] }
  },
}
