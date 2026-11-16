import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry, Polygon, Position } from 'geojson'
import { fieldNames, getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, geometryBBox, renameCollidingFields } from '../spatial'
import type { ToolboxTool } from '../types'
import { closeRing, featuresCenter, localPlane, mapPositions, orientRings, outputNameParameter } from './_utils'

function vertices(geometry: Geometry, result: Position[] = []): Position[] {
  mapPositions(geometry, (position) => { result.push(position); return position })
  return result
}

const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** Andrew's monotone chain; returns the hull counter-clockwise (without repeating the first point). */
export function convexHull(points: Position[]): Position[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const lower: Position[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Position[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

interface Circle { x: number; y: number; r: number }
const inCircle = (c: Circle, p: Position) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r * (1 + 1e-12) + 1e-9
const twoPointCircle = (a: Position, b: Position): Circle => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 })
function threePointCircle(a: Position, b: Position, c: Position): Circle {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (d === 0) {
    const pairs = [twoPointCircle(a, b), twoPointCircle(a, c), twoPointCircle(b, c)]
    return pairs.reduce((best, circle) => circle.r > best.r ? circle : best)
  }
  const a2 = a[0] ** 2 + a[1] ** 2
  const b2 = b[0] ** 2 + b[1] ** 2
  const c2 = c[0] ** 2 + c[1] ** 2
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) }
}

/** Smallest enclosing circle (Welzl's algorithm, iterative form) of planar points; expected O(n) on the hull. */
export function minimumEnclosingCircle(points: Position[]): Circle {
  const shuffled = [...points]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }
  let circle: Circle = { x: shuffled[0][0], y: shuffled[0][1], r: 0 }
  for (let i = 1; i < shuffled.length; i += 1) {
    if (inCircle(circle, shuffled[i])) continue
    circle = { x: shuffled[i][0], y: shuffled[i][1], r: 0 }
    for (let j = 0; j < i; j += 1) {
      if (inCircle(circle, shuffled[j])) continue
      circle = twoPointCircle(shuffled[i], shuffled[j])
      for (let k = 0; k < j; k += 1) {
        if (!inCircle(circle, shuffled[k])) circle = threePointCircle(shuffled[i], shuffled[j], shuffled[k])
      }
    }
  }
  return circle
}

type BoundingType = 'CONVEX_HULL' | 'ENVELOPE' | 'CIRCLE'
const CIRCLE_VERTICES = 72
const round = (value: number) => Number(value.toFixed(3))

function boundingPolygon(type: BoundingType, points: Position[], plane: ReturnType<typeof localPlane>): { geometry: Polygon; extra: Record<string, number> } | null {
  if (!points.length) return null
  if (type === 'ENVELOPE') {
    const [west, south, east, north] = geometryBBox({ type: 'MultiPoint', coordinates: points })
    const ring = closeRing([[west, south], [east, south], [east, north], [west, north]])
    if (!ring) return null
    const [sw, se, nw] = [plane.forward([west, south]), plane.forward([east, south]), plane.forward([west, north])]
    return {
      geometry: { type: 'Polygon', coordinates: [ring] },
      extra: { MBG_Width: round(Math.hypot(se[0] - sw[0], se[1] - sw[1])), MBG_Length: round(Math.hypot(nw[0] - sw[0], nw[1] - sw[1])) },
    }
  }
  const planar = points.map((point) => plane.forward(point))
  if (type === 'CONVEX_HULL') {
    const hull = convexHull(planar).map((point) => plane.inverse(point))
    const ring = closeRing(hull)
    return ring ? { geometry: { type: 'Polygon', coordinates: orientRings([ring]) }, extra: {} } : null
  }
  // The enclosing circle is determined by hull vertices only, which keeps Welzl's loop short.
  const circle = minimumEnclosingCircle(convexHull(planar))
  if (!(circle.r > 0)) return null
  const ring: Position[] = []
  for (let index = 0; index < CIRCLE_VERTICES; index += 1) {
    const angle = (2 * Math.PI * index) / CIRCLE_VERTICES
    ring.push(plane.inverse([circle.x + circle.r * Math.cos(angle), circle.y + circle.r * Math.sin(angle)]))
  }
  const closed = closeRing(ring)
  return closed ? { geometry: { type: 'Polygon', coordinates: orientRings([closed]) }, extra: { MBG_Diameter: round(circle.r * 2) } } : null
}

/** Minimum Bounding Geometry: convex hull, envelope or enclosing circle per feature, per group, or for all features. */
export const minimumBoundingGeometryTool: ToolboxTool = {
  id: 'minimum-bounding-geometry',
  name: 'Minimum Bounding Geometry',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Create the convex hull, envelope (bounding rectangle) or minimum enclosing circle of each feature, of groups of features, or of the whole layer.',
  keywords: ['convex hull', 'envelope', 'bounding box', 'extent', 'circle', 'enclosing', 'mbg'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    {
      id: 'geometryType', label: 'Geometry type', kind: 'select', defaultValue: 'CONVEX_HULL',
      options: [
        { value: 'CONVEX_HULL', label: 'Convex hull' },
        { value: 'ENVELOPE', label: 'Envelope (bounding rectangle)' },
        { value: 'CIRCLE', label: 'Circle (minimum enclosing)' },
      ],
    },
    {
      id: 'group', label: 'Group option', kind: 'select', defaultValue: 'NONE',
      options: [
        { value: 'NONE', label: 'None — one output per feature' },
        { value: 'ALL', label: 'All — one output for all features' },
        { value: 'LIST', label: 'List — one output per value of the group field' },
      ],
    },
    { id: 'groupField', label: 'Group field (for List)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    outputNameParameter('Bounding geometry'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const type = (getOptionalText(parameters, 'geometryType') || 'CONVEX_HULL') as BoundingType
    if (!['CONVEX_HULL', 'ENVELOPE', 'CIRCLE'].includes(type)) throw new Error(`Unknown geometry type: ${type}.`)
    const group = getOptionalText(parameters, 'group') || 'NONE'
    const groupField = getOptionalText(parameters, 'groupField')
    if (group === 'LIST' && !groupField) throw new Error('Choose a group field for the List option.')
    const features = layer.data.features.filter((feature) => feature.geometry) as Feature<Geometry>[]
    assertHasFeatures(features, 'The input layer has no features with geometry.')
    const plane = localPlane(featuresCenter(features))

    const groups: { properties: Record<string, unknown>; points: Position[] }[] = []
    if (group === 'NONE') {
      const origField = renameCollidingFields(fieldNames(layer), ['ORIG_FID']).get('ORIG_FID') ?? 'ORIG_FID'
      layer.data.features.forEach((feature, index) => {
        if (feature.geometry) groups.push({ properties: { ...(feature.properties ?? {}), [origField]: index + 1 }, points: vertices(feature.geometry) })
      })
    } else if (group === 'ALL') {
      groups.push({ properties: {}, points: features.flatMap((feature) => vertices(feature.geometry)) })
    } else {
      const byValue = new Map<string, { properties: Record<string, unknown>; points: Position[] }>()
      for (const feature of features) {
        const value = feature.properties?.[groupField] ?? null
        const entry = byValue.get(JSON.stringify(value)) ?? { properties: { [groupField]: value }, points: [] }
        vertices(feature.geometry, entry.points)
        byValue.set(JSON.stringify(value), entry)
      }
      groups.push(...byValue.values())
    }

    const output: Feature<Polygon>[] = []
    let degenerate = 0
    for (const { properties, points } of groups) {
      const result = boundingPolygon(type, points, plane)
      if (!result) { degenerate += 1; continue }
      output.push({ type: 'Feature', properties: { ...properties, ...result.extra }, geometry: result.geometry })
    }
    assertHasFeatures(output, 'Every input is degenerate (a single point or a straight line), so no bounding area could be built.')
    const result = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} MBG`, featureCollection(output), layer.sourceCrs)
    return {
      message: `${isolate(result.name)}: created ${output.length.toLocaleString()} bounding polygons.${degenerate ? ` ${degenerate} degenerate inputs (single point or collinear) were skipped.` : ''}`,
      kind: degenerate ? 'warning' : 'success',
      layers: [result],
    }
  },
}
