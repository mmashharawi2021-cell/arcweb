import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { isPolygon, makeSpatialIndex, pairBudget } from '../spatial'
import type { PolygonFeature } from '../spatial'
import type { ToolboxTool } from '../types'
import { localProjection, recordsToTable } from './_utils'
import type { TableCell } from './_utils'

type XY = [number, number]
type Segment = [XY, XY]

export interface NeighborPair { source: number; neighbor: number; length: number; nodes: number }

const rings = (feature: PolygonFeature): Position[][] =>
  feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat()

function projectSegments(feature: PolygonFeature, forward: (position: Position) => XY): Segment[] {
  const segments: Segment[] = []
  for (const ring of rings(feature)) {
    for (let index = 1; index < ring.length; index += 1) segments.push([forward(ring[index - 1]), forward(ring[index])])
  }
  return segments
}

const segmentBox = ([a, b]: Segment, pad: number) =>
  [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad]

const boxesOverlap = (a: number[], b: number[]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

function pointSegmentDistance(p: XY, [a, b]: Segment): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Distance from p to the infinite line through a segment. */
function pointLineDistance(p: XY, [a, b]: Segment): number {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length
}

/**
 * Compares the boundaries of two polygons (in metres): total collinear overlap and the number of
 * distinct points where they touch outside the shared edges.
 */
export function compareBoundaries(a: Segment[], b: Segment[], tolerance: number): { length: number; nodes: number } {
  const boxesB = b.map((segment) => segmentBox(segment, tolerance))
  const shared: Segment[] = []
  let length = 0
  const touchesB = new Set<number>()
  for (const segA of a) {
    const lengthA = Math.hypot(segA[1][0] - segA[0][0], segA[1][1] - segA[0][1])
    const boxA = segmentBox(segA, tolerance)
    b.forEach((segB, index) => {
      if (!boxesOverlap(boxA, boxesB[index])) return
      touchesB.add(index)
      if (lengthA <= tolerance) return
      if (pointLineDistance(segB[0], segA) > tolerance || pointLineDistance(segB[1], segA) > tolerance) return
      const ux = (segA[1][0] - segA[0][0]) / lengthA
      const uy = (segA[1][1] - segA[0][1]) / lengthA
      const t0 = (segB[0][0] - segA[0][0]) * ux + (segB[0][1] - segA[0][1]) * uy
      const t1 = (segB[1][0] - segA[0][0]) * ux + (segB[1][1] - segA[0][1]) * uy
      const start = Math.max(0, Math.min(t0, t1))
      const end = Math.min(lengthA, Math.max(t0, t1))
      if (end - start > tolerance) {
        length += end - start
        shared.push([[segA[0][0] + ux * start, segA[0][1] + uy * start], [segA[0][0] + ux * end, segA[0][1] + uy * end]])
      }
    })
  }
  // Touch points: vertices of one boundary lying on the other, away from the shared edges.
  const candidates: XY[] = []
  const nearB = [...touchesB].map((index) => b[index])
  for (const [p] of a) if (nearB.some((segment) => pointSegmentDistance(p, segment) <= tolerance)) candidates.push(p)
  for (const segment of nearB) if (a.some((segA) => pointSegmentDistance(segment[0], segA) <= tolerance)) candidates.push(segment[0])
  const nodes: XY[] = []
  for (const p of candidates) {
    if (shared.some((segment) => pointSegmentDistance(p, segment) <= tolerance)) continue
    if (nodes.some((node) => Math.hypot(node[0] - p[0], node[1] - p[1]) <= tolerance)) continue
    nodes.push(p)
  }
  return { length, nodes: nodes.length }
}

/** Adjacency between all polygon pairs (each unordered pair once, source < neighbour). */
export function polygonNeighbors(polygons: PolygonFeature[], tolerance: number): NeighborPair[] {
  const index = makeSpatialIndex(polygons.map((feature): Feature<Geometry> => feature))
  const positions = new Map<Feature<Geometry>, number>()
  polygons.forEach((feature, position) => positions.set(feature, position))
  const budget = pairBudget('Polygon Neighbors')
  const pairs: NeighborPair[] = []
  polygons.forEach((source, sourceIndex) => {
    const candidates = index.search(source).map((found) => positions.get(found) ?? -1).filter((position) => position > sourceIndex)
    budget(candidates.length)
    if (!candidates.length) return
    const ring = rings(source)[0]
    const projection = localProjection(ring[0][0], ring[0][1])
    const forward = (position: Position): XY => projection.forward(position)
    const segmentsA = projectSegments(source, forward)
    for (const neighborIndex of candidates) {
      const { length, nodes } = compareBoundaries(segmentsA, projectSegments(polygons[neighborIndex], forward), tolerance)
      if (length > 0 || nodes > 0) pairs.push({ source: sourceIndex, neighbor: neighborIndex, length, nodes })
    }
  })
  return pairs
}

export const polygonNeighborsTool: ToolboxTool = {
  id: 'polygon-neighbors',
  name: 'Polygon Neighbors',
  category: 'Conversion',
  subcategory: 'Cartography & Topology',
  description: 'Build a table of polygon contiguity: for each pair of neighbouring polygons, the length of the shared boundary (metres) and the number of points where they touch only at a node.',
  keywords: ['neighbors', 'neighbours', 'adjacency', 'contiguity', 'touch', 'shared boundary', 'topology', 'spatial weights'],
  parameters: [
    { id: 'target', label: 'Input polygon features', kind: 'layer', required: true },
    { id: 'reportField', label: 'Report by field', kind: 'field', layerParameter: 'target', allowEmpty: true },
    {
      id: 'both', label: 'Pairs to report', kind: 'select', defaultValue: 'both',
      options: [
        { value: 'both', label: 'Both sides (A→B and B→A), like ArcGIS' },
        { value: 'once', label: 'Each pair once' },
      ],
    },
    { id: 'tolerance', label: 'Coincidence tolerance (metres)', kind: 'number', defaultValue: 0.01, min: 0, step: 0.01 },
    { id: 'outputName', label: 'Output table name', kind: 'text', placeholder: 'Layer name + Neighbors' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const field = getOptionalText(parameters, 'reportField')
    const tolerance = parameters.tolerance === undefined || parameters.tolerance === '' ? 0.01 : getNumber(parameters, 'tolerance', 'tolerance')
    if (tolerance < 0) throw new Error('The tolerance cannot be negative.')
    const polygons = layer.data.features.filter(isPolygon)
    if (polygons.length < 2) throw new Error('Polygon Neighbors needs a layer with at least two polygons.')
    const pairs = polygonNeighbors(polygons, Math.max(tolerance, 1e-6))
    const label = (position: number): TableCell => {
      if (!field) return layer.data.features.indexOf(polygons[position]) + 1
      const value = polygons[position].properties?.[field]
      return value === undefined || value === null ? null : typeof value === 'object' ? JSON.stringify(value) : value as TableCell
    }
    const key = field || 'OBJECTID'
    const both = getOptionalText(parameters, 'both') !== 'once'
    const ordered = both ? pairs.flatMap((pair) => [pair, { ...pair, source: pair.neighbor, neighbor: pair.source }]) : pairs
    ordered.sort((left, right) => left.source - right.source || left.neighbor - right.neighbor)
    const records = ordered.map((pair) => ({
      [`src_${key}`]: label(pair.source),
      [`nbr_${key}`]: label(pair.neighbor),
      LENGTH: Math.round(pair.length * 1000) / 1000,
      NODE_COUNT: pair.nodes,
    }))
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Neighbors`, recordsToTable(records))
    output.customFields = [`src_${key}`, `nbr_${key}`, 'LENGTH', 'NODE_COUNT']
    const isolated = polygons.length - new Set(pairs.flatMap((pair) => [pair.source, pair.neighbor])).size
    return {
      message: `${output.name}: ${pairs.length.toLocaleString()} neighbouring pair(s) among ${polygons.length.toLocaleString()} polygons` +
        `${isolated ? `; ${isolated} polygon(s) have no neighbours` : ''}.`,
      layers: [output],
    }
  },
}
