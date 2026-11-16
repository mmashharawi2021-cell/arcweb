import { isolate } from '../../bidi'
import booleanIntersects from '@turf/boolean-intersects'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import {
  assertHasFeatures, collectFields, featureContains, fillSchema, makeSpatialIndex, pairBudget, renameCollidingFields, renameProperties,
  usableFeatures,
} from '../spatial'
import type { ToolboxTool } from '../types'

type MatchOption = 'intersects' | 'within' | 'contains'

const JOIN_COUNT = 'Join_Count'
const TARGET_FID = 'TARGET_FID'
const JOIN_FID = 'JOIN_FID'

function matches(option: MatchOption, target: Feature<Geometry>, join: Feature<Geometry>): boolean {
  if (option === 'within') return featureContains(join, target)
  if (option === 'contains') return featureContains(target, join)
  return booleanIntersects(target, join)
}

/**
 * Spatial Join: appends the attributes of join features to the target features they
 * relate to spatially, with ArcGIS-style Join_Count / TARGET_FID bookkeeping fields.
 */
export const spatialJoinTool: ToolboxTool = {
  id: 'spatial-join',
  name: 'Spatial Join',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Join attributes from one layer to another based on spatial containment or intersection.',
  keywords: ['join', 'attributes', 'intersects', 'within', 'contains', 'containment', 'overlay'],
  parameters: [
    { id: 'target', label: 'Target layer', kind: 'layer', required: true },
    { id: 'overlay', label: 'Join layer', kind: 'layer', required: true },
    {
      id: 'match', label: 'Match option', kind: 'select', required: true, defaultValue: 'intersects',
      options: [
        { value: 'intersects', label: 'Intersect — target touches or overlaps join feature' },
        { value: 'within', label: 'Within — target is completely inside join feature' },
        { value: 'contains', label: 'Contains — target completely contains join feature' },
      ],
    },
    {
      id: 'operation', label: 'Join operation', kind: 'select', required: true, defaultValue: 'one-to-one',
      options: [
        { value: 'one-to-one', label: 'Join one to one (first match + Join_Count)' },
        { value: 'one-to-many', label: 'Join one to many (one row per match)' },
      ],
    },
    {
      id: 'keepAll', label: 'Keep all target features', kind: 'select', defaultValue: 'yes',
      options: [
        { value: 'yes', label: 'Yes — keep unmatched targets with empty join fields' },
        { value: 'no', label: 'No — only output targets that have a match' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Spatial join output' },
  ],
  execute: (context, parameters) => {
    const targetLayer = getLayer(context, parameters, 'target')
    const joinLayer = getLayer(context, parameters, 'overlay')
    const option = (getOptionalText(parameters, 'match') || 'intersects') as MatchOption
    const oneToMany = getOptionalText(parameters, 'operation') === 'one-to-many'
    const keepAll = getOptionalText(parameters, 'keepAll') !== 'no'

    const targets = usableFeatures(targetLayer)
    const joins = usableFeatures(joinLayer)
    assertHasFeatures(targets, 'The target layer has no usable geometries.')
    assertHasFeatures(joins, 'The join layer has no usable geometries.')

    const targetFields = collectFields(targets)
    const bookkeeping = oneToMany ? [JOIN_COUNT, TARGET_FID, JOIN_FID] : [JOIN_COUNT, TARGET_FID]
    const joinMapping = renameCollidingFields([...bookkeeping, ...targetFields], collectFields(joins))
    const joinNumbers = new Map(joins.map((feature, index) => [feature, index + 1]))
    const index = makeSpatialIndex(joins)
    const spend = pairBudget('Spatial Join')
    const results: Feature<Geometry>[] = []
    let matchedTargets = 0

    targets.forEach((target, position) => {
      const candidates = index.search(target)
      spend(candidates.length)
      const found = candidates.filter((join) => matches(option, target, join))
      if (found.length) matchedTargets += 1
      if (!found.length && !keepAll) return
      const base = { [JOIN_COUNT]: found.length, [TARGET_FID]: position + 1 }
      const rows = oneToMany && found.length ? found : [found[0]]
      for (const join of rows) {
        results.push({
          type: 'Feature',
          geometry: target.geometry,
          properties: {
            ...base,
            ...(oneToMany ? { [JOIN_FID]: join ? joinNumbers.get(join) ?? -1 : -1 } : {}),
            ...(target.properties ?? {}),
            ...(join ? renameProperties(join.properties, joinMapping) : {}),
          },
        })
      }
    })

    assertHasFeatures(results, 'No target features satisfy the selected match option.')
    const fields = [...bookkeeping, ...targetFields, ...joinMapping.values()]
    const output = outputLayer(
      getOptionalText(parameters, 'outputName') || `${targetLayer.name} SpatialJoin`,
      featureCollection(fillSchema(results, fields)),
    )
    return {
      message: `${isolate(output.name)}: ${matchedTargets.toLocaleString()} of ${targets.length.toLocaleString()} target features matched; wrote ${results.length.toLocaleString()} rows.`,
      kind: matchedTargets ? 'success' : 'warning',
      layers: [output],
    }
  },
}
