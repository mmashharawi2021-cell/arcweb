import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayer, outputLayer } from '../shared'
import {
  assertHasFeatures, collectFields, fillSchema, isPolygon, makeSpatialIndex, pairBudget, renameCollidingFields, renameProperties,
  usableFeatures, type PolygonFeature,
} from '../spatial'
import type { ToolboxTool } from '../types'
import { intersectPolygons, outputName, outputNameParameter, overlayGeometry } from './_utils'

const FID_INPUT = 'FID_INPUT'
const FID_INTERSECT = 'FID_INTERSECT'

const allPolygons = (features: Feature<Geometry>[]): features is PolygonFeature[] => features.length > 0 && features.every(isPolygon)

/**
 * Intersect: the geometric intersection of two layers. At least one layer must be
 * polygons; the output has the lower dimension (points/lines/polygons of the other layer
 * that fall inside the polygons) and carries the attributes of both inputs.
 */
export const intersectTool: ToolboxTool = {
  id: 'intersect',
  name: 'Intersect',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Compute the geometric intersection of two layers; overlapping portions carry the attributes of both.',
  keywords: ['overlap', 'overlay', 'polygon', 'common area', 'and'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'overlay', label: 'Intersect features', kind: 'layer', required: true },
    outputNameParameter('Intersect output'),
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const overlayLayer = getLayer(context, parameters, 'overlay')
    if (inputLayer.id === overlayLayer.id) throw new Error('Choose two different layers to intersect.')
    const inputFeatures = usableFeatures(inputLayer)
    const overlayFeatures = usableFeatures(overlayLayer)
    assertHasFeatures(inputFeatures, 'The input layer has no usable geometries.')
    assertHasFeatures(overlayFeatures, 'The intersect layer has no usable geometries.')

    // The polygon layer acts as the cutter; the other layer decides the output dimension.
    let subjects: Feature<Geometry>[]
    let cutters: PolygonFeature[]
    let swapped = false
    if (allPolygons(overlayFeatures)) {
      subjects = inputFeatures
      cutters = overlayFeatures
    } else if (allPolygons(inputFeatures)) {
      subjects = overlayFeatures
      cutters = inputFeatures
      swapped = true
    } else {
      throw new Error('Intersect needs at least one layer made only of polygons.')
    }

    const inputFields = collectFields(inputFeatures)
    const overlayMapping = renameCollidingFields([FID_INPUT, FID_INTERSECT, ...inputFields], collectFields(overlayFeatures))
    const numbers = (layer: MapLayer) => new Map(layer.data.features.map((feature, index) => [feature, index + 1]))
    const inputNumbers = numbers(inputLayer)
    const overlayNumbers = numbers(overlayLayer)
    const index = makeSpatialIndex(cutters)
    const spend = pairBudget('Intersect')
    const results: Feature<Geometry>[] = []

    for (const subject of subjects) {
      const candidates = index.search(subject)
      spend(candidates.length)
      for (const cutter of candidates) {
        const geometry = isPolygon(subject) ? intersectPolygons(subject, cutter) : overlayGeometry(subject, [cutter], 'inside')
        if (!geometry) continue
        const [inputFeature, overlayFeature] = swapped ? [cutter, subject] : [subject, cutter]
        results.push({
          type: 'Feature',
          geometry,
          properties: {
            [FID_INPUT]: inputNumbers.get(inputFeature) ?? -1,
            ...(inputFeature.properties ?? {}),
            [FID_INTERSECT]: overlayNumbers.get(overlayFeature) ?? -1,
            ...renameProperties(overlayFeature.properties, overlayMapping),
          },
        })
      }
    }
    assertHasFeatures(results, 'The layers do not intersect.')
    const fields = [FID_INPUT, ...inputFields, FID_INTERSECT, ...overlayMapping.values()]
    const output = outputLayer(outputName(parameters, `${inputLayer.name} Intersect`), featureCollection(fillSchema(results, fields)), inputLayer.sourceCrs)
    return { message: `${isolate(output.name)}: ${results.length.toLocaleString()} intersecting features.`, layers: [output] }
  },
}
