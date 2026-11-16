import { simplify } from '@turf/turf'
import type { Feature, Geometry, Position } from 'geojson'
import { cleanPath, featuresCenter, localPlane, mapPositions, repairLineGeometry, repairPolygonGeometry } from './_utils'

/** Shared helpers for the Generalization toolset (simplify / smooth). */

/**
 * Douglas–Peucker simplification with a tolerance in metres. Coordinates are moved to a
 * local metric plane centred on the data, simplified there and moved back, so the
 * tolerance means the same ground distance in both x and y.
 */
export function simplifyFeatures(features: Feature<Geometry>[], toleranceMeters: number): Feature<Geometry>[] {
  const plane = localPlane(featuresCenter(features))
  return features.flatMap((feature) => {
    const planar: Feature<Geometry> = { type: 'Feature', properties: {}, geometry: mapPositions(feature.geometry, plane.forward) }
    const simplified = simplify(planar, { tolerance: toleranceMeters, highQuality: false, mutate: true }) as Feature<Geometry>
    const geometry = validGeometry(mapPositions(simplified.geometry, plane.inverse))
    return geometry ? [{ type: 'Feature' as const, properties: { ...(feature.properties ?? {}) }, geometry }] : []
  })
}

/** Topology-checked version of a line or polygon geometry (null when it collapsed). */
export function validGeometry(geometry: Geometry): Geometry | null {
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return repairPolygonGeometry(geometry)
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') return repairLineGeometry(geometry)
  return geometry
}

/** Chaikin corner cutting. Open paths keep their end points; closed rings stay closed. */
export function chaikin(path: Position[], iterations: number, closed: boolean): Position[] {
  let current = cleanPath(path)
  if (closed && current.length > 1) current = current.slice(0, -1)
  for (let step = 0; step < iterations && current.length > 2; step += 1) {
    const next: Position[] = closed ? [] : [current[0]]
    const count = closed ? current.length : current.length - 1
    for (let index = 0; index < count; index += 1) {
      const a = current[index]
      const b = current[(index + 1) % current.length]
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    if (!closed) next.push(current[current.length - 1])
    current = next
  }
  return closed ? [...current, current[0]] : current
}

export function countVertices(features: Feature<Geometry>[]): number {
  let count = 0
  for (const feature of features) mapPositions(feature.geometry, (position) => { count += 1; return position })
  return count
}
