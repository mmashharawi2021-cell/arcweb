import along from '@turf/along'
import booleanContains from '@turf/boolean-contains'
import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import flatten from '@turf/flatten'
import geojsonRbush from '@turf/geojson-rbush'
import { featureCollection, lineString, multiLineString } from '@turf/helpers'
import length from '@turf/length'
import lineSplit from '@turf/line-split'
import polygonToLine from '@turf/polygon-to-line'
import type { Feature, GeoJsonProperties, Geometry, LineString, MultiPolygon, Polygon, Position } from 'geojson'
import type { MapLayer } from '../store'

/** Geometry helpers shared by the toolbox modules. All inputs are WGS 84. */

export type PolygonFeature = Feature<Polygon | MultiPolygon>

export const EARTH_RADIUS = 6371008.8
export const MAX_CANDIDATE_PAIRS = 100_000

export const isPolygon = (feature: Feature): feature is PolygonFeature =>
  feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'

export const isLine = (feature: Feature): boolean =>
  feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString'

export const isPoint = (feature: Feature): boolean =>
  feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint'

export const usableFeatures = (layer: MapLayer) =>
  layer.data.features.filter((feature): feature is Feature<Geometry> => feature.geometry !== null)

/**
 * R-tree over a feature set. Bounding boxes are computed fresh for both the indexed
 * features and each query (a stale `bbox` member on an edited feature is ignored),
 * the source features are never mutated, and `search` returns the original objects.
 */
export function makeSpatialIndex<G extends Geometry>(features: Feature<G>[]) {
  const index = geojsonRbush<G, GeoJsonProperties>()
  const originals = new Map<Feature<G>, Feature<G>>()
  index.load(featureCollection(features.map((feature) => {
    const indexed: Feature<G> = { ...feature, bbox: geometryBBox(feature.geometry) }
    originals.set(indexed, feature)
    return indexed
  })))
  return {
    search: (feature: Feature<Geometry>): Feature<G>[] =>
      index.search(geometryBBox(feature.geometry)).features.map((found) => originals.get(found) ?? found),
  }
}

export function assertHasFeatures(features: unknown[], message: string): void {
  if (!features.length) throw new Error(message)
}

const simpleParts = (feature: Feature<Geometry>) => flatten(feature).features as Feature<Geometry>[]

/** True when every simple part of `inner` lies completely inside one simple part of `outer`. */
export function featureContains(outer: Feature<Geometry>, inner: Feature<Geometry>): boolean {
  const outerParts = simpleParts(outer)
  return simpleParts(inner).every((innerPart) => outerParts.some((outerPart) => {
    try {
      return booleanContains(outerPart, innerPart)
    } catch {
      // Turf has no rule for this geometry pairing (e.g. a point "containing" a polygon).
      return false
    }
  }))
}

/** Tracks index candidate pairs so a huge overlay fails fast instead of freezing the tab. */
export function pairBudget(toolName: string, limit = MAX_CANDIDATE_PAIRS) {
  let used = 0
  return (count: number) => {
    used += count
    if (used > limit) {
      throw new Error(`${toolName} exceeded ${limit.toLocaleString()} candidate pairs. Use smaller or more selective inputs.`)
    }
  }
}

/** A copy of a feature without its ID, so the output layer can assign fresh unique IDs. */
export function detach<G extends Geometry>(feature: Feature<G>, properties?: GeoJsonProperties): Feature<G> {
  return { type: 'Feature', properties: properties ?? { ...(feature.properties ?? {}) }, geometry: feature.geometry }
}

/** Field names of a feature set, in first-seen order. */
export function collectFields(features: Feature[]): string[] {
  const names = new Set<string>()
  for (const feature of features) Object.keys(feature.properties ?? {}).forEach((name) => names.add(name))
  return [...names]
}

/**
 * Maps each field of a joined/overlaid layer to an output name that does not collide
 * with the fields already present (ArcGIS style: `NAME` becomes `NAME_1`).
 */
export function renameCollidingFields(existing: Iterable<string>, incoming: string[]): Map<string, string> {
  const taken = new Set(existing)
  const mapping = new Map<string, string>()
  for (const field of incoming) {
    let name = field
    let suffix = 1
    while (taken.has(name)) {
      name = `${field}_${suffix}`
      suffix += 1
    }
    taken.add(name)
    mapping.set(field, name)
  }
  return mapping
}

export function renameProperties(properties: GeoJsonProperties, mapping: Map<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(properties ?? {})) result[mapping.get(field) ?? field] = value
  return result
}

/** Gives every feature the same attribute schema by filling missing fields with null. */
export function fillSchema<G extends Geometry>(features: Feature<G>[], fields: string[]): Feature<G>[] {
  return features.map((feature) => {
    const properties: Record<string, unknown> = {}
    for (const field of fields) properties[field] = feature.properties?.[field] ?? null
    return { ...feature, properties }
  })
}

function lineParts(feature: Feature<Geometry>): Feature<LineString>[] {
  if (feature.geometry.type === 'LineString') return [lineString(feature.geometry.coordinates)]
  if (feature.geometry.type === 'MultiLineString') {
    return feature.geometry.coordinates.filter((coordinates) => coordinates.length > 1).map((coordinates) => lineString(coordinates))
  }
  return []
}

function boundaryRings(polygons: PolygonFeature[]): Position[][] {
  return polygons.flatMap((polygon) => {
    const converted = polygonToLine(polygon)
    const lines = converted.type === 'FeatureCollection' ? converted.features : [converted]
    return lines.flatMap((line) => line.geometry.type === 'LineString' ? [line.geometry.coordinates] : line.geometry.coordinates)
  })
}

/**
 * Splits a line feature at polygon boundaries and reports, for each resulting segment,
 * whether it lies inside any of the polygons. Used by Erase (keep outside segments).
 */
export function splitLineByPolygons(line: Feature<Geometry>, polygons: PolygonFeature[]): { segment: Feature<LineString>; inside: boolean }[] {
  const rings = boundaryRings(polygons)
  const splitter = rings.length ? multiLineString(rings) : null
  return lineParts(line).flatMap((part) => {
    const segments = splitter ? lineSplit(part, splitter).features : [part]
    return segments.filter((segment) => segment.geometry.coordinates.length > 1).map((segment) => {
      const middle = along(segment, length(segment, { units: 'kilometers' }) / 2, { units: 'kilometers' })
      return { segment, inside: polygons.some((polygon) => booleanPointInPolygon(middle, polygon)) }
    })
  })
}

const radians = (degrees: number) => degrees * Math.PI / 180

/** Great-circle distance in metres. */
export function haversine(a: Position, b: Position): number {
  const [lat1, lat2] = [radians(a[1]), radians(b[1])]
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(radians(b[0] - a[0]) / 2) ** 2
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Closest position to `point` on segment a-b, found on a local equirectangular plane. */
function closestOnSegment(point: Position, a: Position, b: Position): Position {
  const scale = Math.cos(radians(point[1]))
  const ax = (a[0] - point[0]) * scale
  const ay = a[1] - point[1]
  const bx = (b[0] - point[0]) * scale
  const by = b[1] - point[1]
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

interface Decomposed {
  /** Every vertex of the geometry. */
  vertices: Position[]
  /** Linework: line strings and polygon rings. */
  paths: Position[][]
}

function decompose(geometry: Geometry, result: Decomposed = { vertices: [], paths: [] }): Decomposed {
  switch (geometry.type) {
    case 'Point': result.vertices.push(geometry.coordinates); break
    case 'MultiPoint': result.vertices.push(...geometry.coordinates); break
    case 'LineString': result.vertices.push(...geometry.coordinates); result.paths.push(geometry.coordinates); break
    case 'MultiLineString':
    case 'Polygon':
      for (const path of geometry.coordinates) { result.vertices.push(...path); result.paths.push(path) }
      break
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) for (const path of polygon) { result.vertices.push(...path); result.paths.push(path) }
      break
    case 'GeometryCollection': geometry.geometries.forEach((child) => decompose(child, result)); break
  }
  return result
}

function verticesToShape(vertices: Position[], shape: Decomposed, best: { distance: number; from: Position; to: Position }, reverse: boolean) {
  for (const vertex of vertices) {
    const consider = (candidate: Position) => {
      const distance = haversine(vertex, candidate)
      if (distance < best.distance) {
        best.distance = distance
        best.from = reverse ? candidate : vertex
        best.to = reverse ? vertex : candidate
      }
    }
    if (!shape.paths.length) shape.vertices.forEach(consider)
    for (const path of shape.paths) {
      if (path.length === 1) consider(path[0])
      for (let index = 1; index < path.length; index += 1) consider(closestOnSegment(vertex, path[index - 1], path[index]))
    }
  }
}

export interface NearestResult {
  /** Shortest distance in metres; 0 when the geometries touch or overlap. */
  distance: number
  /** Closest location on the first geometry. */
  from: Position
  /** Closest location on the second geometry. */
  to: Position
}

/**
 * Shortest distance between two geometries of any type. For geometries that do not
 * intersect, the minimum is always reached at a vertex of one of them, so checking
 * every vertex against the other geometry's segments is exact up to the local
 * planar approximation used to locate the closest point on a segment.
 */
export function nearestBetween(a: Feature<Geometry>, b: Feature<Geometry>): NearestResult {
  const shapeA = decompose(a.geometry)
  const shapeB = decompose(b.geometry)
  const best = { distance: Infinity, from: shapeA.vertices[0], to: shapeB.vertices[0] }
  if (!shapeA.vertices.length || !shapeB.vertices.length) return best
  const bothPoints = !shapeA.paths.length && !shapeB.paths.length
  if (!bothPoints && booleanIntersects(a, b)) {
    // Overlapping or touching: report the first vertex of A that proves contact where possible.
    return { distance: 0, from: shapeA.vertices[0], to: shapeA.vertices[0] }
  }
  verticesToShape(shapeA.vertices, shapeB, best, false)
  if (shapeA.paths.length) verticesToShape(shapeB.vertices, shapeA, best, true)
  return best
}

export function geometryBBox(geometry: Geometry): [number, number, number, number] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of decompose(geometry).vertices) {
    bounds[0] = Math.min(bounds[0], x)
    bounds[1] = Math.min(bounds[1], y)
    bounds[2] = Math.max(bounds[2], x)
    bounds[3] = Math.max(bounds[3], y)
  }
  return bounds
}

/** A conservative lower bound (metres) for the distance between two bounding boxes. */
export function bboxGap(a: [number, number, number, number], b: [number, number, number, number]): number {
  const longitudeGap = Math.max(0, a[0] - b[2], b[0] - a[2])
  const latitudeGap = Math.max(0, a[1] - b[3], b[1] - a[3])
  if (longitudeGap === 0 && latitudeGap === 0) return 0
  const highestLatitude = Math.min(89.9, Math.max(Math.abs(a[1]), Math.abs(a[3]), Math.abs(b[1]), Math.abs(b[3])))
  const east = radians(longitudeGap) * Math.cos(radians(highestLatitude)) * EARTH_RADIUS
  const north = radians(latitudeGap) * EARTH_RADIUS
  return Math.hypot(east, north) * 0.95
}
