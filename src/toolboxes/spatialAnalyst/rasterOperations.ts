import { isolate } from '../../bidi'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { isNoData, rasterIndex } from '../../rasterEngine'
import { outputLayer } from '../shared'
import { gridCenterWgs84, gridOutput, getOptionalText, getRaster, outputName, rasterInput, SPATIAL_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

type Expression = { kind: 'number'; value: number } | { kind: 'variable'; name: 'A' | 'B' } |
  { kind: 'unary'; operator: '+' | '-'; child: Expression } |
  { kind: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: Expression; right: Expression }

function parseExpression(source: string): Expression {
  const tokens = source.match(/[A-Za-z]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|(?:\.\d+)(?:[eE][+-]?\d+)?|[()+\-*/^]/g) ?? []
  if (tokens.join('').length !== source.replace(/\s+/g, '').length) throw new Error('Expression contains an unsupported character or token.')
  let index = 0
  const peek = () => tokens[index]
  const take = () => tokens[index++]
  const primary = (): Expression => {
    const token = take()
    if (token === '(') {
      const expression = sum()
      if (take() !== ')') throw new Error('Expression has an unmatched parenthesis.')
      return expression
    }
    if (token === '+' || token === '-') return { kind: 'unary', operator: token, child: primary() }
    if (token === 'A' || token === 'B') return { kind: 'variable', name: token }
    if (token && Number.isFinite(Number(token))) return { kind: 'number', value: Number(token) }
    throw new Error(`Unexpected token "${token ?? ''}" in raster expression.`)
  }
  const power = (): Expression => {
    const left = primary()
    return peek() === '^' ? (take(), { kind: 'binary', operator: '^', left, right: power() }) : left
  }
  const product = (): Expression => {
    let node = power()
    while (peek() === '*' || peek() === '/') {
      const operator = take() as '*' | '/'
      node = { kind: 'binary', operator, left: node, right: power() }
    }
    return node
  }
  const sum = (): Expression => {
    let node = product()
    while (peek() === '+' || peek() === '-') {
      const operator = take() as '+' | '-'
      node = { kind: 'binary', operator, left: node, right: product() }
    }
    return node
  }
  if (!tokens.length) throw new Error('Enter a raster expression using numbers, A, B and arithmetic operators.')
  const result = sum()
  if (index !== tokens.length) throw new Error(`Unexpected token "${peek()}" in raster expression.`)
  return result
}

function evaluate(node: Expression, a: number, b: number): number {
  if (node.kind === 'number') return node.value
  if (node.kind === 'variable') return node.name === 'A' ? a : b
  if (node.kind === 'unary') return node.operator === '-' ? -evaluate(node.child, a, b) : evaluate(node.child, a, b)
  const left = evaluate(node.left, a, b)
  const right = evaluate(node.right, a, b)
  switch (node.operator) {
    case '+': return left + right
    case '-': return left - right
    case '*': return left * right
    case '/': return right === 0 ? Number.NaN : left / right
    case '^': return left ** right
  }
}

export const rasterCalculatorTool: ToolboxTool = {
  id: 'rasterCalculator', name: 'Raster Calculator', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Raster',
  description: 'Evaluate a safe arithmetic expression over two aligned raster layers (A and B); no JavaScript is evaluated.',
  keywords: ['map algebra', 'expression', 'calculator', 'raster'],
  parameters: [
    { id: 'rasterA', label: 'Raster A', kind: 'layer', required: true },
    { id: 'rasterAValueField', label: 'Raster A value field', kind: 'text', defaultValue: 'value' },
    { id: 'rasterB', label: 'Raster B', kind: 'layer', required: true },
    { id: 'rasterBValueField', label: 'Raster B value field', kind: 'text', defaultValue: 'value' },
    { id: 'expression', label: 'Expression (A, B, +, -, *, /, ^, parentheses)', kind: 'text', required: true, defaultValue: 'A + B' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Raster calculation' },
  ],
  execute: (context, parameters) => {
    const { layer: aLayer, grid: a } = getRaster(context, parameters, 'rasterA')
    const { grid: b } = getRaster(context, parameters, 'rasterB')
    if (a.crs !== b.crs || a.width !== b.width || a.height !== b.height ||
      a.origin.some((value, index) => Math.abs(value - b.origin[index]) > 1e-10) ||
      a.resolution.some((value, index) => Math.abs(value - b.resolution[index]) > 1e-10)) {
      throw new Error('Raster Calculator inputs must have the same CRS, identical dimensions, origin and cell resolution. Resample them first.')
    }
    const source = getOptionalText(parameters, 'expression')
    const expression = parseExpression(source)
    const noData = Number.NaN
    const values = new Float32Array(a.values.length).fill(noData)
    for (let index = 0; index < values.length; index += 1) {
      if (isNoData(a.values[index], a.noData) || isNoData(b.values[index], b.noData)) continue
      const result = evaluate(expression, a.values[index], b.values[index])
      if (Number.isFinite(result)) values[index] = result
    }
    const output = gridOutput(outputName(parameters, `${aLayer.name} Calculator`), { ...a, values, noData })
    return { message: `${isolate(output.name)}: evaluated raster expression for ${values.length} aligned cells.`, layers: [output] }
  },
}

interface ClassRange { min: number; max: number; value: number }
function parseRanges(text: string): { ranges: ClassRange[]; defaultValue?: number } {
  const ranges: ClassRange[] = []
  let defaultValue: number | undefined
  for (const entry of text.split(';').map((item) => item.trim()).filter(Boolean)) {
    const match = entry.match(/^(\*|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)-?([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)?\s*:\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/i)
    if (!match) throw new Error(`Invalid reclassification entry "${entry}". Use min-max:newValue entries separated by semicolons.`)
    const value = Number(match[3])
    if (match[1] === '*') {
      if (match[2]) throw new Error('A default reclassification entry must use *:value.')
      defaultValue = value
      continue
    }
    const min = Number(match[1])
    const max = match[2] ? Number(match[2]) : min
    if (min > max) throw new Error(`Reclassification range "${entry}" has its minimum above its maximum.`)
    ranges.push({ min, max, value })
  }
  if (!ranges.length && defaultValue === undefined) throw new Error('Enter at least one reclassification range.')
  return { ranges, defaultValue }
}

export const reclassifyTool: ToolboxTool = {
  id: 'reclassify', name: 'Reclassify', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Raster',
  description: 'Replace raster values using inclusive value ranges; unmatched cells become NoData unless a *:default is specified.',
  keywords: ['classify', 'remap', 'raster values'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'ranges', label: 'Ranges (min-max:new; use *:default)', kind: 'text', required: true, placeholder: '0-10:1;10-20:2;*:0' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Reclassified raster' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const parsed = parseRanges(getOptionalText(parameters, 'ranges'))
    const values = new Float32Array(grid.values.length).fill(Number.NaN)
    for (let index = 0; index < values.length; index += 1) {
      const input = grid.values[index]
      if (isNoData(input, grid.noData)) continue
      values[index] = parsed.ranges.find((range) => input >= range.min && input <= range.max)?.value ?? parsed.defaultValue ?? Number.NaN
    }
    const output = gridOutput(outputName(parameters, `${layer.name} Reclassified`), { ...grid, values, noData: Number.NaN })
    return { message: `${isolate(output.name)}: reclassified ${values.length} cells.`, layers: [output] }
  },
}

export const extractByMaskTool: ToolboxTool = {
  id: 'extractByMask', name: 'Extract by Mask', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Extraction',
  description: 'Keep raster cells whose centers fall inside one or more polygon mask features.',
  keywords: ['mask', 'clip', 'extract', 'polygon'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'mask', label: 'Polygon mask', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Extracted raster' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const mask = context.layers.find((item) => item.id === parameters.mask)
    if (!mask) throw new Error('Choose a valid polygon mask layer.')
    const polygons = mask.data.features.filter((feature): feature is Feature<Polygon | MultiPolygon> =>
      feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    if (!polygons.length) throw new Error('The mask layer must contain polygon or multipolygon features.')
    if (grid.values.length * polygons.length > 5_000_000) {
      throw new Error('Mask extraction would exceed 5,000,000 cell/polygon checks. Use fewer mask features or a coarser raster.')
    }
    const values = new Float32Array(grid.values.length).fill(Number.NaN)
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        const index = rasterIndex(grid, row, column)
        const value = grid.values[index]
        if (isNoData(value, grid.noData)) continue
        const [x, y] = gridCenterWgs84(grid, row, column)
        const cellPoint = point([x, y])
        if (polygons.some((polygon) => booleanPointInPolygon(cellPoint, polygon))) values[index] = value
      }
    }
    if (values.every(Number.isNaN)) throw new Error('The mask did not contain any valid raster cell centers.')
    const output = gridOutput(outputName(parameters, `${layer.name} Mask`), { ...grid, values, noData: Number.NaN })
    return { message: `${isolate(output.name)}: extracted raster cells inside the polygon mask.`, layers: [output] }
  },
}

export const zonalStatisticsTool: ToolboxTool = {
  id: 'zonalStatisticsAsTable', name: 'Zonal Statistics as Table', category: SPATIAL_ANALYST_CATEGORY, subcategory: 'Zonal',
  description: 'Summarize raster cells by polygon zone, adding count, minimum, maximum, sum and mean fields to each zone.',
  keywords: ['zonal', 'statistics', 'mean', 'sum', 'table'],
  parameters: [
    rasterInput(), { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'zones', label: 'Polygon zones', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Zonal statistics' },
  ],
  execute: (context, parameters) => {
    const { grid } = getRaster(context, parameters)
    const zones = context.layers.find((item) => item.id === parameters.zones)
    if (!zones) throw new Error('Choose a valid polygon zone layer.')
    const zoneFeatures = zones.data.features.filter((feature): feature is Feature<Polygon | MultiPolygon> =>
      feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    if (!zoneFeatures.length) throw new Error('The zone layer must contain polygon or multipolygon features.')
    if (grid.values.length * zoneFeatures.length > 5_000_000) {
      throw new Error('Zonal statistics would exceed 5,000,000 cell/zone checks. Use fewer zones or a coarser raster.')
    }
    const features = zoneFeatures.map((zone) => {
      let count = 0; let sum = 0; let min = Infinity; let max = -Infinity
      for (let row = 0; row < grid.height; row += 1) {
        for (let column = 0; column < grid.width; column += 1) {
          const value = grid.values[rasterIndex(grid, row, column)]
          if (isNoData(value, grid.noData)) continue
          const [x, y] = gridCenterWgs84(grid, row, column)
          if (!booleanPointInPolygon(point([x, y]), zone)) continue
          count += 1; sum += value; min = Math.min(min, value); max = Math.max(max, value)
        }
      }
      return {
        type: 'Feature' as const, id: zone.id,
        properties: { ...(zone.properties ?? {}), COUNT: count, MIN: count ? min : null, MAX: count ? max : null, SUM: count ? sum : null, MEAN: count ? sum / count : null },
        geometry: zone.geometry,
      }
    })
    const name = outputName(parameters, 'Zonal statistics')
    const output = outputLayer(name, { type: 'FeatureCollection', features }, zones.sourceCrs)
    return { message: `${isolate(name)}: summarized ${features.length} polygon zones.`, layers: [output] }
  },
}
