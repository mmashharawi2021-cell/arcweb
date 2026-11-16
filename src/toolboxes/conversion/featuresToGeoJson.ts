import truncate from '@turf/truncate'
import type { Feature, FeatureCollection } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayer, getNumber, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { exportableFeatures, safeName } from './_utils'

/** RFC 7946 GeoJSON (always WGS 84), optionally rounded to `precision` decimal places. */
export function buildGeoJson(layer: MapLayer, options: { precision?: number; pretty?: boolean; fileName?: string } = {}): ToolDownload {
  let features: Feature[] = exportableFeatures(layer)
  if (options.precision !== undefined) {
    features = features.map((feature) => feature.geometry
      ? { ...feature, geometry: truncate(feature.geometry, { precision: options.precision, coordinates: 3 }) }
      : feature)
  }
  const data: FeatureCollection = { type: 'FeatureCollection', features }
  return {
    fileName: `${safeName(options.fileName || layer.name)}.geojson`,
    blob: new Blob([JSON.stringify(data, null, options.pretty === false ? undefined : 2)], { type: 'application/geo+json;charset=utf-8' }),
  }
}

export const featuresToGeoJsonTool: ToolboxTool = {
  id: 'features-to-geojson',
  name: 'Features To GeoJSON',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export a layer to an RFC 7946 GeoJSON file in WGS 84 with all attributes.',
  keywords: ['geojson', 'json', 'export', 'download', 'save', 'rfc 7946'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'precision', label: 'Coordinate decimal places (0 = keep full precision)', kind: 'number', defaultValue: 0, min: 0, max: 15, step: 1 },
    {
      id: 'format', label: 'Formatting', kind: 'select', defaultValue: 'pretty',
      options: [{ value: 'pretty', label: 'Indented (readable)' }, { value: 'compact', label: 'Compact (smaller file)' }],
    },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Layer name' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const precision = parameters.precision === undefined || parameters.precision === '' ? 0 : Math.round(getNumber(parameters, 'precision', 'number of decimal places'))
    if (precision < 0 || precision > 15) throw new Error('Decimal places must be between 0 and 15.')
    const download = buildGeoJson(layer, {
      precision: precision > 0 ? precision : undefined,
      pretty: getOptionalText(parameters, 'format') !== 'compact',
      fileName: getOptionalText(parameters, 'fileName'),
    })
    return { message: `Prepared ${download.fileName} (${layer.data.features.length.toLocaleString()} features).`, downloads: [download] }
  },
}
