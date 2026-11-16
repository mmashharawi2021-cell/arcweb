import type { Feature, Geometry } from 'geojson'
import { getLayer, getText, outputLayer } from '../shared'
import { assertHasFeatures, detach, isPolygon, makeSpatialIndex, pairBudget, usableFeatures, type PolygonFeature } from '../spatial'
import type { ToolboxTool } from '../types'
import { compareValues, overlayGeometry, resolveField } from './_utils'

const MAX_OUTPUTS = 200

/**
 * Split: clips the input features with each zone of a split polygon layer and writes one
 * output layer per distinct value of the split field (named after that value).
 */
export const splitTool: ToolboxTool = {
  id: 'split',
  name: 'Split',
  category: 'Analysis',
  subcategory: 'Extract',
  description: 'Split input features into several output layers, one per zone of the split polygons (keyed by a split field).',
  keywords: ['divide', 'partition', 'tiles', 'zones', 'clip', 'extract'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'split', label: 'Split features (polygons)', kind: 'layer', required: true },
    { id: 'splitField', label: 'Split field', kind: 'field', layerParameter: 'split', required: true },
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const splitLayer = getLayer(context, parameters, 'split')
    if (target.id === splitLayer.id) throw new Error('Choose a different split layer.')
    const field = resolveField(splitLayer, getText(parameters, 'splitField', 'a split field'))
    const zones = splitLayer.data.features.filter(isPolygon)
    assertHasFeatures(zones, 'The split layer must contain polygon features.')
    const zoneKey = (zone: PolygonFeature) => {
      const value = zone.properties?.[field]
      return value === null || value === undefined || value === '' ? '(empty)' : String(value)
    }
    const keys = [...new Set(zones.map(zoneKey))].sort(compareValues)
    if (keys.length > MAX_OUTPUTS) throw new Error(`The split field has ${keys.length} distinct values; at most ${MAX_OUTPUTS} output layers are allowed.`)

    const index = makeSpatialIndex(zones)
    const spend = pairBudget('Split')
    const outputs = new Map<string, Feature<Geometry>[]>(keys.map((key) => [key, []]))
    for (const feature of usableFeatures(target)) {
      const candidates = index.search(feature)
      spend(candidates.length)
      const groups = new Map<string, PolygonFeature[]>()
      for (const zone of candidates) groups.set(zoneKey(zone), [...(groups.get(zoneKey(zone)) ?? []), zone])
      for (const [key, group] of groups) {
        const geometry = overlayGeometry(feature, group, 'inside')
        if (geometry) outputs.get(key)?.push({ ...detach(feature), geometry })
      }
    }
    const layers = keys
      .filter((key) => outputs.get(key)?.length)
      .map((key) => outputLayer(`${target.name} ${key}`, { type: 'FeatureCollection', features: outputs.get(key) ?? [] }, target.sourceCrs))
    assertHasFeatures(layers, 'The input features do not overlap any split polygon.')
    return {
      message: `Split ${target.name} into ${layers.length.toLocaleString()} layers by ${field}: ${layers.map((layer) => `${layer.name} (${layer.data.features.length})`).join(', ')}.`,
      layers,
    }
  },
}
