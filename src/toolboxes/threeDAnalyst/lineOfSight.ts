import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { rasterInput, getRaster } from '../spatialAnalyst/_shared'
import { outputLayer } from '../shared'
import { calculateLineOfSight, getPointCoordinates } from './_visibility'
import { getLayer, getNumber } from '../shared'
import { outputNameParameter, THREE_D_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

export const lineOfSightTool: ToolboxTool = {
  id: 'lineOfSight',
  name: 'Line Of Sight',
  category: THREE_D_CATEGORY,
  subcategory: 'Visibility',
  description: 'Test intervisibility between two point features over a terrain raster, accounting for observer and target offsets.',
  keywords: ['visibility', 'line of sight', 'observer', 'terrain', 'elevation'],
  parameters: [
    { id: 'points', label: 'Observer and target point layer', kind: 'layer', required: true },
    rasterInput(),
    { id: 'observerIndex', label: 'Observer point number (zero-based)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
    { id: 'targetIndex', label: 'Target point number (zero-based)', kind: 'number', defaultValue: 1, min: 0, step: 1 },
    { id: 'observerHeight', label: 'Observer height above terrain (m)', kind: 'number', defaultValue: 1.7, min: 0 },
    { id: 'targetHeight', label: 'Target height above terrain (m)', kind: 'number', defaultValue: 0, min: 0 },
    { id: 'valueField', label: 'Raster elevation field', kind: 'text', defaultValue: 'value' },
    outputNameParameter('Line Of Sight'),
  ],
  execute: (context, parameters) => {
    const points = getLayer(context, parameters, 'points')
    const { layer: rasterLayer, grid } = getRaster(context, parameters)
    const observer = getPointCoordinates(points.data, getNumber(parameters, 'observerIndex', 'observer point number'), 'Observer')
    const target = getPointCoordinates(points.data, getNumber(parameters, 'targetIndex', 'target point number'), 'Target')
    const observerHeight = getNumber(parameters, 'observerHeight', 'observer height')
    const targetHeight = getNumber(parameters, 'targetHeight', 'target height')
    if (observerHeight < 0 || targetHeight < 0) throw new Error('Observer and target heights cannot be negative.')
    const result = calculateLineOfSight(grid, observer, target, observerHeight, targetHeight)
    const name = typeof parameters.outputName === 'string' && parameters.outputName.trim() ? parameters.outputName.trim() : `${points.name} Line Of Sight`
    const lineFeature: Feature = {
      type: 'Feature',
      properties: {
        visible: result.visible,
        distanceMeters: result.distance,
        observerElevation: result.startElevation,
        targetElevation: result.endElevation,
        firstObstructionDistance: result.firstObstructionDistance,
        obstructionElevation: result.obstructionElevation,
        noDataSamplesIgnored: result.noDataSamples,
      },
      geometry: { type: 'LineString', coordinates: result.line },
    }
    const output = outputLayer(name, featureCollection([lineFeature]), rasterLayer.sourceCrs)
    output.strokeColor = result.visible ? '#44d7a8' : '#f06b68'
    output.strokeWidth = 3
    return {
      message: `${name}: line of sight is ${result.visible ? 'clear' : 'blocked'} across ${result.distance.toFixed(1)} m of terrain.${result.noDataSamples ? ` ${result.noDataSamples} intermediate NoData samples were ignored.` : ''}`,
      ...(result.noDataSamples ? { kind: 'warning' as const } : {}),
      layers: [output],
    }
  },
}
