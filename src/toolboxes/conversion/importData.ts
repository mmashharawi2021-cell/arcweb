import { readGeospatialFile } from '../../geo'
import { getFile, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'

export const importDataTool: ToolboxTool = {
  id: 'import-data',
  name: 'Import Data',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Import GeoJSON, Shapefile ZIP, KML, or latitude/longitude CSV files.',
  keywords: ['open', 'load', 'add data', 'geojson', 'shapefile', 'kml', 'csv'],
  parameters: [{ id: 'file', label: 'Data file', kind: 'file', required: true, accept: '.geojson,.json,.zip,.kml,.csv' }],
  execute: async (_context, parameters) => {
    const file = getFile(parameters, 'file', 'data')
    const imports = await readGeospatialFile(file)
    const layers = imports.map(({ name, data, sourceCrs }) => outputLayer(name, data, sourceCrs))
    const warnings = imports.flatMap(({ name, warnings: layerWarnings }) => layerWarnings.map((warning) => `${name}: ${warning}`))
    if (!layers.length) throw new Error('The selected file did not contain any layers.')
    return {
      message: `Imported ${layers.length} layer${layers.length === 1 ? '' : 's'} from ${file.name}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      kind: warnings.length ? 'warning' : 'success',
      layers,
    }
  },
}
