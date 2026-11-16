import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, EARTH_RADIUS, geometryBBox, makeSpatialIndex, nearestBetween, pairBudget, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { outputNameParameter, tableRow } from '../dataManagement/_utils'

const MAX_FEATURES = 10_000
const METERS_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS

function nearbySearchFeature(feature: Feature<Geometry>, distance: number): Feature<Geometry> {
  const [west, south, east, north] = geometryBBox(feature.geometry)
  const latitudePadding = distance / METERS_PER_DEGREE
  const farthestLatitude = Math.min(89.999999, Math.max(Math.abs(south - latitudePadding), Math.abs(north + latitudePadding)))
  const longitudePadding = Math.min(360, distance / (METERS_PER_DEGREE * Math.max(Math.cos(farthestLatitude * Math.PI / 180), 1e-6)))
  const epsilon = 1e-12
  const minX = Math.max(-180, west - Math.max(longitudePadding, epsilon))
  const maxX = Math.min(180, east + Math.max(longitudePadding, epsilon))
  const minY = Math.max(-90, south - Math.max(latitudePadding, epsilon))
  const maxY = Math.min(90, north + Math.max(latitudePadding, epsilon))
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]] },
  }
}

/** Finds feature pairs that intersect or are closer than the requested graphic clearance. */
export const detectGraphicConflictTool: ToolboxTool = {
  id: 'detect-graphic-conflict',
  name: 'Detect Graphic Conflict',
  category: 'Cartography',
  subcategory: 'Generalization',
  description: 'Report pairs of features whose geometries overlap or fall within a specified clearance distance. Runs locally in your browser.',
  keywords: ['overlap', 'collision', 'conflict', 'clearance', 'cartographic'],
  parameters: [
    { id: 'target', label: 'Input feature layer', kind: 'layer', required: true },
    { id: 'distance', label: 'Minimum clearance (m)', kind: 'number', min: 0, defaultValue: 0 },
    outputNameParameter('Graphic conflicts'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const distance = getNumber(parameters, 'distance', 'minimum clearance')
    if (distance < 0) throw new Error('Minimum clearance must be zero or greater.')
    const features = usableFeatures(layer)
    assertHasFeatures(features, 'Detect Graphic Conflict needs features with geometry.')
    if (features.length > MAX_FEATURES) throw new Error(`Detect Graphic Conflict supports at most ${MAX_FEATURES.toLocaleString()} input features.`)
    const budget = pairBudget('Detect Graphic Conflict')
    const index = makeSpatialIndex(features)
    const positions = new Map(features.map((feature, featureIndex) => [feature, featureIndex]))
    const conflicts: Feature[] = []
    for (let first = 0; first < features.length; first += 1) {
      for (const candidate of index.search(nearbySearchFeature(features[first], distance))) {
        const second = positions.get(candidate)
        if (second === undefined || second <= first) continue
        budget(1)
        const result = nearestBetween(features[first] as Feature<Geometry>, features[second] as Feature<Geometry>)
        if (result.distance > distance) continue
        conflicts.push(tableRow({
          FEATURE_1: String(features[first].id ?? first + 1),
          FEATURE_2: String(features[second].id ?? second + 1),
          DISTANCE_M: Math.round(result.distance * 100) / 100,
          CONFLICT: result.distance === 0 ? 'Overlap or touch' : 'Below clearance',
        }))
      }
    }
    const name = getOptionalText(parameters, 'outputName') || `${layer.name} Graphic Conflicts`
    const output = outputLayer(name, featureCollection(conflicts), layer.sourceCrs)
    return {
      message: `${name}: found ${conflicts.length.toLocaleString()} conflicting feature pairs from ${features.length.toLocaleString()} features.`,
      layers: [output],
    }
  },
}
