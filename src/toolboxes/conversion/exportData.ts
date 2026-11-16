import { isolate } from '../../bidi'
import { getLayer, getText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import type { MapLayer } from '../../store'
import { buildCsv } from './featuresToCsv'
import { buildGeoJson } from './featuresToGeoJson'
import { buildKml } from './featuresToKml'
import { buildShapefile } from './featuresToShapefile'

const formats = [
  { value: 'geojson', label: 'GeoJSON' },
  { value: 'shapefile', label: 'Shapefile ZIP' },
  { value: 'kml', label: 'KML' },
  { value: 'csv', label: 'CSV with WKT geometry' },
  { value: 'csv-xy', label: 'CSV with X/Y coordinates' },
]

async function exportLayer(layer: MapLayer, format: string): Promise<{ download: ToolDownload; warnings: string[] }> {
  switch (format) {
    case 'geojson': return { download: buildGeoJson(layer), warnings: [] }
    case 'csv': return { download: buildCsv(layer, 'wkt'), warnings: [] }
    case 'csv-xy': return { download: buildCsv(layer, 'xy'), warnings: [] }
    case 'kml': return { download: buildKml(layer), warnings: [] }
    case 'shapefile': return buildShapefile(layer)
    default: throw new Error(`Unsupported export format: ${format}.`)
  }
}

/** One-stop export; the dedicated Features To … tools expose each format's options. */
export const exportDataTool: ToolboxTool = {
  id: 'export-data',
  name: 'Export Data',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export a layer to GeoJSON, Shapefile ZIP, KML, or CSV formats.',
  keywords: ['save', 'download', 'geojson', 'shapefile', 'kml', 'csv', 'xy', 'wkt'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'format', label: 'Output format', kind: 'select', required: true, defaultValue: 'geojson', options: formats },
  ],
  execute: async (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const format = getText(parameters, 'format', 'an output format')
    const { download, warnings } = await exportLayer(layer, format)
    return {
      message: `Prepared ${isolate(download.fileName)} for download.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      kind: warnings.length ? 'warning' : 'success',
      downloads: [download],
    }
  },
}
