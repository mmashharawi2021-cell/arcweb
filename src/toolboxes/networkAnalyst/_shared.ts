import { featureCollection } from '@turf/helpers'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { tableRow } from '../../geojson'
import type { MapLayer } from '../../store'
import {
  buildNetworkGraph,
  geometryPosition,
  snapLocations,
  type NetworkGraph,
  type NetworkImpedance,
} from '../../networkEngine'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import type { ToolboxContext, ToolboxParameters } from '../types'

export const DEFAULT_SPEED_KPH = 40
export const DEFAULT_SNAP_DISTANCE = 1000
export const networkOptions = [
  { id: 'target', label: 'Street network', kind: 'layer' as const, required: true },
  { id: 'impedance', label: 'Travel mode', kind: 'select' as const, defaultValue: 'distance', options: [
    { value: 'distance', label: 'Distance (meters)' },
    { value: 'time', label: 'Travel time (minutes)' },
  ] },
  { id: 'speedField', label: 'Speed field in km/h (optional)', kind: 'field' as const, layerParameter: 'target', allowEmpty: true },
  { id: 'defaultSpeed', label: 'Default speed (km/h)', kind: 'number' as const, defaultValue: DEFAULT_SPEED_KPH, min: 0.1, step: 1 },
  { id: 'snapDistance', label: 'Maximum location snap distance (meters)', kind: 'number' as const, defaultValue: DEFAULT_SNAP_DISTANCE, min: 0, step: 10 },
]

export function numberParameter(parameters: ToolboxParameters, id: string, label: string, fallback: number): number {
  const value = parameters[id]
  const number = value === undefined || value === '' ? fallback : getNumber(parameters, id, label)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} cannot be negative.`)
  return number
}

export function networkFrom(context: ToolboxContext, parameters: ToolboxParameters): { layer: MapLayer; graph: NetworkGraph } {
  const layer = getLayer(context, parameters, 'target')
  const speedField = getOptionalText(parameters, 'speedField')
  const defaultSpeedKph = numberParameter(parameters, 'defaultSpeed', 'default speed', DEFAULT_SPEED_KPH)
  if (defaultSpeedKph === 0) throw new Error('Default speed must be greater than zero.')
  return {
    layer,
    graph: buildNetworkGraph(layer.data, { speedField, defaultSpeedKph }),
  }
}

export function impedance(parameters: ToolboxParameters): NetworkImpedance {
  const value = getOptionalText(parameters, 'impedance') || 'distance'
  if (value !== 'distance' && value !== 'time') throw new Error('Choose a supported travel mode.')
  return value
}

export function snappedPoints(
  layer: MapLayer,
  role: string,
  graph: NetworkGraph,
  parameters: ToolboxParameters,
) {
  const points = layer.data.features.map((feature, index) => ({
    feature,
    index: index + 1,
    position: geometryPosition(feature as Feature<Geometry>, `${role} feature ${index + 1}`),
  }))
  if (!points.length) throw new Error(`The ${role} layer has no usable points.`)
  const snapDistance = numberParameter(parameters, 'snapDistance', 'snap distance', DEFAULT_SNAP_DISTANCE)
  const result = snapLocations(graph, points.map((point) => point.position), snapDistance)
  return { points, ...result }
}

export function pointLayer(context: ToolboxContext, parameters: ToolboxParameters, id: string, role: string): MapLayer {
  const layer = getLayer(context, parameters, id)
  for (const [index, feature] of layer.data.features.entries()) {
    if (!feature.geometry || feature.geometry.type !== 'Point') {
      throw new Error(`${role} features must be points; feature ${index + 1} is not a point.`)
    }
  }
  return layer
}

export function outputName(parameters: ToolboxParameters, fallback: string): string {
  return getOptionalText(parameters, 'outputName') || fallback
}

export function geometryOutput(
  name: string,
  features: Feature<Geometry>[],
  sourceCrs: string,
): MapLayer {
  return outputLayer(name, featureCollection(features), sourceCrs)
}

export function tableOutput(name: string, rows: Record<string, unknown>[], sourceCrs: string): MapLayer {
  const features: Feature<Geometry>[] = rows.map((properties) => tableRow(properties))
  const data: FeatureCollection = featureCollection(features)
  return outputLayer(name, data, sourceCrs)
}

export function getMaxCost(parameters: ToolboxParameters, label: string, fallback: number): number {
  const value = numberParameter(parameters, 'maximumCost', label, fallback)
  if (value <= 0) throw new Error(`${label} must be greater than zero.`)
  return value
}
