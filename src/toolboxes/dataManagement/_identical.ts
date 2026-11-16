import type { Feature, Geometry } from 'geojson'
import type { MapLayer } from '../../store'
import { fieldNames, getOptionalText } from '../shared'
import type { ToolboxParameters, ToolParameter } from '../types'
import { mapPositions, METERS_PER_DEGREE, optionalNumber, parseFieldList } from './_utils'

/** Shared parameters and hashing for Find Identical and Delete Identical. */
export const identicalParameters: ToolParameter[] = [
  { id: 'target', label: 'Input layer', kind: 'layer', required: true },
  { id: 'fields', label: 'Fields to compare', kind: 'text', required: true, defaultValue: 'Shape', placeholder: 'Comma-separated; "Shape" compares geometry, e.g. Shape, NAME' },
  { id: 'tolerance', label: 'XY tolerance (m, optional)', kind: 'number', min: 0, defaultValue: 0 },
]

/**
 * Groups features whose compared fields (and geometry, for "Shape") are identical.
 * Geometry is compared after snapping coordinates to a grid of the XY tolerance, so the
 * work is a single hashing pass rather than pairwise comparison.
 */
export function identicalGroups(layer: MapLayer, parameters: ToolboxParameters): { groups: number[][]; compared: string[] } {
  const requested = getOptionalText(parameters, 'fields') || 'Shape'
  const names = requested.split(/[,;]/).map((name) => name.trim()).filter(Boolean)
  const useShape = names.some((name) => name.toLowerCase() === 'shape')
  const fields = parseFieldList(names.filter((name) => name.toLowerCase() !== 'shape').join(','), fieldNames(layer))
  if (!useShape && !fields.length) throw new Error('Enter at least one field (or "Shape") to compare.')
  const tolerance = optionalNumber(parameters, 'tolerance', 'XY tolerance') ?? 0
  if (tolerance < 0) throw new Error('The XY tolerance cannot be negative.')
  const grid = tolerance > 0 ? tolerance / METERS_PER_DEGREE : 1e-9
  const snap = (geometry: Geometry | null) => geometry
    ? JSON.stringify(mapPositions(geometry, (position) => position.map((value) => Math.round(value / grid))))
    : 'null'

  const buckets = new Map<string, number[]>()
  layer.data.features.forEach((feature: Feature, index) => {
    const key = JSON.stringify([useShape ? snap(feature.geometry ?? null) : '', ...fields.map((field) => feature.properties?.[field] ?? null)])
    const bucket = buckets.get(key)
    if (bucket) bucket.push(index)
    else buckets.set(key, [index])
  })
  return { groups: [...buckets.values()], compared: [...(useShape ? ['Shape'] : []), ...fields] }
}
