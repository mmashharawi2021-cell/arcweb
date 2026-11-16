import type { Feature } from 'geojson'
import { featureCollection } from '@turf/helpers'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPolygon, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import {
  bufferGeometry, cleanPolygonGeometry, compareValues, distanceUnitParameter, outputName, outputNameParameter, polygonFeature,
  resolveField, unionPolygons, unitFactor, type PolygonGeometry, type Row,
} from './_utils'

const BUFF_DIST = 'BUFF_DIST'

/**
 * Buffer: geodesic distance zones around features. Negative distances shrink polygons.
 * Dissolve NONE keeps one buffer per feature, ALL merges every buffer into one feature,
 * LIST merges buffers sharing the value of the dissolve field.
 */
export const bufferTool: ToolboxTool = {
  id: 'buffer',
  name: 'Buffer',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Create buffer polygons at a distance around input features, optionally dissolving overlapping buffers.',
  keywords: ['distance', 'proximity', 'zone', 'radius', 'dissolve'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'distance', label: 'Distance (negative shrinks polygons)', kind: 'number', required: true, defaultValue: 500, step: 1 },
    distanceUnitParameter,
    {
      id: 'dissolve', label: 'Dissolve type', kind: 'select', defaultValue: 'NONE',
      options: [
        { value: 'NONE', label: 'No dissolve — one buffer per feature' },
        { value: 'ALL', label: 'Dissolve all into a single feature' },
        { value: 'LIST', label: 'Dissolve by field' },
      ],
    },
    { id: 'dissolveField', label: 'Dissolve field (for "Dissolve by field")', kind: 'field', layerParameter: 'target', allowEmpty: true },
    outputNameParameter('Buffer output'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const meters = getNumber(parameters, 'distance', 'buffer distance') * unitFactor(parameters)
    if (meters === 0) throw new Error('The buffer distance cannot be zero.')
    const dissolve = getOptionalText(parameters, 'dissolve') || 'NONE'
    const dissolveField = dissolve === 'LIST' ? getOptionalText(parameters, 'dissolveField') : ''
    if (dissolve === 'LIST' && !dissolveField) throw new Error('Choose a dissolve field, or pick another dissolve type.')
    const field = dissolveField ? resolveField(target, dissolveField) : ''
    const features = usableFeatures(target)
    assertHasFeatures(features, 'The input layer has no usable geometries.')
    if (meters < 0 && !features.some(isPolygon)) throw new Error('A negative buffer distance only applies to polygon features.')

    const buffers: Feature<PolygonGeometry>[] = []
    for (const feature of features) {
      if (meters < 0 && !isPolygon(feature)) continue
      const geometry = bufferGeometry(feature, meters)
      if (geometry) buffers.push(polygonFeature(geometry, { ...(feature.properties ?? {}), [BUFF_DIST]: meters }))
    }
    assertHasFeatures(buffers, 'No valid buffer polygons could be created (a negative distance may have removed every polygon).')

    let results: Feature<PolygonGeometry>[] = buffers
    if (dissolve === 'ALL') {
      const merged = cleanPolygonGeometry(unionPolygons(buffers))
      results = merged ? [polygonFeature(merged, { [BUFF_DIST]: meters })] : []
    } else if (field) {
      const groups = new Map<unknown, Feature<PolygonGeometry>[]>()
      for (const item of buffers) {
        const key = item.properties?.[field] ?? null
        groups.set(key, [...(groups.get(key) ?? []), item])
      }
      results = [...groups.entries()].sort(([a], [b]) => compareValues(a, b)).flatMap(([key, group]) => {
        const merged = cleanPolygonGeometry(unionPolygons(group))
        const properties: Row = { [field]: key, [BUFF_DIST]: meters }
        return merged ? [polygonFeature(merged, properties)] : []
      })
    }
    assertHasFeatures(results, 'Dissolving the buffers produced no polygons.')
    const output = outputLayer(outputName(parameters, `${target.name} Buffer`), featureCollection(results), target.sourceCrs)
    return { message: `${output.name}: created ${results.length.toLocaleString()} buffer polygons.`, layers: [output] }
  },
}
