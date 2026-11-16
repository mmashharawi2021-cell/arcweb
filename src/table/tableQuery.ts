import type { Feature } from 'geojson'
import type { FeatureId, TableView } from '../store'

/**
 * Column filters for the attribute table. Each column takes a short expression:
 *   text          contains (case-insensitive)      "rail"
 *   =value        equals (numbers compare numerically, text case-insensitively)
 *   !=value <>    does not equal
 *   > >= < <=     numeric comparison               ">= 1000"
 *   a..b          inclusive numeric range          "10..20"
 *   null / !null  empty / not empty                 (also "is null", "not null", "empty")
 */
export type CellPredicate = (value: unknown) => boolean

const isEmpty = (value: unknown) => value === null || value === undefined || value === ''
const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}
const asText = (value: unknown) => isEmpty(value) ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export interface ParsedFilter {
  predicate: CellPredicate
  /** Readable description, used as the filter chip's tooltip. */
  description: string
}

export function parseColumnFilter(input: string): ParsedFilter | null {
  const text = input.trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (['null', 'is null', 'empty', '=null'].includes(lower)) return { predicate: isEmpty, description: 'is empty' }
  if (['!null', 'not null', 'is not null', '!=null', '<>null'].includes(lower)) return { predicate: (value) => !isEmpty(value), description: 'is not empty' }

  const range = /^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*\.\.\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)$/i.exec(text)
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b)
    return { predicate: (value) => { const number = asNumber(value); return number !== null && number >= low && number <= high }, description: `between ${low} and ${high}` }
  }

  const comparison = /^(>=|<=|!=|<>|==|=|>|<)\s*(.*)$/.exec(text)
  if (comparison) {
    const operator = comparison[1]
    const operand = comparison[2].trim()
    const target = asNumber(operand)
    if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') {
      if (target === null) return null
      const test = {
        '>': (number: number) => number > target,
        '>=': (number: number) => number >= target,
        '<': (number: number) => number < target,
        '<=': (number: number) => number <= target,
      }[operator]
      return { predicate: (value) => { const number = asNumber(value); return number !== null && test(number) }, description: `${operator} ${target}` }
    }
    const equals: CellPredicate = (value) => {
      const number = asNumber(value)
      if (target !== null && number !== null) return number === target
      return asText(value).toLowerCase() === operand.toLowerCase()
    }
    const negate = operator === '!=' || operator === '<>'
    return { predicate: negate ? (value) => !equals(value) : equals, description: `${negate ? 'is not' : 'equals'} ${operand}` }
  }

  return { predicate: (value) => asText(value).toLowerCase().includes(lower), description: `contains "${text}"` }
}

export function compareCellValues(left: unknown, right: unknown): number {
  if (isEmpty(left)) return isEmpty(right) ? 0 : -1
  if (isEmpty(right)) return 1
  const leftNumber = asNumber(left)
  const rightNumber = asNumber(right)
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
  return asText(left).localeCompare(asText(right), undefined, { numeric: true, sensitivity: 'base' })
}

export interface TableRow { feature: Feature; index: number }

export interface TableQuery {
  view: TableView
  /** Free-text search across every field and the feature ID. */
  search: string
  fields: string[]
  /** When set, only these features are shown ("Show selected records"). */
  onlyIds: ReadonlySet<FeatureId> | null
}

/** Rows that pass the search, every column filter and the selection toggle, in sort order. */
export function queryTableRows(features: Feature[], { view, search, fields, onlyIds }: TableQuery): TableRow[] {
  const query = search.trim().toLowerCase()
  const filters = Object.entries(view.filters).flatMap(([field, text]) => {
    const parsed = parseColumnFilter(text)
    return parsed ? [{ field, predicate: parsed.predicate }] : []
  })
  const rows = features.map((feature, index) => ({ feature, index })).filter(({ feature, index }) => {
    if (onlyIds && !(feature.id !== undefined && onlyIds.has(feature.id))) return false
    if (!filters.every(({ field, predicate }) => predicate(feature.properties?.[field]))) return false
    if (!query) return true
    if (String(feature.id ?? index).toLowerCase().includes(query)) return true
    return fields.some((field) => asText(feature.properties?.[field]).toLowerCase().includes(query))
  })
  const sort = view.sort
  if (sort) rows.sort((left, right) => compareCellValues(left.feature.properties?.[sort.field], right.feature.properties?.[sort.field]) * sort.direction || left.index - right.index)
  return rows
}

/**
 * Converts text typed into a cell to a stored value. Numbers stay numbers when the field holds
 * numbers, booleans stay booleans, an empty entry clears the cell (null), anything else is text.
 * Returns an error message instead when text is typed into a numeric field.
 */
export function coerceCellInput(input: string, columnValues: unknown[]): { value: unknown } | { error: string } {
  const text = input.trim()
  if (text === '') return { value: null }
  const present = columnValues.filter((value) => !isEmpty(value))
  if (present.length && present.every((value) => typeof value === 'boolean')) {
    if (/^(true|yes|1)$/i.test(text)) return { value: true }
    if (/^(false|no|0)$/i.test(text)) return { value: false }
    return { error: 'This field holds true/false values.' }
  }
  if (present.length && present.every((value) => typeof value === 'number')) {
    const number = asNumber(text)
    return number === null ? { error: `"${text}" is not a number; this field holds numbers.` } : { value: number }
  }
  return { value: input }
}

/** A new collection with one attribute of one feature changed (features are copied, never mutated). */
export function setFeatureAttribute(features: Feature[], featureId: FeatureId, field: string, value: unknown): Feature[] {
  return features.map((feature) => feature.id === featureId
    ? { ...feature, properties: { ...(feature.properties ?? {}), [field]: value } }
    : feature)
}
