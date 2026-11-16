import type { Feature, Geometry, LineString } from 'geojson'
import {
  geometryPosition,
  routeCoordinates,
  shortestPathAlternatives,
  snapLocations,
  type NetworkRoute,
} from '../../networkEngine'
import type { ToolboxTool } from '../types'
import {
  geometryOutput,
  impedance,
  networkFrom,
  networkOptions,
  numberParameter,
  outputName,
  pointLayer,
} from './_shared'

function routeMetrics(route: NetworkRoute, graph: ReturnType<typeof networkFrom>['graph']) {
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const distance = route.edges.reduce((sum, id) => sum + (edges.get(id)?.lengthMeters ?? 0), 0)
  const time = route.edges.reduce((sum, id) => sum + (edges.get(id)?.travelTimeMinutes ?? 0), 0)
  return { distance, time }
}

export const routeTool: ToolboxTool = {
  id: 'network-route',
  name: 'Route',
  category: 'Network Analyst',
  subcategory: 'Network Analysis',
  description: 'Find the least-cost route between two stops on a topologically connected street network, with optional alternatives.',
  keywords: ['network analyst', 'route', 'street', 'shortest path', 'travel time', 'alternative'],
  parameters: [
    ...networkOptions,
    { id: 'stops', label: 'Stops (exactly two points)', kind: 'layer', required: true },
    { id: 'alternatives', label: 'Number of routes', kind: 'number', defaultValue: 1, min: 1, max: 3, step: 1 },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Route' },
  ],
  execute: (context, parameters) => {
    const { layer: networkLayer, graph } = networkFrom(context, parameters)
    const stopsLayer = pointLayer(context, parameters, 'stops', 'Route stop')
    if (stopsLayer.data.features.length !== 2) throw new Error('Route requires exactly two stop points.')
    const points = stopsLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Route stop ${index + 1}`),
    }))
    const maximumAlternatives = Math.floor(numberParameter(parameters, 'alternatives', 'number of routes', 1))
    if (maximumAlternatives < 1 || maximumAlternatives > 3) throw new Error('Choose between one and three routes.')
    const snapDistance = numberParameter(parameters, 'snapDistance', 'snap distance', 1000)
    const snapped = snapLocations(graph, points.map((point) => point.position), snapDistance)
    const mode = impedance(parameters)
    const routes = shortestPathAlternatives(snapped.graph, snapped.nodeIds[0], snapped.nodeIds[1], mode, maximumAlternatives)
    if (!routes.length) throw new Error('No route connects the selected stops on this network.')

    const features: Feature<Geometry>[] = routes.map((route, index) => {
      const metrics = routeMetrics(route, snapped.graph)
      const coordinates = routeCoordinates(snapped.graph, route)
      const line: Feature<LineString> = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          ROUTE_ID: index + 1,
          ALTERNATIVE: index + 1,
          COST: mode === 'time' ? metrics.time : metrics.distance,
          COST_UNIT: mode === 'time' ? 'minutes' : 'meters',
          DIST_M: metrics.distance,
          TIME_MIN: metrics.time,
          FROM_FID: points[0].index,
          TO_FID: points[1].index,
          SNAP_FROM_M: snapped.distances[0],
          SNAP_TO_M: snapped.distances[1],
        },
      }
      return line
    })
    const output = geometryOutput(outputName(parameters, `${stopsLayer.name} Route`), features, networkLayer.sourceCrs)
    return {
      message: `${output.name}: generated ${routes.length} route${routes.length === 1 ? '' : ' alternatives'} using ${mode} impedance.`,
      layers: [output],
    }
  },
}
