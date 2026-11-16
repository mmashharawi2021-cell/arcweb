import type { Feature, FeatureCollection, GeoJsonProperties } from 'geojson'

type Value = number | string
type ExpressionNode =
  | { kind: 'value'; value: Value }
  | { kind: 'field'; field: string }
  | { kind: 'operation'; operator: '+' | '-' | '*' | '/'; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'unary'; operator: '+' | '-'; value: ExpressionNode }

interface Token { kind: 'number' | 'string' | 'field' | 'operator' | 'left' | 'right'; value: string }

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|(\[[^\]]+\])|("(?:[^"\\]|\\.)*")|([A-Za-z_$][\w.$]*)|([()+\-*/]))/gy
  const source = expression.trim()
  let position = 0
  while (position < source.length) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) throw new Error(`Unexpected character near "${source.slice(position, position + 12)}".`)
    position = pattern.lastIndex
    if (match[1]) tokens.push({ kind: 'number', value: match[1] })
    else if (match[2]) tokens.push({ kind: 'field', value: match[2].slice(1, -1).trim() })
    else if (match[3]) tokens.push({ kind: 'string', value: JSON.parse(match[3]) as string })
    else if (match[4]) tokens.push({ kind: 'field', value: match[4] })
    else if (match[5] === '(') tokens.push({ kind: 'left', value: match[5] })
    else if (match[5] === ')') tokens.push({ kind: 'right', value: match[5] })
    else if (match[5]) tokens.push({ kind: 'operator', value: match[5] })
  }
  if (!tokens.length) throw new Error('Enter a calculation expression.')
  return tokens
}

function parseExpression(tokens: Token[]): ExpressionNode {
  let index = 0
  const peek = () => tokens[index]
  const take = () => tokens[index++]
  const parsePrimary = (): ExpressionNode => {
    const token = take()
    if (!token) throw new Error('The expression ends unexpectedly.')
    if (token.kind === 'number') return { kind: 'value', value: Number(token.value) }
    if (token.kind === 'string') return { kind: 'value', value: token.value }
    if (token.kind === 'field') {
      if (!token.value) throw new Error('Field references cannot be empty.')
      return { kind: 'field', field: token.value }
    }
    if (token.kind === 'left') {
      const nested = parseAdditive()
      if (take()?.kind !== 'right') throw new Error('Add a closing parenthesis.')
      return nested
    }
    if (token.kind === 'operator' && (token.value === '-' || token.value === '+')) {
      return { kind: 'unary', operator: token.value, value: parsePrimary() }
    }
    throw new Error(`Unexpected token "${token.value}".`)
  }
  const parseMultiplicative = (): ExpressionNode => {
    let node = parsePrimary()
    while (peek()?.kind === 'operator' && (peek()?.value === '*' || peek()?.value === '/')) {
      const operator = take().value as '*' | '/'
      node = { kind: 'operation', operator, left: node, right: parsePrimary() }
    }
    return node
  }
  const parseAdditive = (): ExpressionNode => {
    let node = parseMultiplicative()
    while (peek()?.kind === 'operator' && (peek()?.value === '+' || peek()?.value === '-')) {
      const operator = take().value as '+' | '-'
      node = { kind: 'operation', operator, left: node, right: parseMultiplicative() }
    }
    return node
  }
  const tree = parseAdditive()
  if (index !== tokens.length) throw new Error(`Unexpected token "${tokens[index].value}".`)
  return tree
}

function numberValue(value: Value): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function evaluate(node: ExpressionNode, properties: GeoJsonProperties): Value {
  if (node.kind === 'value') return node.value
  if (node.kind === 'field') {
    const value = properties?.[node.field]
    return typeof value === 'number' || typeof value === 'string' ? value : ''
  }
  if (node.kind === 'unary') {
    const value = numberValue(evaluate(node.value, properties))
    if (value === null) throw new Error(`Unary "${node.operator}" requires a numeric value.`)
    return node.operator === '-' ? -value : value
  }
  const left = evaluate(node.left, properties)
  const right = evaluate(node.right, properties)
  if (node.operator === '+' && (numberValue(left) === null || numberValue(right) === null)) {
    return `${left}${right}`
  }
  const leftNumber = numberValue(left)
  const rightNumber = numberValue(right)
  if (leftNumber === null || rightNumber === null) {
    throw new Error(`Operator "${node.operator}" requires numeric field values.`)
  }
  if (node.operator === '+') return leftNumber + rightNumber
  if (node.operator === '-') return leftNumber - rightNumber
  if (node.operator === '*') return leftNumber * rightNumber
  if (rightNumber === 0) throw new Error('Division by zero is not allowed.')
  return leftNumber / rightNumber
}

export function calculateField(
  collection: FeatureCollection,
  fieldName: string,
  expression: string,
): FeatureCollection {
  const name = fieldName.trim()
  if (!name) throw new Error('Enter a name for the output field.')
  const tree = parseExpression(tokenize(expression))
  const features: Feature[] = collection.features.map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      [name]: finiteResult(evaluate(tree, feature.properties ?? {})),
    },
  }))
  return { ...collection, features }
}

function finiteResult(value: Value): Value {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('The calculation must produce a finite numeric value.')
  }
  return value
}
