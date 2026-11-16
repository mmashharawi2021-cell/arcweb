import { bezierSpline, lineString } from '@turf/turf'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isLine, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { chaikin, validGeometry } from './_generalize'
import { cleanPath, optionalNumber, outputNameParameter } from './_utils'

function smoothPath(path: Position[], algorithm: string, iterations: number): Position[] {
  const cleaned = cleanPath(path)
  if (cleaned.length < 3) return cleaned
  if (algorithm === 'BEZIER') {
    // Bezier interpolation passes through every input vertex.
    return bezierSpline(lineString(cleaned), { resolution: 10000, sharpness: 0.85 }).geometry.coordinates
  }
  const closed = cleaned[0][0] === cleaned[cleaned.length - 1][0] && cleaned[0][1] === cleaned[cleaned.length - 1][1]
  return chaikin(cleaned, iterations, closed)
}

/** Smooth Line: smooths sharp angles with Bezier interpolation or Chaikin corner cutting. */
export const smoothLineTool: ToolboxTool = {
  id: 'smooth-line',
  name: 'Smooth Line',
  category: 'Data Management',
  subcategory: 'Generalization',
  description: 'Smooth sharp angles in lines using Bezier interpolation (through every vertex) or Chaikin corner cutting (end points preserved).',
  keywords: ['generalize', 'curve', 'bezier', 'chaikin', 'paek', 'cartography', 'smoothing'],
  parameters: [
    { id: 'target', label: 'Input line layer', kind: 'layer', required: true },
    {
      id: 'algorithm', label: 'Smoothing algorithm', kind: 'select', defaultValue: 'CHAIKIN',
      options: [
        { value: 'CHAIKIN', label: 'Chaikin corner cutting (stays close to the original)' },
        { value: 'BEZIER', label: 'Bezier interpolation (passes through every vertex)' },
      ],
    },
    { id: 'iterations', label: 'Smoothing passes (Chaikin, 1–6)', kind: 'number', min: 1, max: 6, step: 1, defaultValue: 3 },
    outputNameParameter('Smoothed lines'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const algorithm = getOptionalText(parameters, 'algorithm') || 'CHAIKIN'
    const iterations = Math.round(optionalNumber(parameters, 'iterations', 'number of passes') ?? 3)
    if (iterations < 1 || iterations > 6) throw new Error('Smoothing passes must be between 1 and 6.')
    const lines = usableFeatures(layer).filter(isLine)
    assertHasFeatures(lines, 'Smooth Line needs a line layer.')
    const smoothed: Feature<Geometry>[] = lines.flatMap((feature) => {
      const paths = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
      const result = paths.map((path) => smoothPath(path, algorithm, iterations))
      const geometry = validGeometry(result.length === 1 ? { type: 'LineString', coordinates: result[0] } : { type: 'MultiLineString', coordinates: result })
      return geometry ? [{ type: 'Feature' as const, properties: { ...(feature.properties ?? {}) }, geometry }] : []
    })
    assertHasFeatures(smoothed, 'No lines could be smoothed.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Smoothed`, featureCollection(smoothed), layer.sourceCrs)
    return { message: `${output.name}: smoothed ${smoothed.length.toLocaleString()} lines (${algorithm === 'BEZIER' ? 'Bezier interpolation' : `Chaikin, ${iterations} passes`}).`, layers: [output] }
  },
}
