import { finiteNumber } from './numbers'
import type {
  CategoricalRampId,
  ClassificationMethod,
  ContinuousRampId,
  MapLayer,
  RendererConfig,
} from './store'

export const CATEGORICAL_RAMPS: Record<CategoricalRampId, { name: string; colors: string[] }> = {
  pastel: { name: 'Pastel', colors: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd'] },
  vivid: { name: 'Vivid', colors: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#17a2b8', '#7b61a8'] },
  earth: { name: 'Earth tones', colors: ['#6b8e23', '#c2a878', '#a0522d', '#4682b4', '#d2b48c', '#556b2f', '#cd853f', '#708090', '#8f9779', '#bc8f8f'] },
  urban: { name: 'Urban', colors: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'] },
}

export const CONTINUOUS_RAMPS: Record<ContinuousRampId, { name: string; colors: string[] }> = {
  viridis: { name: 'Viridis', colors: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'] },
  'yl-or-rd': { name: 'Yellow–Orange–Red', colors: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'] },
  blues: { name: 'Blues', colors: ['#eff3ff', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'] },
  greens: { name: 'Greens', colors: ['#edf8e9', '#c7e9c0', '#a1d99b', '#74c476', '#31a354', '#006d2c'] },
  'rd-yl-gn': { name: 'Red–Yellow–Green', colors: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#006837'] },
}

export const SINGLE_SYMBOL_PRESETS = [
  { name: 'Amber', fillColor: '#f5a623', strokeColor: '#ffe0a3' },
  { name: 'Ocean', fillColor: '#27a9d2', strokeColor: '#c4f0ff' },
  { name: 'Forest', fillColor: '#48a868', strokeColor: '#c5f2ce' },
  { name: 'Rose', fillColor: '#d95869', strokeColor: '#ffd0d5' },
  { name: 'Violet', fillColor: '#8b72d9', strokeColor: '#ddd3ff' },
]

export interface LegendClass {
  value: string
  label: string
  color: string
  count: number
}

function properties(layer: MapLayer) {
  return layer.data.features.map((feature) => feature.properties ?? {})
}

export function getFeatureFields(layer: MapLayer): string[] {
  return [...new Set(properties(layer).flatMap((record) => Object.keys(record)))].sort((a, b) => a.localeCompare(b))
}

export function getNumericFields(layer: MapLayer): string[] {
  return getFeatureFields(layer).filter((field) =>
    properties(layer).some((record) => record[field] !== null && record[field] !== undefined && record[field] !== '' && Number.isFinite(Number(record[field]))))
}

export function getUniqueValueClasses(layer: MapLayer, field: string, renderer?: RendererConfig): LegendClass[] {
  const counts = new Map<string, number>()
  for (const record of properties(layer)) {
    const raw = record[field]
    const value = raw === null || raw === undefined ? '' : String(raw)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const colors = renderer?.type === 'unique' && renderer.field === field ? renderer.colors : {}
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([value, count]) => ({
      value,
      label: value === '' ? '(empty)' : value,
      color: colors[value] ?? layer.fillColor,
      count,
    }))
}

export function sampleCategoricalRamp(ramp: CategoricalRampId, count: number): string[] {
  const colors = CATEGORICAL_RAMPS[ramp].colors
  return Array.from({ length: count }, (_, index) => colors[index % colors.length])
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.slice(1)
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number]
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

export function sampleContinuousRamp(ramp: ContinuousRampId, count: number): string[] {
  if (count <= 0) return []
  const stops = CONTINUOUS_RAMPS[ramp].colors
  if (count === 1) return [stops[Math.floor((stops.length - 1) / 2)]]
  return Array.from({ length: count }, (_, index) => {
    const position = index * (stops.length - 1) / (count - 1)
    const leftIndex = Math.floor(position)
    const rightIndex = Math.min(stops.length - 1, leftIndex + 1)
    const fraction = position - leftIndex
    const left = hexToRgb(stops[leftIndex])
    const right = hexToRgb(stops[rightIndex])
    return rgbToHex(left.map((value, channel) => value + (right[channel] - value) * fraction) as [number, number, number])
  })
}

function jenksBreaks(values: number[], classCount: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const sampled = sorted.length > 1000
    ? Array.from({ length: 1000 }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / 999)])
    : sorted
  const classes = Math.min(classCount, new Set(sampled).size)
  const size = sampled.length
  const lower = Array.from({ length: size + 1 }, () => new Array<number>(classes + 1).fill(0))
  const variance = Array.from({ length: size + 1 }, () => new Array<number>(classes + 1).fill(Infinity))
  for (let category = 1; category <= classes; category += 1) {
    lower[1][category] = 1
    variance[1][category] = 0
  }
  for (let length = 2; length <= size; length += 1) {
    let sum = 0
    let sumSquares = 0
    let rowVariance = 0
    for (let offset = 1; offset <= length; offset += 1) {
      const start = length - offset + 1
      const value = sampled[start - 1]
      sum += value
      sumSquares += value * value
      const count = offset
      rowVariance = sumSquares - sum * sum / count
      const previous = start - 1
      if (previous > 0) {
        for (let category = 2; category <= classes; category += 1) {
          const candidate = rowVariance + variance[previous][category - 1]
          if (candidate < variance[length][category]) {
            lower[length][category] = start
            variance[length][category] = candidate
          }
        }
      }
    }
    lower[length][1] = 1
    variance[length][1] = rowVariance
  }
  const breaks: number[] = []
  let length = size
  let category = classes
  while (category > 1) {
    const start = lower[length][category]
    if (!start) break
    breaks.push(sampled[start - 1])
    length = start - 1
    category -= 1
  }
  return breaks.reverse().filter((value, index, list) => index === 0 || value > list[index - 1])
}

export function calculateClassBreaks(values: number[], method: ClassificationMethod, requestedClasses: number): number[] {
  if (!Number.isInteger(requestedClasses) || requestedClasses < 2 || requestedClasses > 8) {
    throw new Error('Class count must be an integer from 2 to 8.')
  }
  const finiteValues = values.filter(Number.isFinite)
  const distinct = [...new Set(finiteValues)].sort((a, b) => a - b)
  if (distinct.length < 2) throw new Error('The selected field needs at least two distinct numeric values.')
  const classCount = method === 'equal-interval' ? requestedClasses : Math.min(requestedClasses, distinct.length)
  let breaks: number[]
  if (method === 'equal-interval') {
    const minimum = distinct[0]
    const range = distinct[distinct.length - 1] - minimum
    breaks = Array.from({ length: classCount - 1 }, (_, index) => minimum + range * (index + 1) / classCount)
  } else if (method === 'quantile') {
    const sorted = [...finiteValues].sort((a, b) => a - b)
    breaks = []
    for (let index = 1; index < classCount; index += 1) {
      const position = index * (sorted.length - 1) / classCount
      const lower = Math.floor(position)
      const fraction = position - lower
      const threshold = sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * fraction
      if (threshold > (breaks[breaks.length - 1] ?? -Infinity) && threshold < sorted[sorted.length - 1]) breaks.push(threshold)
    }
  } else {
    breaks = jenksBreaks(finiteValues, classCount)
  }
  return breaks.filter((value, index) => Number.isFinite(value) && value > distinct[0] &&
    (value < distinct[distinct.length - 1] || (method === 'natural-breaks' && value === distinct[distinct.length - 1])) &&
    (index === 0 || value > breaks[index - 1]))
}

export function formatBreak(value: number): string {
  return Math.abs(value) >= 1000 || Number.isInteger(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : value.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

export function getGraduatedClasses(renderer: Extract<RendererConfig, { type: 'graduated' }>): LegendClass[] {
  return renderer.colors.slice(0, renderer.breaks.length + 1).map((color, index) => ({
    value: String(index),
    color,
    count: 0,
    label: renderer.labels?.[index] || (index === 0
      ? `< ${formatBreak(renderer.breaks[0])}`
      : index === renderer.breaks.length
        ? `≥ ${formatBreak(renderer.breaks[index - 1])}`
        : `${formatBreak(renderer.breaks[index - 1])} – ${formatBreak(renderer.breaks[index])}`),
  }))
}

export function getGraduatedClassCounts(layer: MapLayer, renderer: Extract<RendererConfig, { type: 'graduated' }>): number[] {
  const counts = new Array<number>(renderer.breaks.length + 1).fill(0)
  for (const record of properties(layer)) {
    const value = finiteNumber(record[renderer.field])
    if (value === null) continue
    const index = renderer.breaks.findIndex((threshold) => value < threshold)
    counts[index < 0 ? counts.length - 1 : index] += 1
  }
  return counts
}

export function buildUniqueRenderer(
  layer: MapLayer,
  field: string,
  ramp: CategoricalRampId,
  previous?: RendererConfig,
): Extract<RendererConfig, { type: 'unique' }> {
  const existing = previous?.type === 'unique' && previous.field === field ? previous.colors : {}
  const overrides = previous?.type === 'unique' && previous.field === field ? previous.overrides ?? [] : []
  const classes = getUniqueValueClasses(layer, field)
  const colors = sampleCategoricalRamp(ramp, classes.length)
  return {
    type: 'unique',
    field,
    ramp,
    overrides: overrides.filter((value) => classes.some((item) => item.value === value)),
    colors: Object.fromEntries(classes.map((item, index) => [item.value, overrides.includes(item.value) ? existing[item.value] ?? colors[index] : colors[index]])),
  }
}

export function buildGraduatedRenderer(
  layer: MapLayer,
  field: string,
  method: ClassificationMethod,
  classCount: number,
  ramp: ContinuousRampId,
): Extract<RendererConfig, { type: 'graduated' }> {
  const values = properties(layer).map((record) => finiteNumber(record[field])).filter((value): value is number => value !== null)
  const breaks = calculateClassBreaks(values, method, classCount)
  const colors = sampleContinuousRamp(ramp, breaks.length + 1)
  return { type: 'graduated', field, method, ramp, breaks, colors, classCount }
}

export function labelTextExpression(template: string, fallbackField: string): unknown {
  if (!template.trim()) return fallbackField
    ? ['to-string', ['coalesce', ['get', fallbackField], '']]
    : ''
  const parts: unknown[] = []
  const token = /\{([^{}]+)\}/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(template))) {
    if (match.index > cursor) parts.push(template.slice(cursor, match.index))
    const field = match[1].trim()
    if (field) parts.push(['to-string', ['coalesce', ['get', field], '']])
    cursor = match.index + match[0].length
  }
  if (cursor < template.length) parts.push(template.slice(cursor))
  if (!parts.length) return template
  return parts.length === 1 ? parts[0] : ['concat', ...parts]
}
