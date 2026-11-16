import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isLine, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { countVertices, simplifyFeatures } from './_generalize'
import { outputNameParameter } from './_utils'


/** Simplify Line: removes redundant vertices (Douglas–Peucker point remove) within a tolerance in metres. */
export const simplifyLineTool: ToolboxTool = {
  id: 'simplify-line',
  name: 'Simplify Line',
  category: 'Data Management',
  subcategory: 'Generalization',
  description: 'Simplify lines by removing vertices that deviate less than a tolerance (metres) from the simplified shape (Douglas–Peucker point remove).',
  keywords: ['generalize', 'generalise', 'reduce vertices', 'douglas peucker', 'point remove', 'weed'],
  parameters: [
    { id: 'target', label: 'Input line layer', kind: 'layer', required: true },
    { id: 'tolerance', label: 'Simplification tolerance (m)', kind: 'number', required: true, min: 0, defaultValue: 10 },
    outputNameParameter('Simplified lines'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const tolerance = getNumber(parameters, 'tolerance', 'tolerance')
    if (tolerance <= 0) throw new Error('The simplification tolerance must be greater than zero.')
    const lines = usableFeatures(layer).filter(isLine)
    assertHasFeatures(lines, 'Simplify Line needs a line layer.')
    const simplified = simplifyFeatures(lines, tolerance)
    assertHasFeatures(simplified, 'Every line collapsed at this tolerance.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Simplified`, featureCollection(simplified), layer.sourceCrs)
    return {
      message: `${isolate(output.name)}: simplified ${simplified.length.toLocaleString()} lines (${countVertices(lines).toLocaleString()} → ${countVertices(simplified).toLocaleString()} vertices).`,
      layers: [output],
    }
  },
}
