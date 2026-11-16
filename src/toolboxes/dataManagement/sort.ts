import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { geometryBBox } from '../spatial'
import type { ToolboxTool } from '../types'
import { collectionBBox, compareValues, outputNameParameter } from './_utils'

const directionOptions = [{ value: 'ASCENDING', label: 'Ascending' }, { value: 'DESCENDING', label: 'Descending' }]

/** Index of (x, y) on a Hilbert curve of order 16 (x, y in 0..65535). */
export function hilbertIndex(x: number, y: number): number {
  const n = 1 << 16
  let d = 0
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0
    const ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y }
      [x, y] = [y, x]
    }
  }
  return d
}

/** Sort: writes a copy of the layer ordered by attribute values or spatially. */
export const sortTool: ToolboxTool = {
  id: 'sort',
  name: 'Sort',
  category: 'Data Management',
  subcategory: 'General',
  description: 'Reorder features by one or two fields (ascending or descending) or spatially (from a corner, or along a Peano/Hilbert curve) into a new layer.',
  keywords: ['order', 'order by', 'rank', 'arrange', 'spatial sort', 'peano', 'hilbert'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'field', label: 'Sort field', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'direction', label: 'Direction', kind: 'select', defaultValue: 'ASCENDING', options: directionOptions },
    { id: 'field2', label: 'Secondary sort field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'direction2', label: 'Secondary direction', kind: 'select', defaultValue: 'ASCENDING', options: directionOptions },
    {
      id: 'spatial', label: 'Spatial sort method', kind: 'select', defaultValue: 'NONE',
      options: [
        { value: 'NONE', label: 'None — sort by fields' },
        { value: 'UL', label: 'Upper left' },
        { value: 'UR', label: 'Upper right' },
        { value: 'LL', label: 'Lower left' },
        { value: 'LR', label: 'Lower right' },
        { value: 'PEANO', label: 'Peano (space-filling curve)' },
      ],
    },
    outputNameParameter('Sorted layer'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const keys = [
      { field: getOptionalText(parameters, 'field'), sign: getOptionalText(parameters, 'direction') === 'DESCENDING' ? -1 : 1 },
      { field: getOptionalText(parameters, 'field2'), sign: getOptionalText(parameters, 'direction2') === 'DESCENDING' ? -1 : 1 },
    ].filter((key) => key.field)
    const spatial = getOptionalText(parameters, 'spatial') || 'NONE'
    if (!keys.length && spatial === 'NONE') throw new Error('Choose a sort field or a spatial sort method.')
    if (!layer.data.features.length) throw new Error('The input layer has no features to sort.')

    const extent = collectionBBox(layer.data.features)
    const bands = Math.max(1, Math.round(Math.sqrt(layer.data.features.length)))
    const spatialKey = (feature: Feature): number => {
      if (!feature.geometry || !extent) return Infinity
      const box = geometryBBox(feature.geometry as Geometry)
      const x = (box[0] + box[2]) / 2
      const y = (box[1] + box[3]) / 2
      const width = extent[2] - extent[0] || 1
      const height = extent[3] - extent[1] || 1
      const nx = (x - extent[0]) / width
      const ny = (y - extent[1]) / height
      // Corner sorts scan rows (bands of the extent) starting from the chosen corner.
      const row = (value: number) => Math.min(bands - 1, Math.floor(value * bands)) * 2
      switch (spatial) {
        case 'UL': return row(1 - ny) + nx
        case 'UR': return row(1 - ny) + (1 - nx)
        case 'LL': return row(ny) + nx
        case 'LR': return row(ny) + (1 - nx)
        default: return hilbertIndex(Math.min(65535, Math.floor(nx * 65536)), Math.min(65535, Math.floor(ny * 65536)))
      }
    }
    const decorated = layer.data.features.map((feature, index) => ({ feature, index, spatial: spatial === 'NONE' ? 0 : spatialKey(feature) }))
    decorated.sort((a, b) => {
      for (const { field, sign } of keys) {
        const order = compareValues(a.feature.properties?.[field], b.feature.properties?.[field])
        // Nulls stay last regardless of direction.
        const aEmpty = a.feature.properties?.[field] == null || a.feature.properties?.[field] === ''
        const bEmpty = b.feature.properties?.[field] == null || b.feature.properties?.[field] === ''
        if (order !== 0) return aEmpty || bEmpty ? order : order * sign
      }
      return a.spatial - b.spatial || a.index - b.index
    })
    const features = decorated.map(({ feature }) => ({ type: 'Feature' as const, properties: { ...(feature.properties ?? {}) }, geometry: feature.geometry }))
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Sort`, featureCollection(features), layer.sourceCrs)
    const description = [...keys.map(({ field, sign }) => `${field} ${sign < 0 ? 'descending' : 'ascending'}`), ...(spatial !== 'NONE' ? [`spatial ${spatial}`] : [])]
    return { message: `${output.name}: sorted ${features.length.toLocaleString()} features by ${description.join(', ')}.`, layers: [output] }
  },
}
