import type { Feature, Geometry, LineString } from 'geojson'
import { geometryPosition, routeCoordinates, shortestPathsFrom, snapLocations } from '../../networkEngine'
import type { NetworkRoute } from '../../networkEngine'
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

export const closestFacilityTool: ToolboxTool = {
  id: 'network-closest-facility',
  name: 'Closest Facility',
  category: 'Network Analyst',
  subcategory: 'Network Analysis',
  description: 'Find the least-cost facility for each incident and create network routes between the matched locations.',
  keywords: ['network analyst', 'closest facility', 'incident', 'facility', 'route', 'travel time'],
  parameters: [
    ...networkOptions,
    { id: 'incidents', label: 'Incidents (points)', kind: 'layer', required: true },
    { id: 'facilities', label: 'Facilities (points)', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Closest Facility Routes' },
  ],
  execute: (context, parameters) => {
    const { layer: networkLayer, graph } = networkFrom(context, parameters)
    const incidentsLayer = pointLayer(context, parameters, 'incidents', 'Incident')
    const facilitiesLayer = pointLayer(context, parameters, 'facilities', 'Facility')
    if (!incidentsLayer.data.features.length) throw new Error('The incidents layer has no usable points.')
    if (!facilitiesLayer.data.features.length) throw new Error('The facilities layer has no usable points.')

    const incidentItems = incidentsLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Incident feature ${index + 1}`),
    }))
    const facilityItems = facilitiesLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Facility feature ${index + 1}`),
    }))
    const allPoints = [...incidentItems, ...facilityItems]
    const snapDistance = numberParameter(parameters, 'snapDistance', 'snap distance', 1000)
    const snapped = snapLocations(graph, allPoints.map((item) => item.position), snapDistance)
    const incidentNodes = snapped.nodeIds.slice(0, incidentItems.length)
    const facilityNodes = snapped.nodeIds.slice(incidentItems.length)
    const mode = impedance(parameters)
    const routes: Feature<Geometry>[] = []

    incidentItems.forEach((incident, incidentIndex) => {
      let best: { facilityIndex: number; route: NetworkRoute } | null = null
      const routesFromIncident = shortestPathsFrom(snapped.graph, incidentNodes[incidentIndex], mode)
      facilityNodes.forEach((facilityNode, facilityIndex) => {
        const route = routesFromIncident.get(facilityNode)
        if (route && (!best || route.cost < best.route.cost)) best = { facilityIndex, route }
      })
      if (!best) return
      const selected = best as { facilityIndex: number; route: NetworkRoute }
      const facility = facilityItems[selected.facilityIndex]
      const edgeById = new Map(snapped.graph.edges.map((edge) => [edge.id, edge]))
      const distance = selected.route.edges.reduce((sum, id) => sum + (edgeById.get(id)?.lengthMeters ?? 0), 0)
      const time = selected.route.edges.reduce((sum, id) => sum + (edgeById.get(id)?.travelTimeMinutes ?? 0), 0)
      const feature: Feature<LineString> = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: routeCoordinates(snapped.graph, selected.route) },
        properties: {
          INCIDENT_FID: incident.index,
          FACILITY_FID: facility.index,
          COST: mode === 'time' ? time : distance,
          COST_UNIT: mode === 'time' ? 'minutes' : 'meters',
          DIST_M: distance,
          TIME_MIN: time,
          SNAP_INCIDENT_M: snapped.distances[incidentIndex],
          SNAP_FACILITY_M: snapped.distances[incidentItems.length + selected.facilityIndex],
        },
      }
      routes.push(feature)
    })
    if (!routes.length) throw new Error('No facility is reachable from any incident on this network.')

    const output = geometryOutput(outputName(parameters, `${incidentsLayer.name} Closest Facility`), routes, networkLayer.sourceCrs)
    return {
      message: `${output.name}: matched ${routes.length} of ${incidentItems.length} incidents to their closest reachable facility.`,
      kind: routes.length < incidentItems.length ? 'warning' : 'success',
      layers: [output],
    }
  },
}
