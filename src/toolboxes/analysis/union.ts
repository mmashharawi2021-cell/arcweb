import { isolate } from '../../bidi'
import difference from '@turf/difference'
import { featureCollection } from '@turf/helpers'
import intersect from '@turf/intersect'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import {
  assertHasFeatures, collectFields, fillSchema, isPolygon, makeSpatialIndex, pairBudget, renameCollidingFields,
  renameProperties, type PolygonFeature,
} from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPolygonGeometry } from './_utils'

const FID_INPUT = 'FID_INPUT'
const FID_UNION = 'FID_UNION'

/**
 * Union (ArcGIS overlay semantics): the output contains every piece of both polygon
 * layers. Overlapping pieces carry the attributes of both inputs; pieces covered by
 * only one layer carry that layer's attributes and -1 for the other layer's FID.
 */
export const unionTool: ToolboxTool = {
  id: 'union',
  name: 'Union',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Overlay two polygon layers and keep all areas from both, with the attributes of each input.',
  keywords: ['overlay', 'combine', 'polygon', 'merge areas'],
  parameters: [
    { id: 'target', label: 'Input layer (polygons)', kind: 'layer', required: true },
    { id: 'overlay', label: 'Union layer (polygons)', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Union output' },
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const unionLayer = getLayer(context, parameters, 'overlay')
    if (inputLayer.id === unionLayer.id) throw new Error('Choose two different polygon layers to union.')
    const left = inputLayer.data.features.filter(isPolygon)
    const right = unionLayer.data.features.filter(isPolygon)
    assertHasFeatures(left, 'Union requires polygon features in the input layer.')
    assertHasFeatures(right, 'Union requires polygon features in the union layer.')

    const leftFields = collectFields(left)
    const rightMapping = renameCollidingFields([FID_INPUT, FID_UNION, ...leftFields], collectFields(right))
    const rightNumbers = new Map(right.map((feature, index) => [feature, index + 1]))
    const rightIndex = makeSpatialIndex(right)
    const leftIndex = makeSpatialIndex(left)
    const spend = pairBudget('Union')
    const pieces: Feature<Polygon | MultiPolygon>[] = []
    const rightProperties = (feature: PolygonFeature) => renameProperties(feature.properties, rightMapping)

    left.forEach((leftFeature, leftPosition) => {
      const candidates = rightIndex.search(leftFeature)
      spend(candidates.length)
      for (const rightFeature of candidates) {
        const shared = cleanPolygonGeometry(intersect(featureCollection([leftFeature, rightFeature]))?.geometry)
        if (!shared) continue
        pieces.push({
          type: 'Feature',
          geometry: shared,
          properties: {
            [FID_INPUT]: leftPosition + 1,
            [FID_UNION]: rightNumbers.get(rightFeature) ?? -1,
            ...(leftFeature.properties ?? {}),
            ...rightProperties(rightFeature),
          },
        })
      }
      const onlyLeft = cleanPolygonGeometry(candidates.length ? difference(featureCollection([leftFeature, ...candidates]))?.geometry : leftFeature.geometry)
      if (onlyLeft) {
        pieces.push({
          type: 'Feature',
          geometry: onlyLeft,
          properties: { [FID_INPUT]: leftPosition + 1, [FID_UNION]: -1, ...(leftFeature.properties ?? {}) },
        })
      }
    })

    right.forEach((rightFeature, rightPosition) => {
      const candidates = leftIndex.search(rightFeature)
      spend(candidates.length)
      const onlyRight = cleanPolygonGeometry(candidates.length ? difference(featureCollection([rightFeature, ...candidates]))?.geometry : rightFeature.geometry)
      if (onlyRight) {
        pieces.push({
          type: 'Feature',
          geometry: onlyRight,
          properties: { [FID_INPUT]: -1, [FID_UNION]: rightPosition + 1, ...rightProperties(rightFeature) },
        })
      }
    })

    assertHasFeatures(pieces, 'Union could not produce any polygon features.')
    const fields = [FID_INPUT, FID_UNION, ...leftFields, ...rightMapping.values()]
    const output = outputLayer(
      getOptionalText(parameters, 'outputName') || `${inputLayer.name} Union`,
      featureCollection(fillSchema(pieces, fields)),
    )
    return { message: `${isolate(output.name)}: created ${pieces.length.toLocaleString()} polygon pieces from both layers.`, layers: [output] }
  },
}
