import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPolygon, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { chaikin } from './_generalize'
import { optionalNumber, outputNameParameter, repairPolygonGeometry } from './_utils'

/** Smooth Polygon: Chaikin corner cutting on every ring, followed by a validity repair. */
export const smoothPolygonTool: ToolboxTool = {
  id: 'smooth-polygon',
  name: 'Smooth Polygon',
  category: 'Data Management',
  subcategory: 'Generalization',
  description: 'Smooth sharp angles in polygon outlines (and holes) using Chaikin corner cutting; results are repaired to stay topologically valid.',
  keywords: ['generalize', 'curve', 'chaikin', 'cartography', 'smoothing', 'rounded'],
  parameters: [
    { id: 'target', label: 'Input polygon layer', kind: 'layer', required: true },
    { id: 'iterations', label: 'Smoothing passes (1–6)', kind: 'number', min: 1, max: 6, step: 1, defaultValue: 3 },
    outputNameParameter('Smoothed polygons'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const iterations = Math.round(optionalNumber(parameters, 'iterations', 'number of passes') ?? 3)
    if (iterations < 1 || iterations > 6) throw new Error('Smoothing passes must be between 1 and 6.')
    const polygons = usableFeatures(layer).filter(isPolygon)
    assertHasFeatures(polygons, 'Smooth Polygon needs a polygon layer.')
    let collapsed = 0
    const smoothed: Feature<Geometry>[] = polygons.flatMap((feature) => {
      const parts = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
      const coordinates: Position[][][] = parts.map((rings) => rings.map((ring) => chaikin(ring, iterations, true)))
      const geometry = repairPolygonGeometry({ type: 'MultiPolygon', coordinates })
      if (!geometry) { collapsed += 1; return [] }
      return [{ type: 'Feature' as const, properties: { ...(feature.properties ?? {}) }, geometry }]
    })
    assertHasFeatures(smoothed, 'No polygons could be smoothed.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Smoothed`, featureCollection(smoothed), layer.sourceCrs)
    return {
      message: `${output.name}: smoothed ${smoothed.length.toLocaleString()} polygons (${iterations} passes).${collapsed ? ` ${collapsed} collapsed and were removed.` : ''}`,
      kind: collapsed ? 'warning' : 'success',
      layers: [output],
    }
  },
}
