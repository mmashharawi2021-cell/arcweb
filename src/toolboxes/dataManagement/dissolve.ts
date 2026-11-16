import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import { union } from '@turf/turf'
import type { Feature, Geometry, Position } from 'geojson'
import { fieldNames, getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import {
  compareValues, geometryFamily, outputNameParameter, parseFieldList, polygonsToGeometry, repairPolygonGeometry, yesNoParameter,
} from './_utils'
import type { GeometryFamily } from './_utils'

const STATISTICS = ['SUM', 'MEAN', 'MIN', 'MAX', 'RANGE', 'STD', 'COUNT', 'FIRST', 'LAST'] as const
type Statistic = typeof STATISTICS[number]

interface StatisticField { field: string; statistic: Statistic; output: string }

/** Parses "POP SUM, AREA MEAN" (or "POP:SUM; AREA:MEAN") into statistic definitions. */
export function parseStatistics(text: string, available: string[]): StatisticField[] {
  return text.split(/[,;]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const [name, kind] = item.split(/[\s:]+/)
    const statistic = (kind ?? '').toUpperCase() as Statistic
    if (!STATISTICS.includes(statistic)) throw new Error(`Unknown statistic "${kind ?? ''}" for ${isolate(name)}. Use one of ${STATISTICS.join(', ')}.`)
    const [field] = parseFieldList(name, available)
    return { field, statistic, output: `${statistic}_${field}` }
  })
}

export function computeStatistic(values: unknown[], statistic: Statistic): unknown {
  if (statistic === 'FIRST') return values[0] ?? null
  if (statistic === 'LAST') return values[values.length - 1] ?? null
  const present = values.filter((value) => value !== null && value !== undefined && value !== '')
  if (statistic === 'COUNT') return present.length
  if (statistic === 'MIN' || statistic === 'MAX') {
    if (!present.length) return null
    const sorted = [...present].sort(compareValues)
    return statistic === 'MIN' ? sorted[0] : sorted[sorted.length - 1]
  }
  const numbers = present.map(Number).filter(Number.isFinite)
  if (!numbers.length) return null
  const sum = numbers.reduce((total, value) => total + value, 0)
  if (statistic === 'SUM') return sum
  const mean = sum / numbers.length
  if (statistic === 'MEAN') return mean
  if (statistic === 'RANGE') {
    return numbers.reduce((maximum, value) => Math.max(maximum, value), -Infinity) -
      numbers.reduce((minimum, value) => Math.min(minimum, value), Infinity)
  }
  return Math.sqrt(numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length)
}

function mergeGeometries(family: GeometryFamily, features: Feature<Geometry>[]): Geometry | null {
  if (family === 'point') {
    const coordinates = features.flatMap((feature) => feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiPoint' ? feature.geometry.coordinates : [])
    return coordinates.length === 1 ? { type: 'Point', coordinates: coordinates[0] } : { type: 'MultiPoint', coordinates }
  }
  if (family === 'line') {
    const paths = features.flatMap((feature) => feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [])
    return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths }
  }
  const polygons = features.flatMap((feature) => {
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return []
    const repaired = repairPolygonGeometry(feature.geometry)
    return repaired ? [{ type: 'Feature' as const, properties: {}, geometry: repaired }] : []
  })
  if (!polygons.length) return null
  if (polygons.length === 1) return polygons[0].geometry
  const merged = union(featureCollection(polygons))
  return merged ? repairPolygonGeometry(merged.geometry) : null
}

function explode(geometry: Geometry): Geometry[] {
  switch (geometry.type) {
    case 'MultiPoint': return geometry.coordinates.map((coordinates) => ({ type: 'Point', coordinates }))
    case 'MultiLineString': return geometry.coordinates.map((coordinates) => ({ type: 'LineString', coordinates }))
    case 'MultiPolygon': return geometry.coordinates.map((coordinates: Position[][]) => polygonsToGeometry([coordinates]) as Geometry)
    default: return [geometry]
  }
}

/** Dissolve: merges features that share the same values in the dissolve fields (all features when none are given). */
export const dissolveTool: ToolboxTool = {
  id: 'dissolve',
  name: 'Dissolve',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Aggregate features that share values in the chosen fields, merging their geometry and optionally summarising other fields (SUM, MEAN, MIN, MAX, RANGE, STD, COUNT, FIRST, LAST).',
  keywords: ['aggregate', 'merge', 'union', 'combine', 'group by', 'statistics', 'summarize'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'fields', label: 'Dissolve fields (optional)', kind: 'text', placeholder: 'Comma-separated, e.g. DISTRICT, TYPE — blank dissolves all' },
    { id: 'statistics', label: 'Statistics fields (optional)', kind: 'text', placeholder: 'e.g. POP SUM, AREA MEAN' },
    yesNoParameter('multipart', 'Create multipart features', 'yes', 'Yes — one feature per group', 'No — one feature per separate part'),
    outputNameParameter('Dissolved layer'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const available = fieldNames(layer)
    const fields = parseFieldList(getOptionalText(parameters, 'fields'), available)
    const statistics = parseStatistics(getOptionalText(parameters, 'statistics'), available)
    const multipart = getOptionalText(parameters, 'multipart') !== 'no'

    const groups = new Map<string, { family: GeometryFamily; features: Feature<Geometry>[] }>()
    for (const feature of layer.data.features) {
      const family = geometryFamily(feature.geometry)
      if (!family) continue
      const groupKey = JSON.stringify([family, ...fields.map((field) => feature.properties?.[field] ?? null)])
      const group = groups.get(groupKey) ?? { family, features: [] }
      group.features.push(feature as Feature<Geometry>)
      groups.set(groupKey, group)
    }
    assertHasFeatures([...groups.keys()], 'The input layer has no features with geometry.')

    const output: Feature<Geometry>[] = []
    let failed = 0
    for (const { family, features } of groups.values()) {
      const properties: Record<string, unknown> = {}
      for (const field of fields) properties[field] = features[0].properties?.[field] ?? null
      for (const { field, statistic, output: name } of statistics) {
        properties[name] = computeStatistic(features.map((feature) => feature.properties?.[field]), statistic)
      }
      let geometry: Geometry | null
      try {
        geometry = mergeGeometries(family, features)
      } catch {
        geometry = null
      }
      if (!geometry) { failed += 1; continue }
      for (const part of multipart ? [geometry] : explode(geometry)) output.push({ type: 'Feature', properties: { ...properties }, geometry: part })
    }
    assertHasFeatures(output, 'Dissolve could not produce any valid geometry.')
    const result = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Dissolve`, featureCollection(output), layer.sourceCrs)
    return {
      message: `${isolate(result.name)}: dissolved ${layer.data.features.length.toLocaleString()} features into ${output.length.toLocaleString()}${fields.length ? ` by ${fields.map(isolate).join(', ')}` : ''}.${failed ? ` ${failed} groups could not be merged.` : ''}`,
      kind: failed ? 'warning' : 'success',
      layers: [result],
    }
  },
}
