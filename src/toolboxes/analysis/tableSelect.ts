import { isolate } from '../../bidi'
import { fieldNames, getLayer, getOptionalText } from '../shared'
import type { ToolboxTool } from '../types'
import { downloadParameter, outputName, outputNameParameter, tableResult } from './_utils'
import { selectFeatures } from './_where'
import { expressionParameter } from './select'

/** Table Select: like Select, but the output is an attribute table without geometry. */
export const tableSelectTool: ToolboxTool = {
  id: 'table-select',
  name: 'Table Select',
  category: 'Analysis',
  subcategory: 'Extract',
  description: 'Extract the attribute rows matching a SQL expression to a new stand-alone table (no geometry).',
  keywords: ['query', 'where', 'attribute', 'table', 'rows', 'extract', 'sql'],
  parameters: [
    { id: 'target', label: 'Input table / layer', kind: 'layer', required: true },
    expressionParameter,
    downloadParameter,
    outputNameParameter('Table select output'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const selected = selectFeatures(target, getOptionalText(parameters, 'expression'))
    if (!selected.length) throw new Error('No rows match the expression.')
    const { layer, downloads } = tableResult(
      parameters, outputName(parameters, `${target.name} TableSelect`),
      selected.map((feature) => ({ ...(feature.properties ?? {}) })), fieldNames(target),
    )
    return { message: `${isolate(layer.name)}: ${selected.length.toLocaleString()} rows selected.`, layers: [layer], downloads }
  },
}
