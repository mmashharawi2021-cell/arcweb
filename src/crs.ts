import proj4 from 'proj4'
import type { Geometry, Position } from 'geojson'

/**
 * Coordinate reference system registry.
 *
 * ArcWeb stores and renders every layer in WGS 84 (EPSG:4326). This module is the
 * single place that knows about other coordinate systems: it registers their
 * definitions with proj4 and offers helpers for the coordinate readout, the
 * Project tool, planar measurements and CRS-tagged imports.
 */

export type CrsGroup = 'Geographic' | 'Web mapping' | 'Palestine / Israel grids' | 'UTM (WGS 84)'

export interface CrsDefinition {
  /** Authority code, e.g. `EPSG:32636`. */
  code: string
  name: string
  kind: 'geographic' | 'projected'
  unit: 'degree' | 'metre'
  group: CrsGroup
  datum: string
  projection: string
  proj4: string
  areaOfUse: string
  /** Area of use as [west, south, east, north] in WGS 84 degrees. */
  bounds: [number, number, number, number]
}

export const WGS84 = 'EPSG:4326'

const featured: CrsDefinition[] = [
  {
    code: 'EPSG:4326',
    name: 'WGS 84',
    kind: 'geographic',
    unit: 'degree',
    group: 'Geographic',
    datum: 'World Geodetic System 1984',
    projection: 'Geographic (latitude / longitude)',
    proj4: '+proj=longlat +datum=WGS84 +no_defs',
    areaOfUse: 'World',
    bounds: [-180, -90, 180, 90],
  },
  {
    code: 'EPSG:3857',
    name: 'WGS 84 / Web Mercator',
    kind: 'projected',
    unit: 'metre',
    group: 'Web mapping',
    datum: 'World Geodetic System 1984',
    projection: 'Popular Visualisation Pseudo-Mercator',
    proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
    areaOfUse: 'World between 85.06°S and 85.06°N',
    bounds: [-180, -85.06, 180, 85.06],
  },
  {
    code: 'EPSG:28191',
    name: 'Palestine 1923 / Palestine Grid',
    kind: 'projected',
    unit: 'metre',
    group: 'Palestine / Israel grids',
    datum: 'Palestine 1923 (Clarke 1880 Benoit)',
    projection: 'Cassini-Soldner',
    proj4: '+proj=cass +lat_0=31.7340969444444 +lon_0=35.2120805555556 +x_0=170251.555 +y_0=126867.909 +a=6378300.789 +b=6356566.435 +towgs84=-275.7224,94.7824,340.8944,-8.001,-4.42,-11.821,1 +units=m +no_defs',
    areaOfUse: 'Palestine, Israel and Jordan — onshore',
    bounds: [34.17, 29.18, 39.31, 33.38],
  },
  {
    code: 'EPSG:2039',
    name: 'Israel 1993 / Israeli TM Grid',
    kind: 'projected',
    unit: 'metre',
    group: 'Palestine / Israel grids',
    datum: 'Israel 1993 (GRS 1980)',
    projection: 'Transverse Mercator',
    proj4: '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs',
    areaOfUse: 'Israel and Palestine — onshore',
    bounds: [34.17, 29.45, 35.69, 33.28],
  },
]

function utmDefinition(zone: number, south: boolean): CrsDefinition {
  const west = -180 + (zone - 1) * 6
  return {
    code: `EPSG:${(south ? 32700 : 32600) + zone}`,
    name: `WGS 84 / UTM zone ${zone}${south ? 'S' : 'N'}`,
    kind: 'projected',
    unit: 'metre',
    group: 'UTM (WGS 84)',
    datum: 'World Geodetic System 1984',
    projection: 'Transverse Mercator',
    proj4: `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
    areaOfUse: `${Math.abs(west)}°${west < 0 ? 'W' : 'E'} to ${Math.abs(west + 6)}°${west + 6 < 0 ? 'W' : 'E'}, ${south ? 'southern' : 'northern'} hemisphere`,
    bounds: south ? [west, -80, west + 6, 0] : [west, 0, west + 6, 84],
  }
}

/** UTM zones students in the region reach for first; listed ahead of the full set. */
const featuredUtmZones = [36, 37]

const utmZones: CrsDefinition[] = [
  ...featuredUtmZones.map((zone) => utmDefinition(zone, false)),
  ...Array.from({ length: 60 }, (_, index) => index + 1).flatMap((zone) => [
    ...(featuredUtmZones.includes(zone) ? [] : [utmDefinition(zone, false)]),
    utmDefinition(zone, true),
  ]),
]

export const coordinateSystems: CrsDefinition[] = [...featured, ...utmZones]

const registry = new Map<string, CrsDefinition>()
for (const definition of coordinateSystems) {
  registry.set(definition.code, definition)
  proj4.defs(definition.code, definition.proj4)
}

export const crsGroups: CrsGroup[] = ['Geographic', 'Web mapping', 'Palestine / Israel grids', 'UTM (WGS 84)']

/** Normalises `epsg:2039`, `urn:ogc:def:crs:EPSG::2039` and similar spellings to `EPSG:2039`. */
export function normalizeCrsCode(value: string): string | null {
  if (/CRS84/i.test(value)) return WGS84
  const match = value.match(/EPSG(?::{1,2}|\/(?:\d+(?:\.\d+)*\/)?)(\d+)/i)
  return match ? `EPSG:${Number(match[1])}` : null
}

export function getCrs(code: string): CrsDefinition | null {
  return registry.get(normalizeCrsCode(code) ?? code) ?? null
}

export function requireCrs(code: string): CrsDefinition {
  const definition = getCrs(code)
  if (!definition) {
    throw new Error(`Unsupported coordinate system: ${code}. ArcWeb supports WGS 84, Web Mercator, UTM zones, Palestine 1923 Grid and Israeli TM Grid.`)
  }
  return definition
}

/** A human label for a stored spatial reference, which may be a code or a free-form .prj name. */
export function crsLabel(code: string): string {
  const definition = getCrs(code)
  return definition ? `${definition.name} (${definition.code})` : code
}

export const crsSelectOptions = coordinateSystems.map((definition) => ({
  value: definition.code,
  label: `${definition.name} (${definition.code})`,
}))

export function utmCodeFor(longitude: number, latitude: number): string {
  const zone = Math.max(1, Math.min(60, Math.floor((longitude + 180) / 6) + 1))
  return `EPSG:${(latitude < 0 ? 32700 : 32600) + zone}`
}

export function isInsideAreaOfUse(definition: CrsDefinition, longitude: number, latitude: number): boolean {
  const [west, south, east, north] = definition.bounds
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north
}

/** Transforms one [x, y] pair. Returns null when the result is not a usable coordinate. */
export function projectPosition(from: string, to: string, position: [number, number]): [number, number] | null {
  const source = requireCrs(from)
  const target = requireCrs(to)
  if (!position.every(Number.isFinite)) return null
  if (source.code === target.code) return position
  try {
    const [x, y] = proj4(source.code, target.code, position)
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  } catch {
    return null
  }
}

/** Reprojects every coordinate of a geometry, preserving Z values. Throws if any vertex cannot be transformed. */
export function transformGeometry(geometry: Geometry, from: string, to: string): Geometry {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((child) => transformGeometry(child, from, to)) }
  }
  const walk = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const projected = projectPosition(from, to, [value[0], value[1]])
      if (!projected) throw new Error(`A coordinate (${value[0]}, ${value[1]}) cannot be expressed in ${requireCrs(to).name}.`)
      return [...projected, ...(value as Position).slice(2)]
    }
    return value.map(walk)
  }
  return { ...geometry, coordinates: walk(geometry.coordinates) } as Geometry
}

export interface CoordinateReadout {
  code: string
  label: string
  text: string
  /** False when the pointer is outside the coordinate system's area of use. */
  inArea: boolean
}

function formatDegrees(longitude: number, latitude: number): string {
  return `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? 'W' : 'E'}`
}

/** Formats a WGS 84 position in the given coordinate system for the status bar. */
export function coordinateReadout(code: string, longitude: number, latitude: number): CoordinateReadout {
  const definition = requireCrs(code)
  if (definition.kind === 'geographic') {
    return { code: definition.code, label: definition.name, text: formatDegrees(longitude, latitude), inArea: true }
  }
  const projected = projectPosition(WGS84, definition.code, [longitude, latitude])
  const utm = definition.group === 'UTM (WGS 84)' ? `${definition.name.replace('WGS 84 / UTM zone ', '')} ` : ''
  return {
    code: definition.code,
    label: definition.group === 'UTM (WGS 84)' ? 'UTM' : definition.name,
    text: projected
      ? `${utm}${projected[0].toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} E  ${projected[1].toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} N`
      : 'not defined here',
    inArea: Boolean(projected) && isInsideAreaOfUse(definition, longitude, latitude),
  }
}

/** Ground resolution of the MapLibre view (512 px world tiles) in metres per CSS pixel. */
export function metersPerPixel(latitude: number, zoom: number): number {
  return 40075016.686 * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom)
}

/** Representative-fraction scale denominator of the on-screen map at 96 dpi. */
export function scaleDenominator(latitude: number, zoom: number): number {
  return metersPerPixel(latitude, zoom) * 96 / 0.0254
}

/** Inverse of scaleDenominator at the map centre latitude (96 dpi). */
export function zoomForScale(latitude: number, scale: number): number {
  return Math.log2(scaleDenominator(latitude, 0) / scale)
}
