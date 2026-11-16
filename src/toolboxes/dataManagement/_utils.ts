import { isolate } from '../../bidi'
import { featureCollection, polygon as turfPolygon } from '@turf/helpers'
import { kinks, union, unkinkPolygon } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { EARTH_RADIUS, geometryBBox } from '../spatial'
import type { ToolboxParameters, ToolParameter } from '../types'

/** Helpers private to the Data Management toolbox. All geometry is WGS 84. */

/** Length of one degree of latitude (and of longitude at the equator) in metres. */
export const METERS_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS

export const outputNameParameter = (placeholder: string): ToolParameter => ({
  id: 'outputName', label: 'Output layer name', kind: 'text', placeholder,
})

export const yesNoParameter = (id: string, label: string, defaultValue: 'yes' | 'no', yes = 'Yes', no = 'No'): ToolParameter => ({
  id, label, kind: 'select', defaultValue, options: [{ value: 'yes', label: yes }, { value: 'no', label: no }],
})

/** A number parameter that may be left blank (returns null). */
export function optionalNumber(parameters: ToolboxParameters, id: string, label: string): number | null {
  const value = parameters[id]
  if (value === undefined || value === '' || value === null) return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`Enter a valid ${label}.`)
  return number
}

/** A table row (see src/geojson.ts): a feature without geometry. Re-exported for this toolbox's callers. */
export { tableRow } from '../../geojson'

export const samePosition = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]
const validPosition = (position: Position | undefined) =>
  Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])

/** Removes invalid coordinates and consecutive duplicate vertices from a path. */
export function cleanPath(path: Position[]): Position[] {
  const result: Position[] = []
  for (const position of path) {
    if (!validPosition(position)) continue
    const last = result[result.length - 1]
    if (!last || !samePosition(last, position)) result.push(position)
  }
  return result
}

/** Shoelace signed area in coordinate units; positive for counter-clockwise rings. */
export function signedRingArea(ring: Position[]): number {
  let total = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    total += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return total / 2
}

/** True when every vertex lies on one straight line (within floating-point noise). */
function collinear(points: Position[]): boolean {
  const [origin, other] = [points[0], points[1]]
  const dx = other[0] - origin[0]
  const dy = other[1] - origin[1]
  const scale = (dx * dx + dy * dy) || 1
  return points.every((point) => Math.abs(dx * (point[1] - origin[1]) - dy * (point[0] - origin[0])) <= 1e-12 * Math.max(scale, Math.hypot(point[0] - origin[0], point[1] - origin[1]) ** 2))
}

/** Cleans and closes a ring; null when it cannot form an area (fewer than 3 distinct vertices, or all collinear). */
export function closeRing(ring: Position[]): Position[] | null {
  const cleaned = cleanPath(ring)
  if (cleaned.length > 1 && samePosition(cleaned[0], cleaned[cleaned.length - 1])) cleaned.pop()
  if (cleaned.length < 3 || collinear(cleaned)) return null
  cleaned.push(cleaned[0])
  return cleaned
}

/** RFC 7946 right-hand rule: exterior rings counter-clockwise, holes clockwise. */
export function orientRings(rings: Position[][]): Position[][] {
  return rings.map((ring, index) => {
    const area = signedRingArea(ring)
    return (index === 0 ? area < 0 : area > 0) ? [...ring].reverse() : ring
  })
}

export function polygonsToGeometry(polygons: Position[][][]): Polygon | MultiPolygon | null {
  if (!polygons.length) return null
  return polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }
}

const polygonParts = (geometry: Polygon | MultiPolygon) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

/** Rebuilds self-intersecting rings with the overlay engine (a polygon unioned with itself is noded and valid). */
function resolveSelfIntersections(rings: Position[][]): Position[][][] {
  const feature = turfPolygon(rings)
  try {
    const merged = union(featureCollection([feature, feature]))
    if (merged) return polygonParts(merged.geometry).map(orientRings)
  } catch {
    // Fall back to the simple-polygon decomposition below.
  }
  try {
    return unkinkPolygon(feature).features.map((part) => orientRings(part.geometry.coordinates))
  } catch {
    return []
  }
}

function bboxesOverlap(parts: Position[][][]): boolean {
  const boxes = parts.map((rings) => geometryBBox({ type: 'Polygon', coordinates: rings }))
  boxes.sort((a, b) => a[0] - b[0])
  for (let index = 0; index < boxes.length; index += 1) {
    for (let next = index + 1; next < boxes.length && boxes[next][0] <= boxes[index][2]; next += 1) {
      if (boxes[next][1] <= boxes[index][3] && boxes[next][3] >= boxes[index][1]) return true
    }
  }
  return false
}

/**
 * Returns a topologically valid version of a polygon geometry: invalid coordinates and
 * duplicate vertices removed, rings closed, degenerate rings dropped, rings oriented by
 * the right-hand rule, self-intersections resolved and overlapping parts merged.
 * Null when nothing with area remains.
 */
export function repairPolygonGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon | null {
  const result: Position[][][] = []
  let changedTopology = false
  for (const part of polygonParts(geometry)) {
    const outer = part[0] ? closeRing(part[0]) : null
    if (!outer) continue
    const holes = part.slice(1).map(closeRing).filter((ring): ring is Position[] => ring !== null)
    const rings = orientRings([outer, ...holes])
    let kinked: boolean
    try {
      kinked = kinks(turfPolygon(rings)).features.length > 0
    } catch {
      kinked = true
    }
    if (kinked) {
      changedTopology = true
      result.push(...resolveSelfIntersections(rings))
    } else {
      result.push(rings)
    }
  }
  if (result.length > 1 && (changedTopology || bboxesOverlap(result))) {
    try {
      const merged = union(featureCollection(result.map((rings) => turfPolygon(rings))))
      return merged ? polygonsToGeometry(polygonParts(merged.geometry).map(orientRings)) : null
    } catch {
      // Keep the parts as they are.
    }
  }
  return polygonsToGeometry(result)
}

/** Cleans a line geometry (duplicate vertices removed, parts with fewer than two vertices dropped). */
export function repairLineGeometry(geometry: Geometry): Geometry | null {
  const paths = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : []
  const cleaned = paths.map(cleanPath).filter((path) => path.length > 1)
  if (!cleaned.length) return null
  return cleaned.length === 1 ? { type: 'LineString', coordinates: cleaned[0] } : { type: 'MultiLineString', coordinates: cleaned }
}

/** Applies a function to every position of a geometry. */
export function mapPositions<G extends Geometry>(geometry: G, transform: (position: Position) => Position): G {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((child) => mapPositions(child, transform)) }
  }
  const walk = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value
    if (typeof value[0] === 'number') return transform(value as Position)
    return value.map(walk)
  }
  return { ...geometry, coordinates: walk((geometry as Exclude<Geometry, { type: 'GeometryCollection' }>).coordinates) } as G
}

/**
 * A local equirectangular plane in metres centred on `origin`. Accurate to well under
 * 1% within a few hundred kilometres of the origin, which is what metre tolerances need.
 */
export function localPlane(origin: Position) {
  const scale = Math.cos((origin[1] * Math.PI) / 180) || 1e-9
  return {
    forward: ([x, y, ...rest]: Position): Position => [(x - origin[0]) * scale * METERS_PER_DEGREE, (y - origin[1]) * METERS_PER_DEGREE, ...rest],
    inverse: ([x, y, ...rest]: Position): Position => [x / (scale * METERS_PER_DEGREE) + origin[0], y / METERS_PER_DEGREE + origin[1], ...rest],
  }
}

/** Centre of the bounding box of a set of features (geometry-less ones ignored). */
export function featuresCenter(features: Feature[]): Position {
  const bounds = collectionBBox(features)
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [0, 0]
}

export function collectionBBox(features: Feature[]): [number, number, number, number] | null {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const feature of features) {
    if (!feature.geometry) continue
    const box = geometryBBox(feature.geometry)
    bounds[0] = Math.min(bounds[0], box[0])
    bounds[1] = Math.min(bounds[1], box[1])
    bounds[2] = Math.max(bounds[2], box[2])
    bounds[3] = Math.max(bounds[3], box[3])
  }
  return bounds.every(Number.isFinite) ? bounds : null
}

/** Parses a comma/semicolon separated list of field names and checks each exists (case-insensitive match allowed). */
export function parseFieldList(text: string, available: string[]): string[] {
  return text.split(/[,;]/).map((name) => name.trim()).filter(Boolean).map((name) => {
    const match = available.find((field) => field === name) ?? available.find((field) => field.toLowerCase() === name.toLowerCase())
    if (!match) throw new Error(`Field "${isolate(name)}" does not exist. Available fields: ${available.map(isolate).join(', ') || 'none'}.`)
    return match
  })
}

/** Attribute ordering used by Sort and statistics: numbers numerically, text naturally, nulls last. */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  const aNumber = typeof a === 'number' ? a : Number(a)
  const bNumber = typeof b === 'number' ? b : Number(b)
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export type GeometryFamily = 'point' | 'line' | 'polygon'

export function geometryFamily(geometry: Geometry | null | undefined): GeometryFamily | null {
  if (!geometry) return null
  if (geometry.type === 'Point' || geometry.type === 'MultiPoint') return 'point'
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') return 'line'
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return 'polygon'
  return null
}

/** Produces fresh feature IDs that do not collide with those already in a layer. */
export function idAllocator(layer: MapLayer) {
  const taken = new Set(layer.data.features.map((feature) => feature.id))
  let counter = layer.data.features.length
  return () => {
    let id = `${layer.id}:${counter}`
    while (taken.has(id)) {
      counter += 1
      id = `${layer.id}:${counter}`
    }
    taken.add(id)
    counter += 1
    return id
  }
}

export const withFeatures = (layer: MapLayer, features: Feature[]): FeatureCollection => ({ ...layer.data, features })

/** Comma/semicolon list of generic positive numbers, used for bounding boxes. */
export function parseBBox(text: string): [number, number, number, number] {
  const values = text.split(/[,;\s]+/).filter(Boolean).map(Number)
  if (values.length !== 4 || !values.every(Number.isFinite)) {
    throw new Error('Enter the extent as four numbers: west, south, east, north (WGS 84 degrees).')
  }
  const [west, south, east, north] = values
  if (west >= east || south >= north) throw new Error('The extent must have west < east and south < north.')
  if (west < -180 || east > 180 || south < -90 || north > 90) throw new Error('The extent must be in WGS 84 degrees (longitude -180..180, latitude -90..90).')
  return [west, south, east, north]
}
