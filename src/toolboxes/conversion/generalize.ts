import { isolate } from '../../bidi'
import bbox from '@turf/bbox'
import booleanValid from '@turf/boolean-valid'
import kinks from '@turf/kinks'
import { coordAll } from '@turf/meta'
import simplify from '@turf/simplify'
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { localProjection } from './_utils'

const RETRIES = 6

function mapPositions(geometry: Geometry, map: (position: Position) => Position): Geometry {
  switch (geometry.type) {
    case 'Point': return { type: 'Point', coordinates: map(geometry.coordinates) }
    case 'MultiPoint': return { type: 'MultiPoint', coordinates: geometry.coordinates.map(map) }
    case 'LineString': return { type: 'LineString', coordinates: geometry.coordinates.map(map) }
    case 'MultiLineString': return { type: 'MultiLineString', coordinates: geometry.coordinates.map((line) => line.map(map)) }
    case 'Polygon': return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map(map)) }
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((rings) => rings.map((ring) => ring.map(map))) }
    case 'GeometryCollection': return { type: 'GeometryCollection', geometries: geometry.geometries.map((child) => mapPositions(child, map)) }
  }
}

export function countVertices(geometry: Geometry | null): number {
  if (!geometry) return 0
  return coordAll(geometry).length
}

const ringArea = (ring: Position[]) => {
  let sum = 0
  for (let index = 1; index < ring.length; index += 1) sum += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1]
  return Math.abs(sum / 2)
}

/** Planar validity in projected metres: closed non-degenerate rings, no self-intersection, holes inside shells. */
function isValidPlanar(geometry: Geometry): boolean {
  if (geometry.type === 'GeometryCollection') return geometry.geometries.every(isValidPlanar)
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return booleanValid(geometry)
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  if (polygons.some((rings) => rings.some((ring) => ring.length < 4 || ringArea(ring) <= 1e-6))) return false
  try {
    if (!booleanValid(geometry)) return false
    return kinks(geometry as Polygon | MultiPolygon).features.length === 0
  } catch {
    return false
  }
}

/**
 * Douglas-Peucker in a local metric projection (tolerance in metres). If simplification would
 * produce an invalid geometry the tolerance is halved and retried; failing that, the feature is kept as is.
 */
export function generalizeGeometry(geometry: Geometry, tolerance: number): { geometry: Geometry; reduced: boolean } {
  if (geometry.type === 'Point' || geometry.type === 'MultiPoint') return { geometry, reduced: true }
  const [west, south, east, north] = bbox(geometry)
  const projection = localProjection((west + east) / 2, (south + north) / 2)
  const projected = mapPositions(geometry, projection.forward)
  let current = tolerance
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    let simplified: Geometry
    try {
      simplified = simplify(projected, { tolerance: current, highQuality: true })
    } catch {
      current /= 2
      continue
    }
    if (isValidPlanar(simplified)) return { geometry: mapPositions(simplified, projection.inverse), reduced: attempt === 0 }
    current /= 2
  }
  return { geometry, reduced: false }
}

export const generalizeTool: ToolboxTool = {
  id: 'generalize',
  name: 'Generalize',
  category: 'Conversion',
  subcategory: 'Cartography & Topology',
  description: 'Simplify line and polygon features with the Douglas-Peucker algorithm using a tolerance in metres, keeping every output geometry valid.',
  keywords: ['simplify', 'generalize', 'douglas-peucker', 'reduce vertices', 'smooth', 'cartography'],
  parameters: [
    { id: 'target', label: 'Input features (lines or polygons)', kind: 'layer', required: true },
    { id: 'tolerance', label: 'Tolerance (metres)', kind: 'number', required: true, defaultValue: 10, min: 0, step: 1 },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Layer name + Generalized' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const tolerance = getNumber(parameters, 'tolerance', 'tolerance')
    if (tolerance < 0) throw new Error('The tolerance cannot be negative.')
    let before = 0
    let after = 0
    let relaxed = 0
    const features: Feature[] = layer.data.features.filter((feature) => feature.geometry).map((feature) => {
      const result = generalizeGeometry(feature.geometry, tolerance)
      before += countVertices(feature.geometry)
      after += countVertices(result.geometry)
      if (!result.reduced) relaxed += 1
      return { type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry: result.geometry }
    })
    assertHasFeatures(features, 'The input layer has no features with geometry.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Generalized`, { type: 'FeatureCollection', features }, layer.sourceCrs)
    const percent = before ? Math.round((1 - after / before) * 100) : 0
    return {
      message: `${isolate(output.name)}: ${before.toLocaleString()} → ${after.toLocaleString()} vertices (${percent}% fewer).` +
        (relaxed ? ` ${relaxed} feature(s) used a smaller tolerance or were kept unchanged to stay valid.` : ''),
      kind: relaxed ? 'warning' : 'success',
      layers: [output],
    }
  },
}
