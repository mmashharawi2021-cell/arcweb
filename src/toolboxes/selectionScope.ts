import type { Feature, FeatureCollection } from 'geojson'
import type { FeatureId, MapLayer } from '../store'

/**
 * ArcGIS tools honour selections: with features selected, a tool processes only those features.
 * These helpers give a tool a view of each layer limited to its selection set, then fold any
 * in-place edits the tool made back into the full layer so unselected features are never lost.
 */

export interface ScopedLayers {
  layers: MapLayer[]
  /** Layer id → the subset handed to the tool, for layers that were limited to a selection. */
  scoped: Map<string, FeatureCollection>
}

export function selectedFeatureCount(layers: MapLayer[], selections: Record<string, FeatureId[]>): number {
  return layers.reduce((sum, layer) => sum + (selections[layer.id]?.length ?? 0), 0)
}

export function scopeLayersToSelection(layers: MapLayer[], selections: Record<string, FeatureId[]>): ScopedLayers {
  const scoped = new Map<string, FeatureCollection>()
  const result = layers.map((layer) => {
    const ids = selections[layer.id]
    if (!ids?.length) return layer
    const wanted = new Set<FeatureId>(ids)
    const data: FeatureCollection = { ...layer.data, features: layer.data.features.filter((feature) => feature.id !== undefined && wanted.has(feature.id)) }
    scoped.set(layer.id, data)
    return { ...layer, data }
  })
  return { layers: result, scoped }
}

/**
 * Merges a tool's output for a selection subset back into the full layer:
 * features of the subset are replaced by their updated versions (or dropped if the tool removed
 * them), features outside the subset are kept in place, and features the tool added are appended.
 * Tools that rebuild features without IDs are matched by position, which requires the same count.
 */
export function mergeScopedData(full: FeatureCollection, subset: FeatureCollection, updated: FeatureCollection): FeatureCollection {
  const subsetIds = new Set(subset.features.map((feature) => feature.id))
  let replacements: Map<FeatureId, Feature>
  let added: Feature[]
  if (updated.features.every((feature) => feature.id !== undefined)) {
    replacements = new Map(updated.features.filter((feature) => subsetIds.has(feature.id)).map((feature) => [feature.id as FeatureId, feature]))
    added = updated.features.filter((feature) => !subsetIds.has(feature.id))
  } else if (updated.features.length === subset.features.length) {
    replacements = new Map(subset.features.map((feature, index) => [feature.id as FeatureId, { ...updated.features[index], id: feature.id }]))
    added = []
  } else {
    throw new Error('The tool changed the number of features without keeping their IDs, so its result cannot be merged into the selection. Clear the selection and run it on the whole layer.')
  }
  const features: Feature[] = []
  for (const feature of full.features) {
    if (feature.id === undefined || !subsetIds.has(feature.id)) features.push(feature)
    else if (replacements.has(feature.id)) features.push(replacements.get(feature.id)!)
  }
  return { ...full, features: [...features, ...added] }
}
