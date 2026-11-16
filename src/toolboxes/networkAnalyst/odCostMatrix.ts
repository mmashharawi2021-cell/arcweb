import type { Feature, Geometry } from 'geojson'
import { geometryPosition, shortestPathsFrom, snapLocations } from '../../networkEngine'
import type { ToolboxTool } from '../types'
import {
  impedance,
  networkFrom,
  networkOptions,
  numberParameter,
  outputName,
  pointLayer,
  tableOutput,
} from './_shared'

const MAX_OD_ROWS = 100_000

export const odCostMatrixTool: ToolboxTool = {
  id: 'network-od-cost-matrix',
  name: 'OD Cost Matrix',
  category: 'Network Analyst',
  subcategory: 'Network Analysis',
  description: 'Calculate least-cost network travel from every origin to every destination and return a geometry-less matrix table.',
  keywords: ['network analyst', 'origin destination', 'od', 'cost matrix', 'travel time', 'distance'],
  parameters: [
    ...networkOptions,
    { id: 'origins', label: 'Origins (points)', kind: 'layer', required: true },
    { id: 'destinations', label: 'Destinations (points)', kind: 'layer', required: true },
    { id: 'maximumCost', label: 'Maximum distance (meters) or travel time (minutes), 0 = unlimited', kind: 'number', defaultValue: 0, min: 0, step: 10 },
    { id: 'outputName', label: 'Output table name', kind: 'text', placeholder: 'OD Cost Matrix' },
  ],
  execute: (context, parameters) => {
    const { layer: networkLayer, graph } = networkFrom(context, parameters)
    const originsLayer = pointLayer(context, parameters, 'origins', 'Origin')
    const destinationsLayer = pointLayer(context, parameters, 'destinations', 'Destination')
    const origins = originsLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Origin feature ${index + 1}`),
    }))
    const destinations = destinationsLayer.data.features.map((feature, index) => ({
      feature,
      index: index + 1,
      position: geometryPosition(feature as Feature<Geometry>, `Destination feature ${index + 1}`),
    }))
    if (!origins.length) throw new Error('The origins layer has no usable points.')
    if (!destinations.length) throw new Error('The destinations layer has no usable points.')
    if (origins.length * destinations.length > MAX_OD_ROWS) {
      throw new Error(`The OD matrix would exceed ${MAX_OD_ROWS.toLocaleString()} rows.`)
    }
    const allLocations = [...origins, ...destinations]
    const snapped = snapLocations(
      graph,
      allLocations.map((item) => item.position),
      numberParameter(parameters, 'snapDistance', 'snap distance', 1000),
    )
    const mode = impedance(parameters)
    const maximumCost = numberParameter(parameters, 'maximumCost', 'maximum cost', 0)
    const rows: Record<string, unknown>[] = []
    const edgeById = new Map(snapped.graph.edges.map((edge) => [edge.id, edge]))
    origins.forEach((origin, originIndex) => {
      const routesFromOrigin = shortestPathsFrom(snapped.graph, snapped.nodeIds[originIndex], mode)
      destinations.forEach((destination, destinationIndex) => {
        const route = routesFromOrigin.get(snapped.nodeIds[origins.length + destinationIndex])
        const withinLimit = route && (maximumCost === 0 || route.cost <= maximumCost)
        const distance = withinLimit
          ? route!.edges.reduce((sum, id) => sum + (edgeById.get(id)?.lengthMeters ?? 0), 0)
          : null
        const time = withinLimit
          ? route!.edges.reduce((sum, id) => sum + (edgeById.get(id)?.travelTimeMinutes ?? 0), 0)
          : null
        rows.push({
          ORIGIN_FID: origin.index,
          DEST_FID: destination.index,
          STATUS: withinLimit ? 'OK' : route ? 'CUTOFF' : 'UNREACHABLE',
          COST: withinLimit ? route!.cost : null,
          COST_UNIT: mode === 'time' ? 'minutes' : 'meters',
          DIST_M: distance,
          TIME_MIN: time,
          SNAP_ORIGIN_M: snapped.distances[originIndex],
          SNAP_DEST_M: snapped.distances[origins.length + destinationIndex],
        })
      })
    })
    const output = tableOutput(outputName(parameters, `${originsLayer.name} - ${destinationsLayer.name} OD Matrix`), rows, networkLayer.sourceCrs)
    const reachable = rows.filter((row) => row.STATUS === 'OK').length
    return {
      message: `${output.name}: ${reachable} of ${rows.length} origin-destination pairs are reachable${maximumCost ? ` within the ${maximumCost.toLocaleString()} cutoff` : ''}.`,
      kind: reachable ? 'success' : 'warning',
      layers: [output],
    }
  },
}
