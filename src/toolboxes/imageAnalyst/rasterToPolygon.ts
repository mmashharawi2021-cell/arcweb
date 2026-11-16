import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { isNoData, rasterCoordinateToWgs84 } from '../../rasterEngine'
import { getRaster, outputName, IMAGE_ANALYST_CATEGORY } from './_shared'
import { outputLayer } from '../shared'
import type { ToolboxTool } from '../types'

type GridPoint = [number, number]
interface BoundaryEdge { start: GridPoint; end: GridPoint; direction: number }

function pointKey([column, row]: GridPoint): string {
  return `${column},${row}`
}

function signedArea(ring: GridPoint[]): number {
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return area / 2
}

function simplifyRing(ring: GridPoint[]): GridPoint[] {
  if (ring.length <= 4) return ring
  const result: GridPoint[] = []
  for (let index = 0; index < ring.length - 1; index += 1) {
    const previous = ring[(index + ring.length - 2) % (ring.length - 1)]
    const current = ring[index]
    const next = ring[(index + 1) % (ring.length - 1)]
    const cross = (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0])
    if (cross !== 0) result.push(current)
  }
  if (result.length) result.push(result[0])
  return result.length >= 4 ? result : ring
}

function ringContains([x, y]: GridPoint, ring: GridPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function boundaryRings(cells: number[], width: number, labels: Int32Array, component: number): GridPoint[][] {
  const edges: BoundaryEdge[] = []
  for (const index of cells) {
    const row = Math.floor(index / width)
    const column = index % width
    const neighbors = [
      [row - 1, column, [column, row], [column + 1, row], 0],
      [row, column + 1, [column + 1, row], [column + 1, row + 1], 1],
      [row + 1, column, [column + 1, row + 1], [column, row + 1], 2],
      [row, column - 1, [column, row + 1], [column, row], 3],
    ] as const
    for (const [neighborRow, neighborColumn, start, end, direction] of neighbors) {
      const neighbor = neighborRow * width + neighborColumn
      if (neighborRow < 0 || neighborColumn < 0 || neighborColumn >= width ||
        neighborRow >= labels.length / width || labels[neighbor] !== component) {
        edges.push({ start: [...start], end: [...end], direction })
      }
    }
  }
  const outgoing = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = pointKey(edge.start)
    const indices = outgoing.get(key) ?? []
    indices.push(index)
    outgoing.set(key, indices)
  })
  const used = new Uint8Array(edges.length)
  const rings: GridPoint[][] = []
  for (let firstEdge = 0; firstEdge < edges.length; firstEdge += 1) {
    if (used[firstEdge]) continue
    const ring: GridPoint[] = [edges[firstEdge].start]
    let edgeIndex = firstEdge
    let guard = 0
    while (!used[edgeIndex] && guard <= edges.length) {
      guard += 1
      const edge = edges[edgeIndex]
      used[edgeIndex] = 1
      ring.push(edge.end)
      if (pointKey(edge.end) === pointKey(ring[0])) break
      const candidates = (outgoing.get(pointKey(edge.end)) ?? []).filter((candidate) => !used[candidate])
      if (!candidates.length) break
      const turnRank = (candidate: number) => {
        const turn = (edges[candidate].direction - edge.direction + 4) % 4
        return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3
      }
      candidates.sort((a, b) => turnRank(a) - turnRank(b))
      edgeIndex = candidates[0]
    }
    if (ring.length >= 4 && pointKey(ring[0]) === pointKey(ring[ring.length - 1])) {
      const cleanRing = simplifyRing(ring)
      if (Math.abs(signedArea(cleanRing)) > 0) rings.push(cleanRing)
    }
  }
  return rings
}

function toWgs84(ring: GridPoint[], grid: ReturnType<typeof getRaster>['grid']): Position[] {
  return ring.map(([column, row]) => rasterCoordinateToWgs84(
    grid.origin[0] + column * grid.resolution[0],
    grid.origin[1] + row * grid.resolution[1],
    grid.crs,
  ))
}

export const rasterToPolygonTool: ToolboxTool = {
  id: 'rasterToPolygon',
  name: 'Raster To Polygon',
  category: IMAGE_ANALYST_CATEGORY,
  subcategory: 'Conversion',
  description: 'Convert contiguous equal-valued cells to clean polygon features using four-neighbor connectivity; enclosed NoData regions become polygon holes.',
  keywords: ['raster', 'polygonize', 'vectorize', 'conversion'],
  parameters: [
    { id: 'raster', label: 'Input raster', kind: 'layer', required: true },
    { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Raster polygons' },
  ],
  execute: (context, parameters) => {
    const { layer, grid } = getRaster(context, parameters)
    const labels = new Int32Array(grid.values.length).fill(-1)
    const features: Feature<Polygon | MultiPolygon>[] = []
    let component = 0
    const enqueue = new Int32Array(grid.values.length)
    for (let start = 0; start < grid.values.length; start += 1) {
      const value = grid.values[start]
      if (labels[start] !== -1 || isNoData(value, grid.noData)) continue
      let head = 0
      let tail = 0
      enqueue[tail++] = start
      labels[start] = component
      const cells: number[] = []
      while (head < tail) {
        const index = enqueue[head++]
        cells.push(index)
        const row = Math.floor(index / grid.width)
        const column = index % grid.width
        const neighbors = [
          row > 0 ? index - grid.width : -1,
          column + 1 < grid.width ? index + 1 : -1,
          row + 1 < grid.height ? index + grid.width : -1,
          column > 0 ? index - 1 : -1,
        ]
        for (const neighbor of neighbors) {
          if (neighbor < 0 || labels[neighbor] !== -1 || isNoData(grid.values[neighbor], grid.noData) || grid.values[neighbor] !== value) continue
          labels[neighbor] = component
          enqueue[tail++] = neighbor
        }
      }
      const rings = boundaryRings(cells, grid.width, labels, component)
      const outerRings = rings.filter((ring) => signedArea(ring) > 0)
      const holeRings = rings.filter((ring) => signedArea(ring) < 0)
      const polygons = outerRings.map((outer) => [outer, ...holeRings.filter((hole) => ringContains(hole[0], outer))])
      if (!polygons.length) throw new Error('Raster polygonization could not construct a valid closed boundary.')
      const coordinates = polygons.map((polygon) => polygon.map((ring) => toWgs84(ring, grid)))
      const geometry: Polygon | MultiPolygon = coordinates.length === 1
        ? { type: 'Polygon', coordinates: coordinates[0] }
        : { type: 'MultiPolygon', coordinates }
      features.push({
        type: 'Feature',
        id: component,
        properties: { value, cellCount: cells.length },
        geometry,
      })
      component += 1
    }
    if (!features.length) throw new Error('The input raster contains no valid cells to polygonize.')
    const name = outputName(parameters, `${layer.name} Polygons`)
    const output = outputLayer(name, { type: 'FeatureCollection', features }, grid.crs)
    return { message: `${name}: converted ${grid.values.length.toLocaleString()} raster cells into ${features.length.toLocaleString()} four-connected value regions.`, layers: [output] }
  },
}

export { boundaryRings as traceRasterBoundaryRings }
