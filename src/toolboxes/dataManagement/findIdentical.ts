import type { Feature } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { identicalGroups, identicalParameters } from './_identical'
import { outputNameParameter, tableRow, yesNoParameter } from './_utils'

/** Find Identical: a table (IN_FID, FEAT_SEQ) where records sharing FEAT_SEQ are identical in the compared fields. */
export const findIdenticalTool: ToolboxTool = {
  id: 'find-identical',
  name: 'Find Identical',
  category: 'Data Management',
  subcategory: 'General',
  description: 'List records that have identical values in the chosen fields and/or identical geometry (Shape) as a table with IN_FID and FEAT_SEQ.',
  keywords: ['duplicates', 'duplicate', 'same', 'equal', 'repeated', 'qa'],
  parameters: [
    ...identicalParameters,
    yesNoParameter('onlyDuplicates', 'Output only duplicated records', 'yes', 'Yes — only records with duplicates', 'No — every record'),
    outputNameParameter('Identical table'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const { groups, compared } = identicalGroups(layer, parameters)
    const onlyDuplicates = getOptionalText(parameters, 'onlyDuplicates') !== 'no'
    const rows: { inFid: number; sequence: number }[] = []
    let sequence = 0
    for (const group of groups) {
      if (onlyDuplicates && group.length < 2) continue
      sequence += 1
      for (const index of group) rows.push({ inFid: index + 1, sequence })
    }
    const duplicateSets = groups.filter((group) => group.length > 1).length
    if (!rows.length) return { message: `${layer.name}: no identical records found comparing ${compared.join(', ')}.` }
    rows.sort((a, b) => a.inFid - b.inFid)
    const features: Feature[] = rows.map((row) => tableRow({ IN_FID: row.inFid, FEAT_SEQ: row.sequence }))
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Identical`, { type: 'FeatureCollection', features })
    return {
      message: `${output.name}: ${duplicateSets.toLocaleString()} sets of identical records (${compared.join(', ')}).`,
      layers: [output],
    }
  },
}
