import { isolate } from '../../bidi'
import type { Feature } from 'geojson'
import { getLayer, getOptionalText, getText } from '../shared'
import type { ToolboxTool } from '../types'
import {
  compareValues, downloadParameter, isEmptyValue, outputName, outputNameParameter, parseList, resolveField, round, tableResult,
  toNumber, type Row,
} from './_utils'

export const STATISTIC_TYPES = ['SUM', 'MEAN', 'MIN', 'MAX', 'RANGE', 'STD', 'COUNT', 'FIRST', 'LAST'] as const
type StatisticType = typeof STATISTIC_TYPES[number]

interface StatisticRequest { field: string; type: StatisticType; output: string }

function parseStatistics(text: string, resolve: (field: string) => string): StatisticRequest[] {
  return parseList(text).map((item) => {
    const match = /^(.+?)[\s:]+([A-Za-z]+)$/.exec(item.trim())
    const type = match?.[2].toUpperCase() as StatisticType | undefined
    if (!match || !type || !STATISTIC_TYPES.includes(type)) {
      throw new Error(`Could not read "${isolate(item)}". Write FIELD STATISTIC pairs, e.g. "POP SUM, AREA MEAN" (statistics: ${STATISTIC_TYPES.join(', ')}).`)
    }
    const field = resolve(match[1].trim())
    return { field, type, output: `${type}_${field}` }
  })
}

function computeStatistic(type: StatisticType, field: string, features: Feature[]): unknown {
  const raw = features.map((feature) => feature.properties?.[field])
  if (type === 'FIRST') return raw[0] ?? null
  if (type === 'LAST') return raw[raw.length - 1] ?? null
  if (type === 'COUNT') return raw.filter((value) => !isEmptyValue(value)).length
  const numbers = raw.map(toNumber).filter((value): value is number => value !== null)
  if (!numbers.length) return null
  const sum = numbers.reduce((total, value) => total + value, 0)
  const mean = sum / numbers.length
  const minimum = numbers.reduce((result, value) => Math.min(result, value), Infinity)
  const maximum = numbers.reduce((result, value) => Math.max(result, value), -Infinity)
  switch (type) {
    case 'SUM': return round(sum, 10)
    case 'MEAN': return round(mean, 10)
    case 'MIN': return minimum
    case 'MAX': return maximum
    case 'RANGE': return round(maximum - minimum, 10)
    // Population standard deviation (divides by n), as ArcGIS Summary Statistics.
    case 'STD': return round(Math.sqrt(numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length), 10)
  }
}

/**
 * Summary Statistics: per-field statistics for the whole table or for each unique value
 * of a case field. Output fields are named STAT_FIELD (e.g. SUM_POP) plus FREQUENCY.
 */
export const summaryStatisticsTool: ToolboxTool = {
  id: 'summary-statistics',
  name: 'Summary Statistics',
  category: 'Analysis',
  subcategory: 'Statistics',
  description: 'Calculate SUM, MEAN, MIN, MAX, RANGE, STD, COUNT, FIRST or LAST of fields, optionally per case field value.',
  keywords: ['statistics', 'summarize', 'aggregate', 'group by', 'sum', 'mean', 'average', 'count', 'table'],
  parameters: [
    { id: 'target', label: 'Input table / layer', kind: 'layer', required: true },
    { id: 'statistics', label: `Statistics fields (FIELD STAT, …; ${STATISTIC_TYPES.join('/')})`, kind: 'text', required: true, placeholder: 'POP SUM, POP MEAN, NAME COUNT' },
    { id: 'caseField', label: 'Case field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    downloadParameter,
    outputNameParameter('Summary statistics'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const requests = parseStatistics(getText(parameters, 'statistics', 'at least one FIELD STATISTIC pair'), (field) => resolveField(target, field))
    const caseText = getOptionalText(parameters, 'caseField')
    const caseFields = caseText ? parseList(caseText).map((field) => resolveField(target, field)) : []
    const features = target.data.features
    if (!features.length) throw new Error('The input table has no rows.')

    const groups = new Map<string, { values: unknown[]; features: Feature[] }>()
    for (const feature of features) {
      const values = caseFields.map((field) => feature.properties?.[field] ?? null)
      const key = JSON.stringify(values)
      const group = groups.get(key) ?? { values, features: [] as Feature[] }
      group.features.push(feature)
      groups.set(key, group)
    }
    const ordered = [...groups.values()].sort((a, b) => {
      for (let index = 0; index < caseFields.length; index += 1) {
        const order = compareValues(a.values[index], b.values[index])
        if (order) return order
      }
      return 0
    })
    const outputs = [...new Set(requests.map((request) => request.output))]
    const rows: Row[] = ordered.map((group) => {
      const row: Row = Object.fromEntries(caseFields.map((field, index) => [field, group.values[index]]))
      row.FREQUENCY = group.features.length
      for (const request of requests) row[request.output] = computeStatistic(request.type, request.field, group.features)
      return row
    })
    const { layer, downloads } = tableResult(parameters, outputName(parameters, `${target.name} Statistics`), rows, [...caseFields, 'FREQUENCY', ...outputs])
    return { message: `${isolate(layer.name)}: ${rows.length.toLocaleString()} summary rows.`, layers: [layer], downloads }
  },
}
