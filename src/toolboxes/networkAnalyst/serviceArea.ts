import { isolate } from '../../bidi'
import type { Feature, Geometry, Position } from 'geojson'
import { convexHull, geometryPosition, reachableCosts, snapLocations } from '../../networkEngine'
import type { ToolboxTool } from '../types'
import {
  getMaxCost,
  geometryOutput,
  impedance,
  networkFrom,
  networkOptions,
  numberParameter,
  outputName,
  pointLayer,
} from './_shared'

export const serviceAreaTool: ToolboxTool = {
  id: 'network-service-area',
  name: 'Service Area',
  category: 'Network Analyst',
  subcategory: 'Network Analysis',
  description: 'Map network locations reachable from facilities within a distance or travel-time cutoff using an approximate convex-hull boundary.',
  keywords: ['network analyst', 'service area', 'drive time', 'reachable', 'facility', 'network'],
  parameters: [
    ...networkOptions,
    { id: 'facilities', label: 'Facilities (points)', kind: 'layer', required: true },
    { id: 'maximumCost', label: 'Maximum distance (meters) or travel time (minutes)', kind: 'number', required: true, defaultValue: 1500, min: 0.01, step: 10 },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Service Area' },
  ],
  execute: (context, parameters) => {
    const { layer: networkLayer, graph } = networkFrom(context, parameters)
    const facilitiesLayer = pointLayer(context, parameters, 'facilities', 'Facility')
    if (!facilitiesLayer.data.features.length) throw new Error('The facilities layer has no usable points.')
    const facilities = facilitiesLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Facility feature ${index + 1}`),
    }))
    const snapped = snapLocations(
      graph,
      facilities.map((item) => item.position),
      numberParameter(parameters, 'snapDistance', 'snap distance', 1000),
    )
    const mode = impedance(parameters)
    const maximumCost = getMaxCost(parameters, 'maximum cost', 1500)
    const features: Feature<Geometry>[] = facilities.map((facility, index) => {
      const costs = reachableCosts(snapped.graph, snapped.nodeIds[index], mode, maximumCost)
      const hull = convexHull([...costs.keys()].map((id) => snapped.graph.nodes.get(id)!.position))
      let geometry: Geometry
      if (hull.length >= 3) {
        const ring: Position[] = [...hull, hull[0]]
        geometry = { type: 'Polygon', coordinates: [ring] }
      } else if (hull.length === 2) {
        geometry = { type: 'LineString', coordinates: hull }
      } else {
        geometry = { type: 'Point', coordinates: hull[0] ?? facility.position }
      }
      return {
        type: 'Feature',
        geometry,
        properties: {
          FACILITY_FID: facility.index,
          MAX_COST: maximumCost,
          COST_UNIT: mode === 'time' ? 'minutes' : 'meters',
          REACHABLE_NODES: costs.size,
          SNAP_DIST_M: snapped.distances[index],
        },
      }
    })
    const output = geometryOutput(outputName(parameters, `${facilitiesLayer.name} Service Area`), features, networkLayer.sourceCrs)
    return {
      message: `${isolate(output.name)}: generated ${features.length} service area${features.length === 1 ? '' : 's'} using a ${maximumCost.toLocaleString()} ${mode === 'time' ? 'minute' : 'meter'} cutoff.`,
      layers: [output],
    }
  },
}
