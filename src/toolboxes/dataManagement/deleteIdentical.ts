import { isolate } from '../../bidi'
import { getLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { identicalGroups, identicalParameters } from './_identical'

/** Delete Identical: removes all but the first of each set of identical records from the input layer. */
export const deleteIdenticalTool: ToolboxTool = {
  id: 'delete-identical',
  name: 'Delete Identical',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Delete records that are identical in the chosen fields and/or geometry (Shape), keeping the first of each set.',
  keywords: ['duplicates', 'remove duplicates', 'dedupe', 'unique', 'clean'],
  parameters: identicalParameters,
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const { groups, compared } = identicalGroups(layer, parameters)
    const doomed = new Set(groups.flatMap((group) => group.slice(1)))
    if (!doomed.size) return { message: `${isolate(layer.name)}: no identical records found comparing ${compared.map((field) => field === 'Shape' ? field : isolate(field)).join(', ')}.` }
    const features = layer.data.features.filter((_, index) => !doomed.has(index))
    return {
      message: `${isolate(layer.name)}: deleted ${doomed.size.toLocaleString()} identical records (${compared.map((field) => field === 'Shape' ? field : isolate(field)).join(', ')}); ${features.length.toLocaleString()} remain.`,
      updates: [{ layerId: layer.id, updates: { data: { ...layer.data, features } } }],
    }
  },
}
