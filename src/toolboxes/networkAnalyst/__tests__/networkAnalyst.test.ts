import type { Feature, Geometry, Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { buildNetworkGraph, shortestPath, snapLocations } from '../../../networkEngine'
import { runTool, testLayer } from '../../testUtils'
import type { ToolExecutionResult } from '../../types'
import { closestFacilityTool } from '../closestFacility'
import { networkAnalystTools } from '../index'
import { odCostMatrixTool } from '../odCostMatrix'
import { routeTool } from '../route'
import { serviceAreaTool } from '../serviceArea'

type Props = Record<string, unknown>

const line = (coordinates: Position[], properties: Props = {}): Feature<Geometry> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties,
})

const point = (x: number, y: number, properties: Props = {}): Feature<Geometry> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [x, y] },
  properties,
})

/** A deterministic 3x3 street grid with deliberately different road speeds. */
function streetGrid() {
  const features: Feature<Geometry>[] = []
  for (const y of [0, 0.01, 0.02]) {
    for (let x = 0; x < 0.02; x += 0.01) {
      features.push(line([[x, y], [x + 0.01, y]], { SPEED: y === 0.01 ? 100 : 10 }))
    }
  }
  for (const x of [0, 0.01, 0.02]) {
    for (let y = 0; y < 0.02; y += 0.01) {
      features.push(line([[x, y], [x, y + 0.01]], { SPEED: 40 }))
    }
  }
  return testLayer('Street Grid', features)
}

const features = (result: ToolExecutionResult) => result.layers?.[0].data.features ?? []

describe('Network Analyst toolbox', () => {
  it('exports the four Network Analyst tools with unique IDs', () => {
    expect(networkAnalystTools.map((tool) => tool.id)).toEqual([
      'network-route',
      'network-closest-facility',
      'network-service-area',
      'network-od-cost-matrix',
    ])
    expect(new Set(networkAnalystTools.map((tool) => tool.id)).size).toBe(4)
    expect(networkAnalystTools.every((tool) =>
      tool.category === 'Network Analyst' && tool.subcategory === 'Network Analysis')).toBe(true)
  })

  it('splits crossings into shared graph nodes and computes impedance-specific routes', async () => {
    const crossing = buildNetworkGraph([{
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [[[-0.01, 0], [0.01, 0]], [[0, -0.01], [0, 0.01]]],
      },
      properties: {},
    }])
    expect(crossing.nodes.has('0.0000000,0.0000000')).toBe(true)
    expect(crossing.edges).toHaveLength(4)

    const graph = buildNetworkGraph(streetGrid().data, { speedField: 'SPEED' })
    const snapped = snapLocations(graph, [[0, 0], [0.02, 0.02]], 0)
    const shortest = shortestPath(snapped.graph, snapped.nodeIds[0], snapped.nodeIds[1], 'distance')!
    const fastest = shortestPath(snapped.graph, snapped.nodeIds[0], snapped.nodeIds[1], 'time')!
    expect(shortest).not.toBeNull()
    expect(fastest).not.toBeNull()
    const edgeById = new Map(snapped.graph.edges.map((edge) => [edge.id, edge]))
    const shortestRouteTime = shortest.edges.reduce((sum, id) => sum + edgeById.get(id)!.travelTimeMinutes, 0)
    expect(fastest.cost).toBeLessThan(shortestRouteTime)
    expect(fastest.nodes).not.toEqual(shortest.nodes)

    const network = streetGrid()
    const stops = testLayer('Stops', [point(0, 0), point(0.02, 0.02)])
    const result = await runTool(routeTool, [network, stops], {
      target: network.id,
      stops: stops.id,
      speedField: 'SPEED',
      alternatives: 3,
      snapDistance: 0,
    })
    expect(features(result)).toHaveLength(3)
    expect(features(result).map((feature) => feature.properties?.ALTERNATIVE)).toEqual([1, 2, 3])
    expect(features(result).every((feature) => Number(feature.properties?.DIST_M) > 0 && Number(feature.properties?.TIME_MIN) > 0)).toBe(true)
  })

  it('reports disconnected routes and invalid network features clearly', async () => {
    const disconnected = testLayer('Disconnected', [
      line([[0, 0], [0.001, 0]]),
      line([[0.01, 0], [0.011, 0]]),
    ])
    const stops = testLayer('Stops', [point(0, 0), point(0.011, 0)])
    await expect(runTool(routeTool, [disconnected, stops], {
      target: disconnected.id,
      stops: stops.id,
      snapDistance: 0,
    })).rejects.toThrow(/No route connects/)

    const invalid = testLayer('Invalid', [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      properties: {},
    }])
    await expect(runTool(routeTool, [invalid, stops], {
      target: invalid.id,
      stops: stops.id,
    })).rejects.toThrow(/LineString or MultiLineString/)
  })

  it('returns closest-facility route lines and a geometry-null OD matrix table', async () => {
    const network = streetGrid()
    const incidents = testLayer('Incidents', [point(0, 0), point(0.02, 0)])
    const facilities = testLayer('Facilities', [point(0.02, 0.02), point(0, 0.02)])
    const closest = await runTool(closestFacilityTool, [network, incidents, facilities], {
      target: network.id,
      incidents: incidents.id,
      facilities: facilities.id,
      snapDistance: 0,
    })
    expect(features(closest)).toHaveLength(2)
    expect(features(closest).every((feature) => feature.geometry?.type === 'LineString')).toBe(true)
    expect(features(closest).every((feature) => Number(feature.properties?.FACILITY_FID) > 0)).toBe(true)

    const matrix = await runTool(odCostMatrixTool, [network, incidents, facilities], {
      target: network.id,
      origins: incidents.id,
      destinations: facilities.id,
      snapDistance: 0,
    })
    expect(features(matrix)).toHaveLength(4)
    expect(features(matrix).every((feature) => feature.geometry === null)).toBe(true)
    expect(features(matrix).every((feature) => feature.properties?.STATUS === 'OK')).toBe(true)
    expect(Number(features(matrix)[0].properties?.DIST_M)).toBeGreaterThan(0)
  })

  it('creates valid service-area polygons from reachable network nodes', async () => {
    const network = streetGrid()
    const facilities = testLayer('Depots', [point(0.01, 0.01)])
    const result = await runTool(serviceAreaTool, [network, facilities], {
      target: network.id,
      facilities: facilities.id,
      maximumCost: 1500,
      snapDistance: 0,
    })
    expect(features(result)).toHaveLength(1)
    expect(features(result)[0].geometry?.type).toBe('Polygon')
    const polygon = features(result)[0].geometry
    if (polygon?.type === 'Polygon') {
      expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0][polygon.coordinates[0].length - 1])
      expect(polygon.coordinates[0].length).toBeGreaterThanOrEqual(4)
    }
    expect(features(result)[0].properties?.REACHABLE_NODES).toBeGreaterThan(1)
  })
})
