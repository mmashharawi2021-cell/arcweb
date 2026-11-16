import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Point } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPoint, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { outputNameParameter } from '../dataManagement/_utils'
import { enforceNominatimRequestLimit, reverseGeocodePosition } from './nominatim'

/** Resolves point coordinates to address details through public Nominatim. */
export const reverseGeocodeTool: ToolboxTool = {
  id: 'reverse-geocode',
  name: 'Reverse Geocode',
  category: 'Geocoding',
  description: 'Send point coordinates to the configured public Nominatim service on explicit execution and add returned address details to local point features. Requests are sequential and rate-limited to one per second.',
  keywords: ['reverse geocode', 'address', 'coordinates', 'nominatim', 'openstreetmap'],
  parameters: [
    { id: 'target', label: 'Input point layer', kind: 'layer', required: true },
    outputNameParameter('Reverse geocoded points'),
  ],
  execute: async (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const points = usableFeatures(layer).filter(isPoint) as Feature<Point>[]
    assertHasFeatures(points, 'Reverse Geocode needs a point layer.')
    enforceNominatimRequestLimit(points.length)
    context.onProgress?.({
      current: 0,
      total: points.length,
      message: `Starting reverse geocoding of ${points.length} point records with public Nominatim.`,
    })
    const outputPoints: Feature<Point>[] = []
    let unmatched = 0
    for (let index = 0; index < points.length; index += 1) {
      const feature = points[index]
      const coordinates = feature.geometry.coordinates
      const [longitude, latitude] = coordinates
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error(`Point ${index + 1} is outside valid WGS 84 longitude/latitude bounds.`)
      }
      const details = await reverseGeocodePosition(longitude, latitude)
      if (details) outputPoints.push({ ...feature, properties: { ...(feature.properties ?? {}), ...details } })
      else unmatched += 1
      context.onProgress?.({
        current: index + 1,
        total: points.length,
        message: `Processed ${index + 1} of ${points.length} point records.`,
      })
    }
    if (!outputPoints.length) throw new Error(`Nominatim returned no address matches for ${points.length} points.`)
    const name = getOptionalText(parameters, 'outputName') || `${layer.name} Reverse Geocoded`
    const output = outputLayer(name, featureCollection(outputPoints), layer.sourceCrs)
    return {
      message: `${isolate(name)}: reverse geocoded ${outputPoints.length} of ${points.length} points${unmatched ? ` (${unmatched} unmatched)` : ''}. Point coordinates were sent to the public Nominatim service; results are © OpenStreetMap contributors.`,
      layers: [output],
    }
  },
}
