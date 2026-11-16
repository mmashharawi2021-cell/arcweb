import { isolate } from '../../bidi'
import area from '@turf/area'
import { featureCollection } from '@turf/helpers'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPolygon, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { simplifyFeatures } from './_generalize'
import { optionalNumber, outputNameParameter } from './_utils'

/** Simplify Polygon: Douglas–Peucker on polygon rings with a metre tolerance, keeping results valid. */
export const simplifyPolygonTool: ToolboxTool = {
  id: 'simplify-polygon',
  name: 'Simplify Polygon',
  category: 'Data Management',
  subcategory: 'Generalization',
  description: 'Simplify polygon outlines with a tolerance in metres, repairing any resulting self-intersections and optionally dropping small polygons.',
  keywords: ['generalize', 'generalise', 'reduce vertices', 'douglas peucker', 'point remove'],
  parameters: [
    { id: 'target', label: 'Input polygon layer', kind: 'layer', required: true },
    { id: 'tolerance', label: 'Simplification tolerance (m)', kind: 'number', required: true, min: 0, defaultValue: 10 },
    { id: 'minimumArea', label: 'Minimum area (m², optional)', kind: 'number', min: 0, defaultValue: 0 },
    outputNameParameter('Simplified polygons'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const tolerance = getNumber(parameters, 'tolerance', 'tolerance')
    if (tolerance <= 0) throw new Error('The simplification tolerance must be greater than zero.')
    const minimumArea = optionalNumber(parameters, 'minimumArea', 'minimum area') ?? 0
    const polygons = usableFeatures(layer).filter(isPolygon)
    assertHasFeatures(polygons, 'Simplify Polygon needs a polygon layer.')
    const simplified = simplifyFeatures(polygons, tolerance)
    const kept = minimumArea > 0 ? simplified.filter((feature) => area(feature) >= minimumArea) : simplified
    assertHasFeatures(kept, 'Every polygon collapsed or fell below the minimum area.')
    const dropped = polygons.length - kept.length
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Simplified`, featureCollection(kept), layer.sourceCrs)
    return {
      message: `${isolate(output.name)}: simplified ${kept.length.toLocaleString()} polygons.${dropped ? ` ${dropped} collapsed or small polygons were removed.` : ''}`,
      kind: dropped ? 'warning' : 'success',
      layers: [output],
    }
  },
}
