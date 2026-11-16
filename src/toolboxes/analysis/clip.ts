import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import { getLayer, outputLayer } from '../shared'
import { assertHasFeatures, detach, isPolygon, makeSpatialIndex, pairBudget, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { outputName, outputNameParameter, overlayGeometry } from './_utils'

/**
 * Clip: cuts the input features (points, lines or polygons) to the area of the clip
 * polygons. Output keeps the input attributes only, as in ArcGIS.
 */
export const clipTool: ToolboxTool = {
  id: 'clip',
  name: 'Clip',
  category: 'Analysis',
  subcategory: 'Extract',
  description: 'Extract the portions of input features that fall inside the clip polygons (cookie cutter).',
  keywords: ['cut', 'boundary', 'extract', 'cookie cutter', 'overlay'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'overlay', label: 'Clip features (polygons)', kind: 'layer', required: true },
    outputNameParameter('Clip output'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const clipLayer = getLayer(context, parameters, 'overlay')
    if (target.id === clipLayer.id) throw new Error('Choose a different clip layer; clipping a layer with itself changes nothing.')
    const clippers = clipLayer.data.features.filter(isPolygon)
    assertHasFeatures(clippers, 'The clip layer must contain polygon features.')
    const index = makeSpatialIndex(clippers)
    const spend = pairBudget('Clip')
    const results: Feature<Geometry>[] = []

    for (const feature of usableFeatures(target)) {
      const candidates = index.search(feature)
      spend(candidates.length)
      if (!candidates.length) continue
      const geometry = overlayGeometry(feature, candidates, 'inside')
      if (geometry) results.push({ ...detach(feature), geometry })
    }
    assertHasFeatures(results, 'The input and clip layers do not overlap.')
    const output = outputLayer(outputName(parameters, `${target.name} Clip`), featureCollection(results), target.sourceCrs)
    return { message: `${isolate(output.name)}: ${results.length.toLocaleString()} features clipped.`, layers: [output] }
  },
}
