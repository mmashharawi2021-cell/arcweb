import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, Position } from 'geojson'

export type NetworkCoordinate = [number, number]
export type NetworkImpedance = 'distance' | 'time'

export interface NetworkNode {
  id: string
  position: NetworkCoordinate
}

export interface NetworkEdge {
  id: string
  from: string
  to: string
  lengthMeters: number
  travelTimeMinutes: number
  properties: Record<string, unknown>
}

export interface NetworkGraph {
  nodes: Map<string, NetworkNode>
  edges: NetworkEdge[]
  adjacency: Map<string, NetworkEdge[]>
}

export interface NetworkRoute {
  nodes: string[]
  edges: string[]
  cost: number
}

export interface NetworkBuildOptions {
  speedField?: string
  defaultSpeedKph?: number
}

interface RawSegment {
  id: number
  start: NetworkCoordinate
  end: NetworkCoordinate
  properties: Record<string, unknown>
  cuts: { t: number; position: NetworkCoordinate }[]
}

interface SnapResult {
  graph: NetworkGraph
  nodeIds: string[]
  distances: number[]
}

const EARTH_RADIUS_METERS = 6_371_008.8
const COORDINATE_PRECISION = 7
const MAX_SEGMENT_PAIRS = 5_000_000
const MAX_SNAP_COMPARISONS = 20_000_000

function isCoordinate(position: Position): position is NetworkCoordinate {
  return position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]) &&
    position[0] >= -180 && position[0] <= 180 && position[1] >= -90 && position[1] <= 90
}

function coordinateKey(position: NetworkCoordinate): string {
  return `${position[0].toFixed(COORDINATE_PRECISION)},${position[1].toFixed(COORDINATE_PRECISION)}`
}

function haversine(a: NetworkCoordinate, b: NetworkCoordinate): number {
  const toRadians = Math.PI / 180
  const lat1 = a[1] * toRadians
  const lat2 = b[1] * toRadians
  const dLat = (b[1] - a[1]) * toRadians
  const dLon = (b[0] - a[0]) * toRadians
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

function parameterOnSegment(point: NetworkCoordinate, start: NetworkCoordinate, end: NetworkCoordinate): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const denominator = dx * dx + dy * dy
  return denominator === 0 ? 0 : ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator
}

function pointAt(start: NetworkCoordinate, end: NetworkCoordinate, t: number): NetworkCoordinate {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
}

function addCut(segment: RawSegment, t: number, position: NetworkCoordinate): void {
  if (t < -1e-10 || t > 1 + 1e-10) return
  const clamped = Math.max(0, Math.min(1, t))
  segment.cuts.push({ t: clamped, position: clamped === 0 ? segment.start : clamped === 1 ? segment.end : position })
}

function segmentIntersections(a: RawSegment, b: RawSegment): void {
  const [x1, y1] = a.start
  const [x2, y2] = a.end
  const [x3, y3] = b.start
  const [x4, y4] = b.end
  const rx = x2 - x1
  const ry = y2 - y1
  const sx = x4 - x3
  const sy = y4 - y3
  const denominator = rx * sy - ry * sx
  const qpx = x3 - x1
  const qpy = y3 - y1
  const epsilon = 1e-12

  if (Math.abs(denominator) > epsilon) {
    const t = (qpx * sy - qpy * sx) / denominator
    const u = (qpx * ry - qpy * rx) / denominator
    if (t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon) {
      const position = pointAt(a.start, a.end, Math.max(0, Math.min(1, t)))
      addCut(a, t, position)
      addCut(b, u, position)
    }
    return
  }
  if (Math.abs(qpx * ry - qpy * rx) > epsilon) return

  for (const point of [a.start, a.end, b.start, b.end]) {
    const ta = parameterOnSegment(point, a.start, a.end)
    const tb = parameterOnSegment(point, b.start, b.end)
    if (ta >= -epsilon && ta <= 1 + epsilon && tb >= -epsilon && tb <= 1 + epsilon) {
      addCut(a, ta, point)
      addCut(b, tb, point)
    }
  }
}

function addEdge(graph: NetworkGraph, edge: NetworkEdge): void {
  graph.edges.push(edge)
  graph.adjacency.get(edge.from)?.push(edge)
  graph.adjacency.get(edge.to)?.push(edge)
}

function makeGraph(): NetworkGraph {
  return { nodes: new Map(), edges: [], adjacency: new Map() }
}

function addNode(graph: NetworkGraph, position: NetworkCoordinate): string {
  const id = coordinateKey(position)
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, { id, position })
    graph.adjacency.set(id, [])
  }
  return id
}

function addLineSegments(
  geometry: LineString | MultiLineString,
  properties: Record<string, unknown>,
  segments: RawSegment[],
): void {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
  for (const coordinates of lines) {
    if (coordinates.length < 2 || coordinates.some((position) => !isCoordinate(position))) {
      throw new Error('The network contains a line with fewer than two valid WGS 84 coordinates.')
    }
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1].slice(0, 2) as NetworkCoordinate
      const end = coordinates[index].slice(0, 2) as NetworkCoordinate
      if (coordinateKey(start) === coordinateKey(end)) continue
      segments.push({
        id: segments.length,
        start,
        end,
        properties,
        cuts: [{ t: 0, position: start }, { t: 1, position: end }],
      })
    }
  }
}

/**
 * Builds an undirected road graph and splits every input line segment at crossings,
 * shared endpoints, and collinear-overlap boundaries.
 */
export function buildNetworkGraph(
  input: FeatureCollection | Feature<Geometry>[],
  options: NetworkBuildOptions = {},
): NetworkGraph {
  const features = Array.isArray(input) ? input : input.features
  const defaultSpeed = options.defaultSpeedKph ?? 40
  if (!Number.isFinite(defaultSpeed) || defaultSpeed <= 0) throw new Error('Default travel speed must be greater than zero.')

  const segments: RawSegment[] = []
  for (const [index, feature] of features.entries()) {
    const geometry = feature.geometry
    if (!geometry) continue
    if (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') {
      throw new Error(`Network feature ${index + 1} must be a LineString or MultiLineString.`)
    }
    const properties = (feature.properties ?? {}) as Record<string, unknown>
    const speedValue = options.speedField ? Number(properties[options.speedField]) : defaultSpeed
    if (!Number.isFinite(speedValue) || speedValue <= 0) {
      throw new Error(`Network feature ${index + 1} has an invalid or missing speed in "${options.speedField}".`)
    }
    addLineSegments(geometry, { ...properties, __speedKph: speedValue }, segments)
  }
  if (!segments.length) throw new Error('The network layer has no usable line segments.')

  let comparisons = 0
  const ordered = [...segments].sort((a, b) => Math.min(a.start[0], a.end[0]) - Math.min(b.start[0], b.end[0]))
  const active: RawSegment[] = []
  for (const segment of ordered) {
    const minX = Math.min(segment.start[0], segment.end[0])
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (Math.max(active[index].start[0], active[index].end[0]) < minX - 1e-12) active.splice(index, 1)
    }
    for (const candidate of active) {
      if (Math.max(Math.min(segment.start[1], segment.end[1]), Math.min(candidate.start[1], candidate.end[1])) >
        Math.min(Math.max(segment.start[1], segment.end[1]), Math.max(candidate.start[1], candidate.end[1])) + 1e-12) continue
      comparisons += 1
      if (comparisons > MAX_SEGMENT_PAIRS) {
        throw new Error(`Network topology exceeded ${MAX_SEGMENT_PAIRS.toLocaleString()} candidate segment pairs.`)
      }
      segmentIntersections(segment, candidate)
    }
    active.push(segment)
  }

  const graph = makeGraph()
  for (const segment of segments) {
    segment.cuts.sort((a, b) => a.t - b.t)
    const cuts = segment.cuts.filter((cut, index, all) =>
      index === 0 || Math.abs(cut.t - all[index - 1].t) > 1e-10)
    for (let index = 1; index < cuts.length; index += 1) {
      const fromPosition = cuts[index - 1].position
      const toPosition = cuts[index].position
      const from = addNode(graph, fromPosition)
      const to = addNode(graph, toPosition)
      if (from === to) continue
      const lengthMeters = haversine(fromPosition, toPosition)
      const speedKph = segment.properties.__speedKph as number
      addEdge(graph, {
        id: `e${graph.edges.length}`,
        from,
        to,
        lengthMeters,
        travelTimeMinutes: lengthMeters / (speedKph * 1000 / 60),
        properties: segment.properties,
      })
    }
  }
  return graph
}

function projectToSegment(position: NetworkCoordinate, start: NetworkCoordinate, end: NetworkCoordinate): { point: NetworkCoordinate; t: number } {
  const latitude = (position[1] + start[1] + end[1]) / 3 * Math.PI / 180
  const xScale = Math.max(1e-6, Math.cos(latitude))
  const dx = (end[0] - start[0]) * xScale
  const dy = end[1] - start[1]
  const px = (position[0] - start[0]) * xScale
  const py = position[1] - start[1]
  const denominator = dx * dx + dy * dy
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / denominator))
  return { point: pointAt(start, end, t), t }
}

/**
 * Snaps arbitrary WGS 84 locations to their nearest network edge and splits those
 * edges into a working graph so routes can start and end between original vertices.
 */
export function snapLocations(graph: NetworkGraph, positions: NetworkCoordinate[], maximumDistanceMeters: number): SnapResult {
  if (!Number.isFinite(maximumDistanceMeters) || maximumDistanceMeters < 0) {
    throw new Error('Snap distance cannot be negative.')
  }
  if (positions.length * graph.edges.length > MAX_SNAP_COMPARISONS) {
    throw new Error(`Snapping would compare more than ${MAX_SNAP_COMPARISONS.toLocaleString()} network edges. Use fewer locations.`)
  }

  const snapped = positions.map((position) => {
    let best: { edge: NetworkEdge; point: NetworkCoordinate; t: number; distance: number } | null = null
    for (const edge of graph.edges) {
      const start = graph.nodes.get(edge.from)!.position
      const end = graph.nodes.get(edge.to)!.position
      const projection = projectToSegment(position, start, end)
      const distance = haversine(position, projection.point)
      if (!best || distance < best.distance) best = { edge, ...projection, distance }
    }
    if (!best || best.distance > maximumDistanceMeters) {
      const distance = best?.distance
      throw new Error(`A location is farther than the ${maximumDistanceMeters.toLocaleString()} m snap distance${distance === undefined ? '.' : ` (${Math.round(distance)} m away).`}`)
    }
    return { ...best, nodeId: coordinateKey(best.point) }
  })

  const working = makeGraph()
  for (const node of graph.nodes.values()) addNode(working, node.position)
  const byEdge = new Map<string, typeof snapped>()
  snapped.forEach((snap) => {
    const group = byEdge.get(snap.edge.id) ?? []
    group.push(snap)
    byEdge.set(snap.edge.id, group)
  })

  for (const edge of graph.edges) {
    const start = graph.nodes.get(edge.from)!.position
    const end = graph.nodes.get(edge.to)!.position
    const edgeSnaps = byEdge.get(edge.id) ?? []
    const cuts = [
      { t: 0, position: start },
      ...edgeSnaps.map((snap) => ({ t: snap.t, position: snap.point })),
      { t: 1, position: end },
    ].sort((a, b) => a.t - b.t)
    const unique = cuts.filter((cut, index) => index === 0 ||
      Math.abs(cut.t - cuts[index - 1].t) > 1e-10 && coordinateKey(cut.position) !== coordinateKey(cuts[index - 1].position))
    for (let index = 1; index < unique.length; index += 1) {
      const from = addNode(working, unique[index - 1].position)
      const to = addNode(working, unique[index].position)
      if (from === to) continue
      const ratio = unique[index].t - unique[index - 1].t
      addEdge(working, {
        ...edge,
        id: `${edge.id}:${index}`,
        from,
        to,
        lengthMeters: edge.lengthMeters * ratio,
        travelTimeMinutes: edge.travelTimeMinutes * ratio,
      })
    }
  }
  return { graph: working, nodeIds: snapped.map((snap) => snap.nodeId), distances: snapped.map((snap) => snap.distance) }
}

function edgeCost(edge: NetworkEdge, impedance: NetworkImpedance): number {
  return impedance === 'time' ? edge.travelTimeMinutes : edge.lengthMeters
}

class MinHeap {
  private items: { id: string; cost: number }[] = []

  push(item: { id: string; cost: number }): void {
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.items[parent].cost <= item.cost) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }

  pop(): { id: string; cost: number } | undefined {
    if (!this.items.length) return undefined
    const first = this.items[0]
    const last = this.items.pop()!
    if (this.items.length) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.items.length) break
        const child = right < this.items.length && this.items[right].cost < this.items[left].cost ? right : left
        if (this.items[child].cost >= last.cost) break
        this.items[index] = this.items[child]
        index = child
      }
      this.items[index] = last
    }
    return first
  }
}

export function shortestPath(
  graph: NetworkGraph,
  start: string,
  finish: string,
  impedance: NetworkImpedance = 'distance',
  forbiddenEdges: ReadonlySet<string> = new Set(),
  forbiddenNodes: ReadonlySet<string> = new Set(),
): NetworkRoute | null {
  if (!graph.nodes.has(start) || !graph.nodes.has(finish)) return null
  if (forbiddenNodes.has(start) || forbiddenNodes.has(finish)) return null
  if (start === finish) return { nodes: [start], edges: [], cost: 0 }

  const distance = new Map<string, number>([[start, 0]])
  const previous = new Map<string, { node: string; edge: string }>()
  const queue = new MinHeap()
  queue.push({ id: start, cost: 0 })
  while (true) {
    const current = queue.pop()
    if (!current) break
    if (current.cost !== distance.get(current.id)) continue
    if (current.id === finish) break
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      if (forbiddenEdges.has(edge.id)) continue
      const next = edge.from === current.id ? edge.to : edge.from
      if (forbiddenNodes.has(next)) continue
      const nextCost = current.cost + edgeCost(edge, impedance)
      if (nextCost >= (distance.get(next) ?? Infinity)) continue
      distance.set(next, nextCost)
      previous.set(next, { node: current.id, edge: edge.id })
      queue.push({ id: next, cost: nextCost })
    }
  }
  if (!distance.has(finish)) return null

  const nodes = [finish]
  const edges: string[] = []
  let current = finish
  while (current !== start) {
    const step = previous.get(current)
    if (!step) return null
    edges.push(step.edge)
    nodes.push(step.node)
    current = step.node
  }
  nodes.reverse()
  edges.reverse()
  return { nodes, edges, cost: distance.get(finish)! }
}

/** Computes all shortest paths from one origin, useful for facility and OD analyses. */
export function shortestPathsFrom(
  graph: NetworkGraph,
  start: string,
  impedance: NetworkImpedance = 'distance',
  maximumCost = Infinity,
): Map<string, NetworkRoute> {
  const distance = new Map<string, number>([[start, 0]])
  const previous = new Map<string, { node: string; edge: string }>()
  const queue = new MinHeap()
  queue.push({ id: start, cost: 0 })
  while (true) {
    const current = queue.pop()
    if (!current) break
    if (current.cost !== distance.get(current.id) || current.cost > maximumCost) continue
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      const next = edge.from === current.id ? edge.to : edge.from
      const nextCost = current.cost + edgeCost(edge, impedance)
      if (nextCost > maximumCost || nextCost >= (distance.get(next) ?? Infinity)) continue
      distance.set(next, nextCost)
      previous.set(next, { node: current.id, edge: edge.id })
      queue.push({ id: next, cost: nextCost })
    }
  }
  const paths = new Map<string, NetworkRoute>()
  for (const [finish, cost] of distance) {
    const nodes = [finish]
    const edges: string[] = []
    let current = finish
    while (current !== start) {
      const step = previous.get(current)
      if (!step) break
      edges.push(step.edge)
      nodes.push(step.node)
      current = step.node
    }
    if (current !== start) continue
    paths.set(finish, { nodes: nodes.reverse(), edges: edges.reverse(), cost })
  }
  return paths
}

/** Yen's loopless k-shortest paths; alternatives share only the portions the network requires. */
export function shortestPathAlternatives(
  graph: NetworkGraph,
  start: string,
  finish: string,
  impedance: NetworkImpedance,
  count: number,
): NetworkRoute[] {
  const first = shortestPath(graph, start, finish, impedance)
  if (!first) return []
  const accepted = [first]
  const candidates = new Map<string, NetworkRoute>()
  const signature = (route: NetworkRoute) => route.nodes.join('>')

  for (let iteration = 1; iteration < count; iteration += 1) {
    const previous = accepted[iteration - 1]
    for (let spurIndex = 0; spurIndex < previous.nodes.length - 1; spurIndex += 1) {
      const rootNodes = previous.nodes.slice(0, spurIndex + 1)
      const rootEdges = previous.edges.slice(0, spurIndex)
      const bannedEdges = new Set<string>()
      for (const route of accepted) {
        if (route.nodes.length > spurIndex && rootNodes.every((node, index) => route.nodes[index] === node)) {
          bannedEdges.add(route.edges[spurIndex])
        }
      }
      const bannedNodes = new Set(rootNodes.slice(0, -1))
      const spur = shortestPath(graph, rootNodes[rootNodes.length - 1], finish, impedance, bannedEdges, bannedNodes)
      if (!spur) continue
      const route: NetworkRoute = {
        nodes: [...rootNodes.slice(0, -1), ...spur.nodes],
        edges: [...rootEdges, ...spur.edges],
        cost: rootEdges.reduce((sum, id) => sum + edgeCost(graph.edges.find((edge) => edge.id === id)!, impedance), 0) + spur.cost,
      }
      const key = signature(route)
      if (!accepted.some((item) => signature(item) === key)) candidates.set(key, route)
    }
    const next = [...candidates.entries()].sort((a, b) => a[1].cost - b[1].cost || a[0].localeCompare(b[0]))[0]
    if (!next) break
    accepted.push(next[1])
    candidates.delete(next[0])
  }
  return accepted
}

export function reachableCosts(
  graph: NetworkGraph,
  start: string,
  impedance: NetworkImpedance,
  maximumCost = Infinity,
): Map<string, number> {
  const costs = new Map<string, number>()
  const queue = new MinHeap()
  if (!graph.nodes.has(start)) return costs
  costs.set(start, 0)
  queue.push({ id: start, cost: 0 })
  while (true) {
    const current = queue.pop()
    if (!current) break
    if (current.cost !== costs.get(current.id)) continue
    if (current.cost > maximumCost) continue
    for (const edge of graph.adjacency.get(current.id) ?? []) {
      const next = edge.from === current.id ? edge.to : edge.from
      const nextCost = current.cost + edgeCost(edge, impedance)
      if (nextCost > maximumCost || nextCost >= (costs.get(next) ?? Infinity)) continue
      costs.set(next, nextCost)
      queue.push({ id: next, cost: nextCost })
    }
  }
  return costs
}

export function routeCoordinates(graph: NetworkGraph, route: NetworkRoute): NetworkCoordinate[] {
  return route.nodes.map((id) => graph.nodes.get(id)!.position)
}

export function geometryPosition(feature: Feature<Geometry>, role: string): NetworkCoordinate {
  if (!feature.geometry || feature.geometry.type !== 'Point') {
    throw new Error(`${role} features must be points.`)
  }
  const position = feature.geometry.coordinates
  if (!isCoordinate(position)) throw new Error(`${role} contains an invalid WGS 84 point.`)
  return position
}

export function convexHull(points: NetworkCoordinate[]): NetworkCoordinate[] {
  const sorted = [...new Map(points.map((point) => [coordinateKey(point), point])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length <= 1) return sorted
  const cross = (o: NetworkCoordinate, a: NetworkCoordinate, b: NetworkCoordinate) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: NetworkCoordinate[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: NetworkCoordinate[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

