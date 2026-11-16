import { isolate } from '../../bidi'
import area from '@turf/area'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import buffer from '@turf/buffer'
import cleanCoords from '@turf/clean-coords'
import difference from '@turf/difference'
import { featureCollection, point } from '@turf/helpers'
import intersect from '@turf/intersect'
import rewind from '@turf/rewind'
import union from '@turf/union'
import Papa from 'papaparse'
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { tableRow } from '../../geojson'
import type { MapLayer } from '../../store'
import { fieldNames, outputLayer } from '../shared'
import { splitLineByPolygons, type PolygonFeature } from '../spatial'
import type { ToolboxParameters, ToolDownload, ToolParameter } from '../types'

/** Helpers private to the Analysis toolbox. All geometry is WGS 84. */

export type PolygonGeometry = Polygon | MultiPolygon
export type Row = Record<string, unknown>

/** Polygons smaller than this (square metres) are treated as slivers and dropped. */
const MIN_AREA = 1e-6

export const outputNameParameter = (placeholder: string): ToolParameter => ({
  id: 'outputName', label: 'Output layer name', kind: 'text', placeholder,
})

export const downloadParameter: ToolParameter = {
  id: 'download', label: 'Also download table', kind: 'select', defaultValue: 'no',
  options: [{ value: 'no', label: 'No — table layer only' }, { value: 'csv', label: 'Yes — CSV file' }],
}

export const outputName = (parameters: ToolboxParameters, fallback: string) => {
  const value = parameters.outputName
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export const polygonFeature = (geometry: PolygonGeometry, properties: Row = {}): PolygonFeature =>
  ({ type: 'Feature', properties, geometry })

function cleanRing(ring: Position[] | undefined): Position[] | null {
  if (!ring || ring.length < 4) return null
  try {
    const cleaned = (cleanCoords({ type: 'Polygon', coordinates: [ring] }) as Polygon).coordinates[0]
    return cleaned.length >= 4 ? cleaned : null
  } catch {
    return null
  }
}

/**
 * Topology clean-up for generated polygons: removes duplicate/collinear vertices and
 * degenerate rings, enforces RFC 7946 winding and drops empty or sliver results.
 */
export function cleanPolygonGeometry(geometry: PolygonGeometry | null | undefined): PolygonGeometry | null {
  if (!geometry) return null
  const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const kept: Position[][][] = []
  for (const rings of parts) {
    const outer = cleanRing(rings[0])
    if (!outer) continue
    kept.push([outer, ...rings.slice(1).map(cleanRing).filter((ring): ring is Position[] => ring !== null)])
  }
  if (!kept.length) return null
  const shape: PolygonGeometry = kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept }
  const wound = rewind(shape) as PolygonGeometry
  return area(wound) < MIN_AREA ? null : wound
}

export function unionPolygons(polygons: PolygonFeature[]): PolygonGeometry | null {
  if (!polygons.length) return null
  if (polygons.length === 1) return polygons[0].geometry
  return union(featureCollection(polygons))?.geometry ?? null
}

export const intersectPolygons = (a: PolygonFeature, b: PolygonFeature): PolygonGeometry | null =>
  cleanPolygonGeometry(intersect(featureCollection([a, b]))?.geometry)

export const subtractPolygons = (subject: PolygonFeature, cutters: PolygonFeature[]): PolygonGeometry | null =>
  cleanPolygonGeometry(cutters.length ? difference(featureCollection([subject, ...cutters]))?.geometry : subject.geometry)

/** Joins consecutive line pieces that share an end point, so lines only break where they were cut. */
function joinPaths(pieces: Position[][]): Geometry | null {
  const paths: Position[][] = []
  for (const coordinates of pieces) {
    const previous = paths[paths.length - 1]
    const end = previous?.[previous.length - 1]
    if (end && end[0] === coordinates[0][0] && end[1] === coordinates[0][1]) previous.push(...coordinates.slice(1))
    else paths.push([...coordinates])
  }
  if (!paths.length) return null
  return paths.length === 1 ? { type: 'LineString', coordinates: paths[0] } : { type: 'MultiLineString', coordinates: paths }
}

/**
 * The part of a feature (any geometry type) that lies inside, or outside, a set of polygons.
 * Returns null when nothing remains.
 */
export function overlayGeometry(feature: Feature<Geometry>, polygons: PolygonFeature[], keep: 'inside' | 'outside'): Geometry | null {
  const inside = keep === 'inside'
  const geometry = feature.geometry
  if (!polygons.length) return inside ? null : geometry
  const within = (position: Position) => polygons.some((polygon) => booleanPointInPolygon(point(position), polygon))
  switch (geometry.type) {
    case 'Point':
      return within(geometry.coordinates) === inside ? geometry : null
    case 'MultiPoint': {
      const coordinates = geometry.coordinates.filter((position) => within(position) === inside)
      return coordinates.length ? { type: 'MultiPoint', coordinates } : null
    }
    case 'LineString':
    case 'MultiLineString':
      return joinPaths(splitLineByPolygons(feature, polygons)
        .filter((part) => part.inside === inside)
        .map((part) => part.segment.geometry.coordinates))
    case 'Polygon':
    case 'MultiPolygon': {
      const subject = feature as PolygonFeature
      if (!inside) return subtractPolygons(subject, polygons)
      const mask = unionPolygons(polygons)
      return mask ? intersectPolygons(subject, polygonFeature(mask)) : null
    }
    default:
      return null
  }
}

/** A numeric value, accepting numeric strings; null for empty or non-numeric values. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

export const isEmptyValue = (value: unknown) => value === null || value === undefined || value === ''

/** Sort order for table rows: numbers numerically, text naturally, empty values last. */
export function compareValues(left: unknown, right: unknown): number {
  if (isEmptyValue(left) || isEmptyValue(right)) return Number(isEmptyValue(left)) - Number(isEmptyValue(right))
  const a = toNumber(left)
  const b = toNumber(right)
  if (a !== null && b !== null) return a - b
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

export const round = (value: number, digits: number) => Number(value.toFixed(digits))

export function parseList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

/** Resolves a user-typed field name against a layer's fields (case-insensitive fallback). */
export function resolveField(layer: MapLayer, name: string): string {
  const fields = fieldNames(layer)
  if (fields.includes(name)) return name
  const match = fields.find((field) => field.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (!match) throw new Error(`Field "${isolate(name)}" was not found in ${isolate(layer.name)}.`)
  return match
}

/** A table output: a layer of geometry-less rows (shown only in the attribute table). */
export function tableLayer(name: string, rows: Row[]): MapLayer {
  const features = rows.map((properties) => tableRow(properties))
  return outputLayer(name, { type: 'FeatureCollection', features })
}

export function csvDownload(name: string, rows: Row[], fields: string[]): ToolDownload {
  const csv = Papa.unparse({ fields, data: rows.map((row) => fields.map((field) => row[field] ?? '')) })
  return {
    fileName: `${name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '_')}.csv`,
    blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  }
}

/** Table layer plus an optional CSV download, as chosen by the `download` parameter. */
export function tableResult(parameters: ToolboxParameters, name: string, rows: Row[], fields: string[]) {
  const ordered = rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? null])))
  const layer = tableLayer(name, ordered)
  layer.customFields = [...fields]
  const downloads = parameters.download === 'csv' ? [csvDownload(layer.name, ordered, fields)] : []
  return { layer, downloads }
}

export const distanceUnitParameter: ToolParameter = {
  id: 'unit', label: 'Distance unit', kind: 'select', required: true, defaultValue: 'm',
  options: [{ value: 'm', label: 'Meters' }, { value: 'km', label: 'Kilometers' }],
}

export const unitFactor = (parameters: ToolboxParameters) => parameters.unit === 'km' ? 1000 : 1
export const unitLabel = (parameters: ToolboxParameters) => parameters.unit === 'km' ? 'Kilometers' : 'Meters'

/** Geodesic buffer of a feature by a distance in metres (negative shrinks polygons). */
export function bufferGeometry(feature: Feature<Geometry>, meters: number, steps = 16): PolygonGeometry | null {
  try {
    return cleanPolygonGeometry(buffer(feature, meters / 1000, { units: 'kilometers', steps })?.geometry)
  } catch {
    return null
  }
}
