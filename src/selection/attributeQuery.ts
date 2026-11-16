import type { Feature } from 'geojson'
import type { FeatureId, MapLayer } from '../store'

/** Select By Attributes: a small SQL-like WHERE clause model, evaluated in the browser. */

export const queryOperators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL'] as const
export type QueryOperator = typeof queryOperators[number]

export interface QueryClause {
  id: string
  /** How this clause joins the one before it; ignored for the first clause. */
  connector: 'AND' | 'OR'
  field: string
  operator: QueryOperator
  value: string
  literalType?: 'number' | 'text'
}

export const operatorNeedsValue = (operator: QueryOperator) => operator !== 'IS NULL' && operator !== 'IS NOT NULL'

export function newClause(field = '', connector: 'AND' | 'OR' = 'AND'): QueryClause {
  return { id: crypto.randomUUID(), connector, field, operator: '=', value: '' }
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === ''

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

/** True when every non-empty value of the field is numeric, so literals are written without quotes. */
export function isNumericField(layer: MapLayer, field: string): boolean {
  let seen = false
  for (const feature of layer.data.features) {
    const value = feature.properties?.[field]
    if (isEmpty(value)) continue
    if (toNumber(value) === null) return false
    seen = true
  }
  return seen
}

/** Distinct values of a field for the value sampler, sorted, capped at `limit`. */
export function uniqueValues(layer: MapLayer, field: string, limit = 300): { values: string[]; truncated: boolean } {
  const values = new Set<string>()
  for (const feature of layer.data.features) {
    const value = feature.properties?.[field]
    if (isEmpty(value)) continue
    values.add(typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  const sorted = [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
  return { values: sorted.slice(0, limit), truncated: sorted.length > limit }
}

function likePattern(pattern: string): RegExp {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${source}$`, 'is')
}

function matchesClause(feature: Feature, clause: QueryClause): boolean {
  const raw = feature.properties?.[clause.field]
  if (clause.operator === 'IS NULL') return isEmpty(raw)
  if (clause.operator === 'IS NOT NULL') return !isEmpty(raw)
  // As in SQL, a comparison against an empty (NULL) value is never true.
  if (isEmpty(raw)) return false
  const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
  if (clause.operator === 'LIKE') return likePattern(clause.value).test(text)
  if (clause.operator === 'NOT LIKE') return !likePattern(clause.value).test(text)
  const left = toNumber(raw)
  const right = toNumber(clause.value)
  const order = left !== null && right !== null
    ? left - right
    : text.localeCompare(clause.value, undefined, { numeric: true })
  switch (clause.operator) {
    case '=': return left !== null && right !== null ? order === 0 : text === clause.value
    case '!=': return left !== null && right !== null ? order !== 0 : text !== clause.value
    case '>': return order > 0
    case '<': return order < 0
    case '>=': return order >= 0
    case '<=': return order <= 0
  }
}

/** Clauses that are complete enough to evaluate. */
export function usableClauses(clauses: QueryClause[]): QueryClause[] {
  return clauses.filter((clause) => clause.field && (!operatorNeedsValue(clause.operator) || clause.value !== ''))
}

/**
 * IDs of the features matching the clauses. AND binds tighter than OR, as in SQL:
 * `a AND b OR c` means `(a AND b) OR c`.
 */
export function evaluateQuery(layer: MapLayer, clauses: QueryClause[]): FeatureId[] {
  const usable = usableClauses(clauses)
  if (!usable.length) throw new Error('Add at least one complete condition (field, operator and value).')
  const fields = new Set(layer.customFields ?? [])
  for (const feature of layer.data.features) {
    Object.keys(feature.properties ?? {}).forEach((field) => fields.add(field))
  }
  for (const clause of usable) {
    if (!fields.has(clause.field)) throw new Error(`Field "${clause.field}" does not exist in this layer.`)
    if (!operatorNeedsValue(clause.operator)) continue
    const values = layer.data.features
      .map((feature) => feature.properties?.[clause.field])
      .filter((value) => !isEmpty(value))
    const numericField = values.length > 0 && values.every((value) => toNumber(value) !== null)
    if (clause.literalType && values.length && (numericField ? clause.literalType !== 'number' : clause.literalType !== 'text')) {
      throw new Error(`The value type does not match field "${clause.field}". ${numericField ? 'Enter a number without quotes.' : 'Enclose text values in single quotes.'}`)
    }
    if (numericField && clause.operator.includes('LIKE')) {
      throw new Error(`LIKE can only be used with a text field; "${clause.field}" contains numeric values.`)
    }
    if (numericField && toNumber(clause.value) === null) {
      throw new Error(`Field "${clause.field}" contains numeric values; enter a valid number.`)
    }
  }
  const groups: QueryClause[][] = []
  usable.forEach((clause, index) => {
    if (index === 0 || clause.connector === 'OR') groups.push([clause])
    else groups[groups.length - 1].push(clause)
  })
  const ids: FeatureId[] = []
  for (const feature of layer.data.features) {
    if (feature.id === undefined) continue
    if (groups.some((group) => group.every((clause) => matchesClause(feature, clause)))) ids.push(feature.id)
  }
  return ids
}

/** The WHERE clause as readable SQL, for the expression preview. */
export function queryToSql(layer: MapLayer | undefined, clauses: QueryClause[]): string {
  const usable = usableClauses(clauses)
  if (!usable.length) return ''
  return usable.map((clause, index) => {
    const field = /^[A-Za-z_][A-Za-z0-9_]*$/.test(clause.field) ? clause.field : `"${clause.field.replace(/"/g, '""')}"`
    const numeric = layer ? isNumericField(layer, clause.field) && toNumber(clause.value) !== null : false
    const literal = !operatorNeedsValue(clause.operator) ? ''
      : numeric && !clause.operator.includes('LIKE') ? ` ${clause.value}` : ` '${clause.value.replace(/'/g, "''")}'`
    return `${index === 0 ? '' : `${clause.connector} `}${field} ${clause.operator}${literal}`
  }).join('\n')
}
