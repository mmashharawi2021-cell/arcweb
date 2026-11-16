import Papa from 'papaparse'
import proj4 from 'proj4'
import { kml } from '@tmcw/togeojson'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { getCrs, normalizeCrsCode, WGS84 } from './crs'
import type { GeometryKind, MapLayer } from './store'
import JSZip from 'jszip'
import shp from 'shpjs'

export interface ImportedLayerData {
  name: string
  data: FeatureCollection
  warnings: string[]
  /** Spatial reference of the source file: an EPSG code or the name from a .prj file. */
  sourceCrs: string
}

function isFeatureCollection(value: unknown): value is FeatureCollection {
  return typeof value === 'object' && value !== null &&
    (value as { type?: string }).type === 'FeatureCollection' &&
    Array.isArray((value as { features?: unknown }).features)
}

function normalizeGeoJSON(input: unknown, warnings: string[] = []): FeatureCollection {
  let parsed: unknown = input
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input)
    } catch (error) {
      throw new Error(`The file is not valid JSON (${error instanceof Error ? error.message : String(error)}).`)
    }
  }
  if (isFeatureCollection(parsed)) {
    // Drop entries that are not Feature objects (e.g. null) instead of failing the whole file.
    const features = (parsed.features as unknown[]).filter((feature): feature is Feature =>
      typeof feature === 'object' && feature !== null && (feature as { type?: unknown }).type === 'Feature')
    const skipped = parsed.features.length - features.length
    if (skipped) warnings.push(`Skipped ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'} in the feature list.`)
    return skipped ? { ...parsed, features } : parsed
  }
  if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: string }).type === 'Feature') {
    return { type: 'FeatureCollection', features: [parsed as Feature] }
  }
  if (typeof parsed === 'object' && parsed !== null && 'type' in parsed &&
    ('coordinates' in parsed || (parsed as { type?: string }).type === 'GeometryCollection')) {
    const geometry = parsed as Geometry
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] }
  }
  throw new Error('The file does not contain valid GeoJSON features.')
}

function walkCoordinates(value: unknown, visit: (position: Position) => Position): unknown {
  if (!Array.isArray(value)) return value
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return visit(value as Position)
  }
  return value.map((child) => walkCoordinates(child, visit))
}

function geometryCoordinates(geometry: Geometry): unknown {
  return 'coordinates' in geometry ? geometry.coordinates : geometry.geometries.map(geometryCoordinates)
}

function coordinateBounds(collection: FeatureCollection) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry) continue
    walkCoordinates(geometryCoordinates(geometry), ([x, y]) => {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x)
        bounds[3] = Math.max(bounds[3], y)
      }
      return [x, y]
    })
  }
  return bounds
}

/** Returns the collection in WGS 84 together with the coordinate system it was declared in. */
function validateOrReproject(collection: FeatureCollection): { data: FeatureCollection; crs: string } {
  const bounds = coordinateBounds(collection)
  if (!Number.isFinite(bounds[0])) throw new Error('This file has no usable coordinates.')
  const root = collection as FeatureCollection & {
    crs?: { properties?: { name?: string; href?: string } }
  }
  const crsName = root.crs?.properties?.name ?? root.crs?.properties?.href
  const isWgs84Bounds = (value: number[]) =>
    value[0] >= -180 && value[2] <= 180 && value[1] >= -90 && value[3] <= 90
  if (!crsName) {
    if (isWgs84Bounds(bounds)) return { data: collection, crs: WGS84 }
    throw new Error('Coordinates fall outside WGS84 and the file has no CRS definition to reproject safely.')
  }
  if (/CRS84/i.test(crsName)) {
    if (isWgs84Bounds(bounds)) return { data: collection, crs: WGS84 }
    throw new Error('Coordinates declared as CRS84 are outside valid WGS84 bounds.')
  }
  const source = normalizeCrsCode(crsName)
  if (!source) throw new Error(`Unsupported coordinate reference system: ${crsName}`)
  const code = Number(source.replace('EPSG:', ''))
  if (code === 4326) {
    if (isWgs84Bounds(bounds)) return { data: collection, crs: WGS84 }
    throw new Error('Coordinates declared as EPSG:4326 are outside valid WGS84 bounds.')
  }
  // Registered systems (see crs.ts) resolve by code; anything else must already be known to proj4.
  const sourceDefinition = getCrs(source)?.code ?? source
  if (!proj4.defs(sourceDefinition)) {
    throw new Error(`Unsupported coordinate reference system ${source}. Reproject the data to WGS 84 (EPSG:4326) or a supported system and import it again.`)
  }
  try {
    for (const feature of collection.features) {
      if (feature.geometry) {
        feature.geometry = transformGeometry(feature.geometry, sourceDefinition)
      }
    }
  } catch (error) {
    // proj4 throws plain strings as well as Error objects.
    throw new Error(`Could not reproject ${source} coordinates: ${error instanceof Error ? error.message : String(error)}`)
  }
  const projectedBounds = coordinateBounds(collection)
  if (projectedBounds[0] < -180 || projectedBounds[2] > 180 || projectedBounds[1] < -90 || projectedBounds[3] > 90) {
    throw new Error(`Reprojected ${source} coordinates are outside valid WGS84 bounds.`)
  }
  // The coordinates are WGS 84 now, so the original CRS member would be misleading.
  delete root.crs
  return { data: collection, crs: source }
}

function transformGeometry(geometry: Geometry, source: string): Geometry {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((child) => transformGeometry(child, source)) }
  }
  return {
    ...geometry,
    coordinates: walkCoordinates(geometry.coordinates, ([x, y, ...rest]) => [
      ...proj4(source, 'EPSG:4326', [x, y]),
      ...rest,
    ]),
  } as Geometry
}

function detectGeometry(collection: FeatureCollection): GeometryKind {
  const kinds = new Set(collection.features.flatMap((feature) => {
    const visit = (geometry: Geometry | null): GeometryKind[] => {
      if (!geometry) return []
      if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(visit)
      if (geometry.type.includes('Point')) return ['Point']
      if (geometry.type.includes('Line')) return ['Line']
      if (geometry.type.includes('Polygon')) return ['Polygon']
      return []
    }
    return visit(feature.geometry)
  }))
  if (kinds.size > 1) return 'Mixed'
  return (kinds.values().next().value as GeometryKind | undefined) ?? 'Unknown'
}

function isLatField(value: string) {
  return ['lat', 'latitude', 'y'].includes(value.trim().toLowerCase())
}

function isLonField(value: string) {
  return ['lon', 'lng', 'long', 'longitude', 'x'].includes(value.trim().toLowerCase())
}

function importCsv(text: string, warnings: string[] = []): FeatureCollection {
  if (!text.replace(/^﻿/, '').trim()) throw new Error('The CSV file is empty.')
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
  if (result.errors.length && result.data.length === 0) throw new Error(result.errors[0].message)
  const fields = result.meta.fields ?? []
  const latField = fields.find(isLatField)
  const lonField = fields.find(isLonField)
  if (!latField || !lonField) {
    throw new Error('CSV needs latitude and longitude columns (for example, lat/lon or latitude/longitude).')
  }
  const features: Feature[] = []
  // Number('') is 0, so a blank cell must count as missing rather than as 0° (a point off West Africa).
  const coordinate = (value: string | undefined) => value === undefined || value.trim() === '' ? Number.NaN : Number(value)
  for (const row of result.data) {
    const latitude = coordinate(row[latField])
    const longitude = coordinate(row[lonField])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue
    features.push({
      type: 'Feature',
      properties: { ...row },
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
    })
  }
  if (!features.length) throw new Error('No CSV rows contained valid WGS84 latitude/longitude values.')
  const skipped = result.data.length - features.length
  if (skipped) warnings.push(`Skipped ${skipped} of ${result.data.length} rows without valid WGS84 ${latField}/${lonField} values.`)
  return { type: 'FeatureCollection', features }
}

function parseKml(text: string): FeatureCollection {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('The KML file is malformed XML.')
  const collection = kml(document)
  if (!collection.features.length) throw new Error('The KML file contains no placemarks.')
  const features = collection.features.filter((feature): feature is Feature<Geometry> => feature.geometry !== null)
  if (!features.length) throw new Error('The KML file contains no placemarks with usable geometry.')
  return { type: 'FeatureCollection', features }
}

export async function readGeospatialFile(file: File): Promise<ImportedLayerData[]> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  let collections: (Omit<ImportedLayerData, 'sourceCrs'> & { sourceCrs?: string })[]
  if (extension === 'zip') {
    let zip: Awaited<ReturnType<typeof shp>>
    try {
      zip = await shp(await file.arrayBuffer())
    } catch (error) {
      // shpjs reports internal codes (e.g. "but-unzip~2") that mean nothing to a student.
      throw new Error(`Could not read the ZIP as a shapefile. Make sure it is a valid .zip containing .shp, .shx and .dbf files (${error instanceof Error ? error.message : String(error)}).`)
    }
    const warnings: string[] = []
    const archive = await JSZip.loadAsync(file)
    const projectionFiles = Object.keys(archive.files).filter((name) => name.toLowerCase().endsWith('.prj'))
    if (!projectionFiles.length) warnings.push('No .prj file was found; the shapefile coordinates are assumed to be WGS84.')
    // shpjs reprojects to WGS 84 using the .prj; keep the system's name for Map Properties.
    const projectionNames = new Map<string, string>()
    for (const name of projectionFiles) {
      const wkt = await archive.files[name].async('string')
      const title = wkt.match(/^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS)\s*\[\s*"([^"]+)"/i)?.[1]
      if (title) projectionNames.set(name.replace(/^.*\//, '').replace(/\.prj$/i, '').toLowerCase(), title.replace(/_/g, ' '))
    }
    const projectionFor = (name: string) => projectionNames.get(name.replace(/^.*\//, '').toLowerCase()) ??
      (projectionNames.size === 1 ? [...projectionNames.values()][0] : projectionFiles.length ? 'Defined by .prj' : `${WGS84} (assumed)`)
    const entries = Array.isArray(zip) ? zip.map((data, index) => [`${file.name.replace(/\.zip$/i, '')} ${index + 1}`, data] as const) :
      'type' in zip && zip.type === 'FeatureCollection' ? [[file.name.replace(/\.zip$/i, ''), zip] as const] :
        Object.entries(zip)
    collections = entries.map(([name, data]) => ({
      name,
      data: data as FeatureCollection,
      warnings,
      sourceCrs: projectionFor(name),
    }))
  } else if (extension === 'kml') {
    collections = [{ name: file.name.replace(/\.kml$/i, ''), data: parseKml(await file.text()), warnings: [] }]
  } else if (extension === 'json' || extension === 'geojson') {
    const warnings: string[] = []
    collections = [{ name: file.name.replace(/\.(geojson|json)$/i, ''), data: normalizeGeoJSON(await file.text(), warnings), warnings }]
  } else if (extension === 'csv') {
    const warnings: string[] = []
    collections = [{ name: file.name.replace(/\.csv$/i, ''), data: importCsv(await file.text(), warnings), warnings }]
  } else {
    throw new Error(`Unsupported file type: .${extension ?? 'unknown'}`)
  }
  return collections.map((item) => {
    const { data, crs } = validateOrReproject(item.data)
    return { ...item, data, sourceCrs: item.sourceCrs ?? crs }
  })
}

export function createMapLayer(name: string, data: FeatureCollection, sourceCrs: string = WGS84): MapLayer {
  const id = crypto.randomUUID()
  const featureIds = new Set<string | number>()
  data.features.forEach((feature, index) => {
    const originalId = feature.id ?? `${id}:${index}`
    let uniqueId = originalId
    let suffix = 1
    while (featureIds.has(uniqueId)) {
      uniqueId = `${String(originalId)}:${suffix}`
      suffix += 1
    }
    feature.id = uniqueId
    featureIds.add(uniqueId)
  })
  return {
    id,
    name,
    data,
    geometry: detectGeometry(data),
    visible: true,
    opacity: 0.88,
    fillColor: '#f5a623',
    strokeColor: '#ffe0a3',
    strokeWidth: 2,
    strokeDash: 'solid',
    fillOpacity: 1,
    pointRadius: 6,
    pointShape: 'circle',
    labelField: '',
    labelStyle: {
      enabled: false,
      expression: '',
      fontSize: 11,
      color: '#ffe0a3',
      haloColor: 'rgba(18, 22, 30, 0.88)',
      haloWidth: 1.4,
      placement: 'point',
      offset: 1.15,
    },
    customFields: [],
    fieldAliases: {},
    renderer: { type: 'single' },
    sourceCrs,
  }
}

export function getFeatureBounds(feature: Feature) {
  const bounds = coordinateBounds({ type: 'FeatureCollection', features: [feature] })
  return bounds.every(Number.isFinite) ? bounds as [number, number, number, number] : null
}

export function getCollectionBounds(collections: FeatureCollection[]) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const collection of collections) {
    const current = coordinateBounds(collection)
    bounds[0] = Math.min(bounds[0], current[0])
    bounds[1] = Math.min(bounds[1], current[1])
    bounds[2] = Math.max(bounds[2], current[2])
    bounds[3] = Math.max(bounds[3], current[3])
  }
  return bounds.every(Number.isFinite) ? bounds as [number, number, number, number] : null
}
