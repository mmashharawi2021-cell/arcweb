import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import geojsonRbush from '@turf/geojson-rbush'
import { featureCollection, lineString } from '@turf/helpers'
import pointOnFeature from '@turf/point-on-feature'
import { polygonize } from '@turf/turf'
import type { Feature, LineString, Polygon, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayers, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPoint, isPolygon, makeSpatialIndex, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPath, outputNameParameter, repairPolygonGeometry } from './_utils'

interface Segment { a: Position; b: Position; splits: Position[] }

const key = (position: Position) => `${position[0]},${position[1]}`

/** Every linework path (line parts and polygon rings) of the inputs. */
function linework(layers: MapLayer[]): Position[][] {
  const paths: Position[][] = []
  for (const layer of layers) {
    for (const feature of usableFeatures(layer)) {
      const geometry = feature.geometry
      if (geometry.type === 'LineString') paths.push(geometry.coordinates)
      else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') paths.push(...geometry.coordinates)
      else if (geometry.type === 'MultiPolygon') paths.push(...geometry.coordinates.flat())
    }
  }
  return paths.map(cleanPath).filter((path) => path.length > 1)
}

/** Intersection of two segments: the crossing point, or endpoints lying on the other segment when collinear/touching. */
function intersections(s: Segment, t: Segment): Position[] {
  const [x1, y1] = s.a; const [x2, y2] = s.b; const [x3, y3] = t.a; const [x4, y4] = t.b
  const denominator = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  const onSegment = (p: Position, a: Position, b: Position) => {
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    const scale = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    if (Math.abs(cross) > 1e-12 * Math.max(scale, 1e-12)) return false
    return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])
  }
  if (denominator === 0) {
    return [t.a, t.b, s.a, s.b].filter((p, index) => index < 2 ? onSegment(p, s.a, s.b) : onSegment(p, t.a, t.b))
  }
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return []
  // Snap to an existing endpoint when the crossing is at one, so nodes stay identical.
  if (ua === 0) return [s.a]
  if (ua === 1) return [s.b]
  if (ub === 0) return [t.a]
  if (ub === 1) return [t.b]
  return [[x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)]]
}

/** Splits all segments at their mutual intersections (spatially indexed) and removes duplicates. */
export function nodeLinework(paths: Position[][]): Feature<LineString>[] {
  const segments: Segment[] = []
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) segments.push({ a: path[index - 1], b: path[index], splits: [] })
  }
  const tree = geojsonRbush<LineString, { index: number }>()
  tree.load(featureCollection(segments.map((segment, index) => {
    const feature = lineString([segment.a, segment.b], { index })
    feature.bbox = [Math.min(segment.a[0], segment.b[0]), Math.min(segment.a[1], segment.b[1]), Math.max(segment.a[0], segment.b[0]), Math.max(segment.a[1], segment.b[1])]
    return feature
  })))
  segments.forEach((segment, index) => {
    const bbox: [number, number, number, number] = [
      Math.min(segment.a[0], segment.b[0]), Math.min(segment.a[1], segment.b[1]),
      Math.max(segment.a[0], segment.b[0]), Math.max(segment.a[1], segment.b[1]),
    ]
    for (const candidate of tree.search(bbox).features) {
      const other = candidate.properties.index
      if (other <= index) continue
      for (const point of intersections(segment, segments[other])) {
        segment.splits.push(point)
        segments[other].splits.push(point)
      }
    }
  })
  const seen = new Set<string>()
  const result: Feature<LineString>[] = []
  for (const segment of segments) {
    const dx = segment.b[0] - segment.a[0]
    const dy = segment.b[1] - segment.a[1]
    const along = (p: Position) => (p[0] - segment.a[0]) * dx + (p[1] - segment.a[1]) * dy
    const points = cleanPath([segment.a, ...segment.splits.sort((p, q) => along(p) - along(q)), segment.b])
    for (let index = 1; index < points.length; index += 1) {
      const [p, q] = [points[index - 1], points[index]]
      const id = [key(p), key(q)].sort().join('|')
      if (seen.has(id)) continue
      seen.add(id)
      result.push(lineString([[p[0], p[1]], [q[0], q[1]]]))
    }
  }
  return result
}

/** Feature To Polygon: builds polygons from the areas enclosed by lines and/or polygon boundaries. */
export const featureToPolygonTool: ToolboxTool = {
  id: 'feature-to-polygon',
  name: 'Feature To Polygon',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Create polygons from the areas enclosed by input lines or polygon boundaries. Crossing lines are noded first; attributes come from label points or the input polygons.',
  keywords: ['polygonize', 'lines to polygons', 'close', 'build polygons', 'enclosed areas', 'topology'],
  parameters: [
    { id: 'inputs', label: 'Input layers (lines or polygons)', kind: 'layers', required: true },
    { id: 'labels', label: 'Label point layer (optional)', kind: 'layer' },
    outputNameParameter('Feature polygons'),
  ],
  execute: (context, parameters) => {
    const inputs = getLayers(context, parameters, 'inputs')
    if (!inputs.length) throw new Error('Choose at least one line or polygon layer.')
    const paths = linework(inputs)
    assertHasFeatures(paths, 'Feature To Polygon needs line or polygon features.')
    const noded = nodeLinework(paths)
    const faces = polygonize(featureCollection(noded)).features
    const polygons: Feature<Polygon>[] = []
    for (const face of faces) {
      const geometry = repairPolygonGeometry(face.geometry)
      if (!geometry) continue
      if (geometry.type === 'Polygon') polygons.push({ type: 'Feature', properties: {}, geometry })
      else geometry.coordinates.forEach((coordinates) => polygons.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }))
    }
    assertHasFeatures(polygons, 'The input lines do not enclose any area.')

    // Attributes: from label points falling inside each polygon, else from the input polygon that contains it.
    const labelId = getOptionalText(parameters, 'labels')
    const labelLayer = labelId ? context.layers.find((layer) => layer.id === labelId) : undefined
    const labelPoints = labelLayer ? usableFeatures(labelLayer).filter(isPoint) : []
    const sourcePolygons = inputs.flatMap((layer) => usableFeatures(layer).filter(isPolygon))
    const polygonIndex = sourcePolygons.length ? makeSpatialIndex(sourcePolygons) : null
    const labelIndex = labelPoints.length ? makeSpatialIndex(labelPoints) : null
    for (const polygon of polygons) {
      const label = labelIndex?.search(polygon).find((point) => point.geometry.type === 'Point' && booleanPointInPolygon(point.geometry.coordinates, polygon))
      if (label) { polygon.properties = { ...(label.properties ?? {}) }; continue }
      if (!polygonIndex) continue
      const inside = pointOnFeature(polygon)
      const source = polygonIndex.search(inside).find((candidate) => booleanPointInPolygon(inside, candidate))
      if (source) polygon.properties = { ...(source.properties ?? {}) }
    }
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${inputs[0].name} Polygons`, featureCollection(polygons), inputs[0].sourceCrs)
    return { message: `${output.name}: created ${polygons.length.toLocaleString()} polygons from ${noded.length.toLocaleString()} noded segments.`, layers: [output] }
  },
}
