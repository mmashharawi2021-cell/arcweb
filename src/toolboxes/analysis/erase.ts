import { isolate } from '../../bidi'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import difference from '@turf/difference'
import { featureCollection, point } from '@turf/helpers'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import {
  assertHasFeatures, detach, isLine, isPolygon, makeSpatialIndex, pairBudget, splitLineByPolygons, usableFeatures,
} from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPolygonGeometry } from './_utils'

/** Erase: removes the parts of the input features that fall inside the erase polygons. */
export const eraseTool: ToolboxTool = {
  id: 'erase',
  name: 'Erase',
  category: 'Analysis',
  subcategory: 'Overlay',
  description: 'Remove the portions of input features that overlap the erase polygons (geometric difference).',
  keywords: ['difference', 'subtract', 'remove', 'cut out', 'overlay'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'erase', label: 'Erase layer (polygons)', kind: 'layer', required: true },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Erase output' },
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const eraseLayer = getLayer(context, parameters, 'erase')
    if (target.id === eraseLayer.id) throw new Error('Choose a different layer to erase with; erasing a layer with itself leaves nothing.')
    const erasers = eraseLayer.data.features.filter(isPolygon)
    assertHasFeatures(erasers, 'The erase layer must contain polygon features.')
    const index = makeSpatialIndex(erasers)
    const spend = pairBudget('Erase')
    const results: Feature<Geometry>[] = []

    for (const feature of usableFeatures(target)) {
      const candidates = index.search(feature)
      spend(candidates.length)
      if (!candidates.length) {
        results.push(detach(feature))
      } else if (feature.geometry.type === 'Point') {
        const location = point(feature.geometry.coordinates)
        if (!candidates.some((eraser) => booleanPointInPolygon(location, eraser))) results.push(detach(feature))
      } else if (feature.geometry.type === 'MultiPoint') {
        const coordinates = feature.geometry.coordinates.filter((coordinate) =>
          !candidates.some((eraser) => booleanPointInPolygon(point(coordinate), eraser)))
        if (coordinates.length) results.push({ ...detach(feature), geometry: { type: 'MultiPoint', coordinates } })
      } else if (isLine(feature)) {
        // Re-join consecutive surviving pieces so a line is only broken where it was actually erased.
        const paths: Position[][] = []
        for (const part of splitLineByPolygons(feature, candidates)) {
          if (part.inside) continue
          const coordinates = part.segment.geometry.coordinates
          const previous = paths[paths.length - 1]
          const end = previous?.[previous.length - 1]
          if (end && end[0] === coordinates[0][0] && end[1] === coordinates[0][1]) previous.push(...coordinates.slice(1))
          else paths.push([...coordinates])
        }
        if (paths.length === 1) {
          results.push({ ...detach(feature), geometry: { type: 'LineString', coordinates: paths[0] } })
        } else if (paths.length) {
          results.push({ ...detach(feature), geometry: { type: 'MultiLineString', coordinates: paths } })
        }
      } else if (isPolygon(feature)) {
        const remaining = cleanPolygonGeometry(difference(featureCollection([feature, ...candidates]))?.geometry)
        if (remaining) results.push({ ...detach(feature), geometry: remaining })
      }
    }
    assertHasFeatures(results, 'The erase layer covers every input feature; nothing is left to output.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${target.name} Erase`, featureCollection(results))
    const removed = usableFeatures(target).length - results.length
    return {
      message: `${isolate(output.name)}: kept ${results.length.toLocaleString()} features${removed > 0 ? `, ${removed.toLocaleString()} fully erased` : ''}.`,
      layers: [output],
    }
  },
}
