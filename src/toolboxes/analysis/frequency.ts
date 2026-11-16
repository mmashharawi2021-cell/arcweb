import { getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'
import {
  compareValues, downloadParameter, outputName, outputNameParameter, parseList, resolveField, round, tableResult, toNumber, type Row,
} from './_utils'

/**
 * Frequency: counts the rows for every unique combination of the frequency fields and
 * optionally sums numeric summary fields for each combination.
 */
export const frequencyTool: ToolboxTool = {
  id: 'frequency',
  name: 'Frequency',
  category: 'Analysis',
  subcategory: 'Statistics',
  description: 'Count how often each unique combination of field values occurs, optionally summing other numeric fields.',
  keywords: ['count', 'unique', 'combinations', 'histogram', 'statistics', 'table', 'group by'],
  parameters: [
    { id: 'target', label: 'Input table / layer', kind: 'layer', required: true },
    { id: 'fields', label: 'Frequency fields (comma separated)', kind: 'text', required: true, placeholder: 'TYPE, CLASS' },
    { id: 'summaryFields', label: 'Summary fields to sum (optional, comma separated)', kind: 'text', placeholder: 'POP' },
    downloadParameter,
    outputNameParameter('Frequency'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const fields = parseList(getText(parameters, 'fields', 'at least one frequency field')).map((field) => resolveField(target, field))
    const sums = parseList(getOptionalText(parameters, 'summaryFields')).map((field) => resolveField(target, field))
      .filter((field) => !fields.includes(field))
    if (!target.data.features.length) throw new Error('The input table has no rows.')

    const groups = new Map<string, Row>()
    for (const feature of target.data.features) {
      const values = fields.map((field) => feature.properties?.[field] ?? null)
      const key = JSON.stringify(values)
      let row = groups.get(key)
      if (!row) {
        row = { FREQUENCY: 0, ...Object.fromEntries(fields.map((field, index) => [field, values[index]])), ...Object.fromEntries(sums.map((field) => [field, 0])) }
        groups.set(key, row)
      }
      row.FREQUENCY = (row.FREQUENCY as number) + 1
      for (const field of sums) row[field] = round((row[field] as number) + (toNumber(feature.properties?.[field]) ?? 0), 10)
    }
    const rows = [...groups.values()].sort((a, b) => {
      for (const field of fields) {
        const order = compareValues(a[field], b[field])
        if (order) return order
      }
      return 0
    })
    const { layer, downloads } = tableResult(parameters, outputName(parameters, `${target.name} Frequency`), rows, ['FREQUENCY', ...fields, ...sums])
    return { message: `${layer.name}: ${rows.length.toLocaleString()} unique combinations.`, layers: [layer], downloads }
  },
}
