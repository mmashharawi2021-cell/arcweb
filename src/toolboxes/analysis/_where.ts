import type { Feature } from 'geojson'
import { evaluateQuery, type QueryClause, type QueryOperator } from '../../selection/attributeQuery'
import type { MapLayer } from '../../store'
import { resolveField } from './_utils'

/**
 * A small SQL WHERE parser for the Select / Table Select tools. Supports
 * `field <op> value` clauses joined by AND / OR (AND binds tighter, as in SQL) with
 * the operators = <> != > < >= <= LIKE, NOT LIKE, IS NULL, IS NOT NULL.
 * Text literals use single quotes; field names may be wrapped in double quotes.
 */

const CLAUSE = /^\s*(?:"((?:[^"]|"")+)"|\[([^\]]+)\]|([^\s=<>!]+))\s*(IS\s+NOT\s+NULL|IS\s+NULL|NOT\s+LIKE|LIKE|>=|<=|<>|!=|=|>|<)\s*([\s\S]*?)\s*$/i

function splitConnectors(expression: string): { text: string; connector: 'AND' | 'OR' }[] {
  const parts: { text: string; connector: 'AND' | 'OR' }[] = []
  let quote: string | null = null
  let start = 0
  let connector: 'AND' | 'OR' = 'AND'
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]
    if (quote) {
      if (char === quote) {
        if (expression[index + 1] === quote) index += 1
        else quote = null
      }
      continue
    }
    if (char === '\'' || char === '"') { quote = char; continue }
    if (char === '(' || char === ')') throw new Error('Parentheses are not supported in the expression; AND is evaluated before OR.')
    if (!/\s/.test(char)) continue
    const match = /^\s+(AND|OR)\s+/i.exec(expression.slice(index))
    if (match) {
      parts.push({ text: expression.slice(start, index), connector })
      connector = match[1].toUpperCase() as 'AND' | 'OR'
      index += match[0].length - 1
      start = index + 1
    }
  }
  if (quote) throw new Error('The expression has an unclosed quote.')
  parts.push({ text: expression.slice(start), connector })
  return parts
}

export function parseWhere(layer: MapLayer, expression: string): QueryClause[] {
  return splitConnectors(expression).map(({ text, connector }, index) => {
    const match = CLAUSE.exec(text)
    if (!match) throw new Error(`Could not read the condition "${text.trim()}". Use the form FIELD = 'value'.`)
    const [, quoted, bracketed, bare, rawOperator, rawValue] = match
    const field = resolveField(layer, quoted?.replace(/""/g, '"') ?? bracketed ?? bare)
    const normalized = rawOperator.toUpperCase().replace(/\s+/g, ' ')
    const operator = (normalized === '<>' ? '!=' : normalized) as QueryOperator
    const needsValue = operator !== 'IS NULL' && operator !== 'IS NOT NULL'
    if (needsValue && !rawValue) throw new Error(`The condition "${text.trim()}" is missing a value.`)
    if (!needsValue && rawValue) throw new Error(`Unexpected text after ${operator}: "${rawValue}".`)
    let value = rawValue
    let literalType: QueryClause['literalType']
    if (needsValue) {
      const quote = rawValue[0]
      if (quote === '\'' || quote === '"') {
        const literal = quote === '\''
          ? /^'((?:[^']|'')*)'$/.exec(rawValue)
          : /^"((?:[^"]|"")*)"$/.exec(rawValue)
        if (!literal) throw new Error(`The value in "${text.trim()}" has invalid quoting. Enclose text values in matching quotes.`)
        value = literal[1].replace(quote === '\'' ? /''/g : /""/g, quote)
        literalType = 'text'
      } else {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawValue)) {
          throw new Error(`The value in "${text.trim()}" is invalid. Use a numeric value or enclose text in single quotes.`)
        }
        literalType = 'number'
      }
    }
    return { id: `clause-${index}`, connector, field, operator, value, literalType }
  })
}

/** Features of the layer matching the expression; an empty expression selects every feature. */
export function selectFeatures(layer: MapLayer, expression: string): Feature[] {
  if (!expression.trim()) return [...layer.data.features]
  const ids = new Set(evaluateQuery(layer, parseWhere(layer, expression)))
  return layer.data.features.filter((feature) => feature.id !== undefined && ids.has(feature.id))
}
