import booleanIntersects from '@turf/boolean-intersects'
import { polygon } from '@turf/helpers'
import { geometryBounds } from '../mapRendering'
import { useArcWebStore, type FeatureId, type MapLayer, type SelectionMethod } from '../store'

/** West, south, east, north in degrees. */
export type BoundingBox = [number, number, number, number]

/**
 * Features of visible layers that intersect a geographic box, by layer id. Each feature's
 * extent is checked first: disjoint extents are skipped and extents inside the box are taken
 * without the exact (and much slower) geometry test.
 */
export function featuresInBox(layers: MapLayer[], [west, south, east, north]: BoundingBox): Record<string, FeatureId[]> {
  const box = polygon([[[west, south], [east, south], [east, north], [west, north], [west, south]]])
  const result: Record<string, FeatureId[]> = {}
  for (const layer of layers) {
    if (!layer.visible || layer.geometry === 'Unknown') continue
    const ids: FeatureId[] = []
    for (const feature of layer.data.features) {
      if (!feature.geometry || feature.id === undefined) continue
      const bounds = geometryBounds(feature.geometry)
      if (!bounds) continue
      if (bounds[2] < west || bounds[0] > east || bounds[3] < south || bounds[1] > north) continue
      const inside = bounds[0] >= west && bounds[2] <= east && bounds[1] >= south && bounds[3] <= north
      if (inside || booleanIntersects(feature, box)) ids.push(feature.id as FeatureId)
    }
    if (ids.length) result[layer.id] = ids
  }
  return result
}

/** Applies box-selection hits. A new selection replaces the selection in every layer. */
export function applyBoxSelection(hits: Record<string, FeatureId[]>, method: Extract<SelectionMethod, 'new' | 'add' | 'remove'>): void {
  const state = useArcWebStore.getState()
  if (method === 'new') state.clearSelection()
  for (const [layerId, ids] of Object.entries(hits)) state.setSelection(layerId, ids, method)
}
