import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/universal'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { tableRow } from '../../geojson'
import { EARTH_RADIUS } from '../spatial'

/** Helpers shared by the Conversion toolbox. All geometry is WGS 84 unless noted. */

export function safeName(value: string): string {
  return value.trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('') || 'arcweb-export'
}

export function xmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters other than tab/newline/carriage return are not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** Features of a layer as plain GeoJSON: ArcWeb's generated IDs are dropped, user IDs are kept. */
export function exportableFeatures(layer: MapLayer): Feature[] {
  const prefix = `${layer.id}:`
  return layer.data.features.map((feature) => {
    const copy: Feature = { type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry: feature.geometry }
    if (feature.id !== undefined && !String(feature.id).startsWith(prefix)) copy.id = feature.id
    return copy
  })
}

export function layerFields(layer: MapLayer): string[] {
  const names = new Set<string>(layer.customFields ?? [])
  for (const feature of layer.data.features) Object.keys(feature.properties ?? {}).forEach((name) => names.add(name))
  return [...names]
}

/** A field name that does not collide with the existing ones (`X` becomes `X_1`). */
export function uniqueField(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let candidate = name
  let suffix = 1
  while (used.has(candidate)) candidate = `${name}_${suffix++}`
  return candidate
}

/** Attribute values as flat scalars for text formats (objects become JSON). */
export function scalar(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return value as string | number | boolean
}

// ---------------------------------------------------------------- WKT

const wktNumber = (value: number) => String(Number(value.toPrecision(15)))
const wktPosition = (position: Position) => position.slice(0, 3).map(wktNumber).join(' ')
const wktList = (positions: Position[]) => `(${positions.map(wktPosition).join(', ')})`
const wktRings = (rings: Position[][]) => `(${rings.map(wktList).join(', ')})`

export function toWkt(geometry: Geometry | null): string {
  if (!geometry) return ''
  switch (geometry.type) {
    case 'Point': return `POINT (${wktPosition(geometry.coordinates)})`
    case 'MultiPoint': return geometry.coordinates.length ? `MULTIPOINT (${geometry.coordinates.map((p) => `(${wktPosition(p)})`).join(', ')})` : 'MULTIPOINT EMPTY'
    case 'LineString': return geometry.coordinates.length ? `LINESTRING ${wktList(geometry.coordinates)}` : 'LINESTRING EMPTY'
    case 'MultiLineString': return geometry.coordinates.length ? `MULTILINESTRING (${geometry.coordinates.map(wktList).join(', ')})` : 'MULTILINESTRING EMPTY'
    case 'Polygon': return geometry.coordinates.length ? `POLYGON ${wktRings(geometry.coordinates)}` : 'POLYGON EMPTY'
    case 'MultiPolygon': return geometry.coordinates.length ? `MULTIPOLYGON (${geometry.coordinates.map(wktRings).join(', ')})` : 'MULTIPOLYGON EMPTY'
    case 'GeometryCollection': return `GEOMETRYCOLLECTION (${geometry.geometries.map(toWkt).join(', ')})`
  }
}

// ---------------------------------------------------------------- Geodesy

const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const toDegrees = (radians: number) => (radians * 180) / Math.PI

/** Great-circle (haversine) distance in metres. */
export function distanceMeters(a: Position, b: Position): number {
  const lat1 = toRadians(a[1])
  const lat2 = toRadians(b[1])
  const dLat = lat2 - lat1
  const dLon = toRadians(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Point at fraction `t` along the great circle from `a` to `b`. */
export function interpolateGreatCircle(a: Position, b: Position, t: number): Position {
  const lat1 = toRadians(a[1])
  const lon1 = toRadians(a[0])
  const lat2 = toRadians(b[1])
  const lon2 = toRadians(b[0])
  const angle = distanceMeters(a, b) / EARTH_RADIUS
  if (angle === 0) return [a[0], a[1]]
  const sinAngle = Math.sin(angle)
  const fa = Math.sin((1 - t) * angle) / sinAngle
  const fb = Math.sin(t * angle) / sinAngle
  const x = fa * Math.cos(lat1) * Math.cos(lon1) + fb * Math.cos(lat2) * Math.cos(lon2)
  const y = fa * Math.cos(lat1) * Math.sin(lon1) + fb * Math.cos(lat2) * Math.sin(lon2)
  const z = fa * Math.sin(lat1) + fb * Math.sin(lat2)
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)))]
}

/**
 * Local equirectangular projection in metres around a reference latitude/longitude.
 * Accurate to well under 0.1 % over the extents of a typical student dataset.
 */
export function localProjection(originLon: number, originLat: number) {
  const k = Math.cos(toRadians(originLat))
  const scale = (Math.PI / 180) * EARTH_RADIUS
  return {
    forward: (position: Position): [number, number] => [(position[0] - originLon) * scale * k, (position[1] - originLat) * scale],
    inverse: (xy: Position): [number, number] => [xy[0] / (scale * k) + originLon, xy[1] / scale + originLat],
  }
}

// ---------------------------------------------------------------- Tables

export type TableCell = string | number | boolean | null

/** Turns spreadsheet rows (first row = header) into geometry-less features. */
export function rowsToRecords(rows: unknown[][]): { fields: string[]; records: Record<string, TableCell>[] } {
  const nonEmpty = rows.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''))
  if (!nonEmpty.length) throw new Error('The table is empty.')
  const [header, ...body] = nonEmpty
  const width = nonEmpty.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  const fields: string[] = []
  for (let index = 0; index < width; index += 1) {
    const raw = header[index]
    const base = raw === null || raw === undefined || String(raw).trim() === '' ? `Field${index + 1}` : String(raw).trim()
    fields.push(uniqueField(base, fields))
  }
  const records = body.map((row) => {
    const record: Record<string, TableCell> = {}
    fields.forEach((field, index) => {
      const value = row[index]
      record[field] = value === undefined || value === null || value === '' ? null
        : value instanceof Date ? value.toISOString()
          : typeof value === 'number' || typeof value === 'boolean' ? value
            : String(value)
    })
    return record
  })
  return { fields, records }
}

export function recordsToTable(records: Record<string, TableCell>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: records.map((properties) => tableRow(properties)),
  }
}

export function parseCsvRows(text: string): unknown[][] {
  const result = Papa.parse<unknown[]>(text.replace(/^﻿/, ''), { header: false, skipEmptyLines: 'greedy', dynamicTyping: true })
  if (!result.data.length && result.errors.length) throw new Error(`CSV could not be read: ${result.errors[0].message}`)
  return result.data
}

/** Reads a .csv/.txt or .xlsx file into header-keyed records. */
export async function readTableFile(file: File, sheet?: string): Promise<{ fields: string[]; records: Record<string, TableCell>[]; sheetName?: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
    return rowsToRecords(parseCsvRows(await file.text()))
  }
  if (extension === 'xlsx') {
    const sheets = await readXlsxFile(await file.arrayBuffer())
    if (!sheets.length) throw new Error('The workbook contains no sheets.')
    const chosen = sheet ? sheets.find((item) => item.sheet.toLowerCase() === sheet.toLowerCase()) : sheets[0]
    if (!chosen) throw new Error(`Sheet "${sheet}" was not found. Available sheets: ${sheets.map((item) => item.sheet).join(', ')}.`)
    return { ...rowsToRecords(chosen.data as unknown[][]), sheetName: chosen.sheet }
  }
  if (extension === 'xls') throw new Error('Legacy .xls workbooks are not supported. Save the sheet as .xlsx or .csv first.')
  throw new Error(`Unsupported table file type: .${extension ?? 'unknown'}. Use .xlsx or .csv.`)
}

export function featureCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features }
}
