import JSZip from 'jszip'
import { write as writeShp } from '@mapbox/shp-write'
import rewind from '@turf/rewind'
import type { Feature, Geometry, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import { getCrs, transformGeometry, WGS84 } from '../../crs'
import { scalar } from './_utils'

/**
 * ESRI shapefile writer. shp-write produces the .shp/.shx geometry records; attributes are
 * written by our own UTF-8 dBase writer (shp-write's dbf truncates non-ASCII text, which
 * matters for Arabic/Hebrew place names), with a .cpg declaring the encoding.
 */

const GEOGCS_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

/** ESRI WKT for every coordinate system registered in crs.ts. */
export function esriWkt(code: string): string | null {
  const definition = getCrs(code)
  if (!definition) return null
  if (definition.code === WGS84) return GEOGCS_WGS84
  if (definition.code === 'EPSG:3857') {
    return `PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",${GEOGCS_WGS84},PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]`
  }
  if (definition.code === 'EPSG:2039') {
    return 'PROJCS["Israel_TM_Grid",GEOGCS["GCS_Israel",DATUM["D_Israel",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",219529.584],PARAMETER["False_Northing",626907.39],PARAMETER["Central_Meridian",35.20451694444445],PARAMETER["Scale_Factor",1.0000067],PARAMETER["Latitude_Of_Origin",31.73439361111111],UNIT["Meter",1.0]]'
  }
  if (definition.code === 'EPSG:28191') {
    return 'PROJCS["Palestine_1923_Palestine_Grid",GEOGCS["GCS_Palestine_1923",DATUM["D_Palestine_1923",SPHEROID["Clarke_1880_Benoit",6378300.789,293.4663155389811]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Cassini"],PARAMETER["False_Easting",170251.555],PARAMETER["False_Northing",126867.909],PARAMETER["Central_Meridian",35.21208055555556],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",31.73409694444445],UNIT["Meter",1.0]]'
  }
  const utmMatch = definition.code.match(/^EPSG:(326|327)(\d{2})$/)
  if (utmMatch) {
    const zone = Number(utmMatch[2])
    const south = utmMatch[1] === '327'
    return `PROJCS["WGS_1984_UTM_Zone_${zone}${south ? 'S' : 'N'}",${GEOGCS_WGS84},PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${south ? '10000000.0' : '0.0'}],PARAMETER["Central_Meridian",${-183 + zone * 6}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`
  }
  return null
}

// ---------------------------------------------------------------- dBase

interface DbfField { name: string; source: string; type: 'C' | 'N' | 'L'; size: number; decimals: number }

const encoder = new TextEncoder()

function dbfFieldName(name: string, taken: string[]): string {
  const ascii = name.normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'FIELD'
  let base = ascii.slice(0, 10)
  if (/^\d/.test(base)) base = `F${base}`.slice(0, 10)
  const upper = new Set(taken.map((item) => item.toUpperCase()))
  if (!upper.has(base.toUpperCase())) return base
  for (let suffix = 1; ; suffix += 1) {
    const tail = `_${suffix}`
    const candidate = `${base.slice(0, 10 - tail.length)}${tail}`
    if (!upper.has(candidate.toUpperCase())) return candidate
  }
}

function truncateUtf8(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes
  let end = max
  // Do not cut a multi-byte character in half.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return bytes.slice(0, end)
}

export function buildDbf(rows: Record<string, unknown>[], fieldNames: string[]): { buffer: ArrayBuffer; fields: DbfField[] } {
  const fields: DbfField[] = []
  for (const source of fieldNames) {
    const values = rows.map((row) => row[source]).filter((value) => value !== null && value !== undefined && value !== '')
    const name = dbfFieldName(source, fields.map((field) => field.name))
    if (values.length && values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      const decimals = Math.min(8, values.reduce<number>((maximum, value) => {
        const text = String(value)
        return Math.max(maximum, text.includes('e') ? 8 : (text.split('.')[1]?.length ?? 0))
      }, 0))
      const width = values.reduce<number>((maximum, value) => Math.max(maximum, (value as number).toFixed(decimals).length), 1)
      fields.push({ name, source, type: 'N', size: Math.min(254, Math.max(width, 1)), decimals })
    } else if (values.length && values.every((value) => typeof value === 'boolean')) {
      fields.push({ name, source, type: 'L', size: 1, decimals: 0 })
    } else {
      const width = values.reduce<number>((maximum, value) => Math.max(maximum, encoder.encode(String(scalar(value))).length), 1)
      fields.push({ name, source, type: 'C', size: Math.min(254, width), decimals: 0 })
    }
  }
  const headerLength = 32 + fields.length * 32 + 1
  const recordLength = 1 + fields.reduce((sum, field) => sum + field.size, 0)
  const buffer = new ArrayBuffer(headerLength + recordLength * rows.length + 1)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const now = new Date()
  view.setUint8(0, 0x03)
  view.setUint8(1, now.getFullYear() - 1900)
  view.setUint8(2, now.getMonth() + 1)
  view.setUint8(3, now.getDate())
  view.setUint32(4, rows.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  fields.forEach((field, index) => {
    const offset = 32 + index * 32
    for (let i = 0; i < field.name.length; i += 1) bytes[offset + i] = field.name.charCodeAt(i)
    bytes[offset + 11] = field.type.charCodeAt(0)
    bytes[offset + 16] = field.size
    bytes[offset + 17] = field.decimals
  })
  bytes[headerLength - 1] = 0x0d
  let offset = headerLength
  for (const row of rows) {
    bytes[offset] = 0x20
    offset += 1
    for (const field of fields) {
      const value = row[field.source]
      bytes.fill(0x20, offset, offset + field.size)
      if (value !== null && value !== undefined && value !== '') {
        if (field.type === 'N') {
          const text = (value as number).toFixed(field.decimals).slice(0, field.size).padStart(field.size, ' ')
          for (let i = 0; i < field.size; i += 1) bytes[offset + i] = text.charCodeAt(i)
        } else if (field.type === 'L') {
          bytes[offset] = value ? 0x54 : 0x46
        } else {
          bytes.set(truncateUtf8(encoder.encode(String(scalar(value))), field.size), offset)
        }
      } else if (field.type === 'L') {
        bytes[offset] = 0x3f
      }
      offset += field.size
    }
  }
  bytes[offset] = 0x1a
  return { buffer, fields }
}

// ---------------------------------------------------------------- Shapefile

type ShapeType = 'POINT' | 'POLYLINE' | 'POLYGON'

interface ShapeGroup { type: ShapeType; suffix: string; geometries: unknown[]; rows: Record<string, unknown>[] }

function groupFeatures(features: Feature[], crs: string) {
  const groups: Record<ShapeType, ShapeGroup> = {
    POINT: { type: 'POINT', suffix: 'point', geometries: [], rows: [] },
    POLYLINE: { type: 'POLYLINE', suffix: 'line', geometries: [], rows: [] },
    POLYGON: { type: 'POLYGON', suffix: 'polygon', geometries: [], rows: [] },
  }
  let explodedMultipoints = 0
  let skipped = 0
  const add = (geometry: Geometry, row: Record<string, unknown>) => {
    switch (geometry.type) {
      case 'Point':
        groups.POINT.geometries.push(geometry.coordinates)
        groups.POINT.rows.push(row)
        break
      case 'MultiPoint':
        explodedMultipoints += 1
        geometry.coordinates.forEach((position) => add({ type: 'Point', coordinates: position }, row))
        break
      case 'LineString':
      case 'MultiLineString': {
        const lines = (geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates).filter((line) => line.length > 1)
        if (!lines.length) { skipped += 1; break }
        groups.POLYLINE.geometries.push(lines satisfies MultiLineString['coordinates'])
        groups.POLYLINE.rows.push(row)
        break
      }
      case 'Polygon':
      case 'MultiPolygon': {
        // Shapefiles store outer rings clockwise and holes counter-clockwise.
        const wound = rewind(geometry, { reverse: true }) as Polygon | MultiPolygon
        const polygons: Position[][][] = (wound.type === 'Polygon' ? [wound.coordinates] : wound.coordinates).filter((rings) => rings.length && rings[0].length >= 4)
        if (!polygons.length) { skipped += 1; break }
        groups.POLYGON.geometries.push(polygons)
        groups.POLYGON.rows.push(row)
        break
      }
      case 'GeometryCollection':
        geometry.geometries.forEach((child) => add(child, row))
        break
    }
  }
  for (const feature of features) {
    if (!feature.geometry) { skipped += 1; continue }
    const geometry = crs === WGS84 ? feature.geometry : transformGeometry(feature.geometry, WGS84, crs)
    add(geometry, feature.properties ?? {})
  }
  return { groups: Object.values(groups).filter((group) => group.geometries.length), explodedMultipoints, skipped }
}

export interface ShapefileResult { blob: Blob; files: string[]; warnings: string[] }

/** Builds a zipped shapefile set (one .shp per geometry family) in `crs` with a matching .prj. */
export async function buildShapefileZip(features: Feature[], fieldNames: string[], baseName: string, crs: string = WGS84): Promise<ShapefileResult> {
  const prj = esriWkt(crs)
  if (!prj) throw new Error(`No .prj definition is available for ${crs}.`)
  const { groups, explodedMultipoints, skipped } = groupFeatures(features, getCrs(crs)?.code ?? crs)
  if (!groups.length) throw new Error('The selected layer has no features with geometry to export.')
  const zip = new JSZip()
  const files: string[] = []
  const warnings: string[] = []
  let renamed: string[] = []
  for (const group of groups) {
    const name = groups.length === 1 ? baseName : `${baseName}_${group.suffix}`
    let shp: DataView | undefined
    let shx: DataView | undefined
    writeShp(group.rows.map(() => ({})), group.type, group.geometries as object[], (error, data) => {
      if (error) throw error
      shp = data.shp as DataView
      shx = data.shx as DataView
    })
    if (!shp || !shx) throw new Error('The shapefile writer failed.')
    const { buffer, fields } = buildDbf(group.rows, fieldNames)
    renamed = fields.filter((field) => field.name !== field.source).map((field) => `${field.source} → ${field.name}`)
    zip.file(`${name}.shp`, new Uint8Array(shp.buffer as ArrayBuffer, shp.byteOffset, shp.byteLength))
    zip.file(`${name}.shx`, new Uint8Array(shx.buffer as ArrayBuffer, shx.byteOffset, shx.byteLength))
    zip.file(`${name}.dbf`, buffer)
    zip.file(`${name}.prj`, prj)
    zip.file(`${name}.cpg`, 'UTF-8')
    files.push(`${name}.shp`, `${name}.shx`, `${name}.dbf`, `${name}.prj`, `${name}.cpg`)
  }
  if (groups.length > 1) warnings.push(`Mixed geometry was split into ${groups.length} shapefiles.`)
  if (explodedMultipoints) warnings.push(`${explodedMultipoints} multipoint feature(s) were written as separate points.`)
  if (skipped) warnings.push(`${skipped} feature(s) without usable geometry were skipped.`)
  if (renamed.length) warnings.push(`Field names were shortened for dBase: ${renamed.join(', ')}.`)
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { blob, files, warnings }
}

