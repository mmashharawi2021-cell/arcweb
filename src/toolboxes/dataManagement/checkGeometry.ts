import { isolate } from '../../bidi'
import { kinks } from '@turf/turf'
import { polygon as turfPolygon } from '@turf/helpers'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { cleanPath, closeRing, outputNameParameter, samePosition, signedRingArea, tableRow } from './_utils'

export type GeometryProblem =
  | 'null geometry' | 'empty geometry' | 'invalid coordinates' | 'too few points' | 'unclosed rings'
  | 'duplicate vertices' | 'incorrect ring orientation' | 'self intersections' | 'unsupported geometry'

const hasDuplicates = (path: Position[]) => path.some((position, index) => index > 0 && samePosition(position, path[index - 1]))
const hasInvalid = (path: Position[]) => path.some((position) => !Array.isArray(position) || !Number.isFinite(position[0]) || !Number.isFinite(position[1]))

/** Lists every problem of a geometry, following ArcGIS Check Geometry's categories (orientation per RFC 7946). */
export function geometryProblems(geometry: Geometry | null): GeometryProblem[] {
  if (!geometry) return ['null geometry']
  const problems = new Set<GeometryProblem>()
  const checkPaths = (paths: Position[][], minimum: number) => {
    if (!paths.length) problems.add('empty geometry')
    for (const path of paths) {
      if (hasInvalid(path)) problems.add('invalid coordinates')
      if (hasDuplicates(path)) problems.add('duplicate vertices')
      if (cleanPath(path).length < minimum) problems.add('too few points')
    }
  }
  const checkPolygon = (rings: Position[][]) => {
    if (!rings.length) { problems.add('empty geometry'); return }
    const closed: Position[][] = []
    rings.forEach((ring, index) => {
      if (hasInvalid(ring)) problems.add('invalid coordinates')
      if (ring.length && !samePosition(ring[0], ring[ring.length - 1])) problems.add('unclosed rings')
      // A closing vertex repeating the start is required, not a duplicate.
      const body = ring.length > 1 && samePosition(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring
      if (hasDuplicates(body)) problems.add('duplicate vertices')
      const cleaned = closeRing(ring)
      if (!cleaned) { problems.add('too few points'); return }
      const area = signedRingArea(cleaned)
      if (index === 0 ? area < 0 : area > 0) problems.add('incorrect ring orientation')
      closed.push(cleaned)
    })
    if (closed.length) {
      try {
        if (kinks(turfPolygon(closed)).features.length) problems.add('self intersections')
      } catch {
        problems.add('self intersections')
      }
    }
  }
  switch (geometry.type) {
    case 'Point': checkPaths([[geometry.coordinates]], 1); break
    case 'MultiPoint':
      if (!geometry.coordinates.length) problems.add('empty geometry')
      if (hasInvalid(geometry.coordinates)) problems.add('invalid coordinates')
      break
    case 'LineString': checkPaths([geometry.coordinates], 2); break
    case 'MultiLineString': checkPaths(geometry.coordinates, 2); break
    case 'Polygon': checkPolygon(geometry.coordinates); break
    case 'MultiPolygon':
      if (!geometry.coordinates.length) problems.add('empty geometry')
      geometry.coordinates.forEach(checkPolygon)
      break
    default: problems.add('unsupported geometry')
  }
  return [...problems]
}

/** Check Geometry: produces a table with one row per geometry problem found in the input layer. */
export const checkGeometryTool: ToolboxTool = {
  id: 'check-geometry',
  name: 'Check Geometry',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Report geometry problems (null geometry, self-intersections, unclosed rings, too few points, duplicate vertices, incorrect ring orientation) as a table.',
  keywords: ['validate', 'validity', 'topology', 'errors', 'invalid', 'qa', 'quality'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    outputNameParameter('Check Geometry table'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const rows: Feature[] = []
    layer.data.features.forEach((feature, index) => {
      for (const problem of geometryProblems(feature.geometry ?? null)) {
        rows.push(tableRow({ CLASS: layer.name, FEATURE_ID: feature.id ?? null, ORIG_FID: index + 1, PROBLEM: problem }))
      }
    })
    if (!rows.length) {
      return { message: `${isolate(layer.name)}: no geometry problems found in ${layer.data.features.length.toLocaleString()} features.` }
    }
    const features = new Set(rows.map((row) => row.properties?.ORIG_FID)).size
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Check Geometry`, { type: 'FeatureCollection', features: rows })
    return {
      message: `${isolate(layer.name)}: found ${rows.length.toLocaleString()} problems in ${features.toLocaleString()} features. Run Repair Geometry to fix them.`,
      kind: 'warning',
      layers: [output],
    }
  },
}
