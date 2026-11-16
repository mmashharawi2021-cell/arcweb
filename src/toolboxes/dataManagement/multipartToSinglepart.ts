import { isolate } from '../../bidi'
import flatten from '@turf/flatten'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { fieldNames, getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, renameCollidingFields } from '../spatial'
import type { ToolboxTool } from '../types'
import { outputNameParameter } from './_utils'

/** Multipart To Singlepart: explodes multipart features into one feature per part, recording ORIG_FID. */
export const multipartToSinglepartTool: ToolboxTool = {
  id: 'multipart-to-singlepart',
  name: 'Multipart To Singlepart',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Split multipart features into separate single-part features. Each part keeps the attributes and an ORIG_FID pointing to its source feature.',
  keywords: ['explode', 'split', 'multipart', 'singlepart', 'flatten', 'parts'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    outputNameParameter('Singlepart features'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const origField = renameCollidingFields(fieldNames(layer), ['ORIG_FID']).get('ORIG_FID') ?? 'ORIG_FID'
    const parts: Feature<Geometry>[] = []
    let multipart = 0
    layer.data.features.forEach((feature, index) => {
      if (!feature.geometry) return
      const pieces = flatten(feature as Feature<Geometry>).features as Feature<Geometry>[]
      if (pieces.length > 1) multipart += 1
      for (const piece of pieces) {
        parts.push({ type: 'Feature', properties: { ...(feature.properties ?? {}), [origField]: index + 1 }, geometry: piece.geometry })
      }
    })
    assertHasFeatures(parts, 'The input layer has no features with geometry.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Singlepart`, featureCollection(parts), layer.sourceCrs)
    return {
      message: `${isolate(output.name)}: ${parts.length.toLocaleString()} single-part features (${multipart.toLocaleString()} multipart features exploded).`,
      layers: [output],
    }
  },
}
