import { getLayer, getOptionalText, outputLayer } from '../shared'
import { detach } from '../spatial'
import type { Feature, Geometry } from 'geojson'
import type { ToolboxTool } from '../types'
import { outputName, outputNameParameter } from './_utils'
import { selectFeatures } from './_where'

export const expressionParameter = {
  id: 'expression', label: 'Expression (SQL WHERE, e.g. POP > 1000 AND TYPE = \'A\')', kind: 'text' as const,
  placeholder: 'Empty = all features',
}

/** Select: copies the features that satisfy an attribute expression to a new layer. */
export const selectTool: ToolboxTool = {
  id: 'select',
  name: 'Select',
  category: 'Analysis',
  subcategory: 'Extract',
  description: 'Extract features matching an attribute (SQL) expression to a new layer.',
  keywords: ['query', 'where', 'attribute', 'filter', 'extract', 'sql', 'definition'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    expressionParameter,
    outputNameParameter('Select output'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const selected = selectFeatures(target, getOptionalText(parameters, 'expression'))
    if (!selected.length) throw new Error('No features match the expression.')
    const features = selected.map((feature) => feature.geometry ? detach(feature as Feature<Geometry>) : { ...feature, id: undefined })
    const output = outputLayer(outputName(parameters, `${target.name} Select`), { type: 'FeatureCollection', features: features as Feature<Geometry>[] }, target.sourceCrs)
    return {
      message: `${output.name}: ${selected.length.toLocaleString()} of ${target.data.features.length.toLocaleString()} features selected.`,
      layers: [output],
    }
  },
}
