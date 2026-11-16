import { featureCollection } from '@turf/helpers'
import type { Feature, Point } from 'geojson'
import { fieldNames, getLayer, getOptionalText, getText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { outputNameParameter } from '../dataManagement/_utils'
import { enforceNominatimRequestLimit, geocodeAddress } from './nominatim'

/** Converts address text to WGS 84 point features using the public Nominatim service. */
export const geocodeAddressesTool: ToolboxTool = {
  id: 'geocode-addresses',
  name: 'Geocode Addresses',
  category: 'Geocoding',
  description: 'Send the selected address text to the configured public Nominatim service on explicit execution and create local WGS 84 points. Requests are sequential and rate-limited to one per second.',
  keywords: ['address', 'geocode', 'nominatim', 'location', 'openstreetmap'],
  parameters: [
    { id: 'target', label: 'Input address table/layer', kind: 'layer', required: true },
    { id: 'field', label: 'Address text field', kind: 'field', layerParameter: 'target', required: true },
    outputNameParameter('Geocoded addresses'),
  ],
  execute: async (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const field = getText(parameters, 'field', 'an address field')
    if (!fieldNames(layer).includes(field)) throw new Error(`Field "${field}" does not exist on ${layer.name}.`)
    const rows = layer.data.features.flatMap((feature) => {
      const address = feature.properties?.[field]
      return typeof address === 'string' && address.trim() ? [{ feature, address: address.trim() }] : []
    })
    if (!rows.length) throw new Error(`Field "${field}" has no non-empty address text.`)
    enforceNominatimRequestLimit(rows.length)
    context.onProgress?.({
      current: 0,
      total: rows.length,
      message: `Starting geocoding of ${rows.length} address records with public Nominatim.`,
    })
    const points: Feature<Point>[] = []
    let unmatched = 0
    for (let index = 0; index < rows.length; index += 1) {
      const { feature, address } = rows[index]
      const geocoded = await geocodeAddress(address)
      if (geocoded) {
        points.push({
          ...geocoded,
          properties: { ...(feature.properties ?? {}), ...geocoded.properties, [field]: address },
        })
      } else {
        unmatched += 1
      }
      context.onProgress?.({
        current: index + 1,
        total: rows.length,
        message: `Processed ${index + 1} of ${rows.length} address records.`,
      })
    }
    if (!points.length) throw new Error(`Nominatim returned no matches for ${rows.length} address records.`)
    const name = getOptionalText(parameters, 'outputName') || `${layer.name} Geocoded`
    const output = outputLayer(name, featureCollection(points))
    return {
      message: `${name}: geocoded ${points.length} of ${rows.length} addresses${unmatched ? ` (${unmatched} unmatched)` : ''}. Address text was sent to the public Nominatim service; results are © OpenStreetMap contributors.`,
      layers: [output],
    }
  },
}
