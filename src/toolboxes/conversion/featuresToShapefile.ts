import { isolate } from '../../bidi'
import { crsLabel, crsSelectOptions, getCrs, WGS84 } from '../../crs'
import type { MapLayer } from '../../store'
import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { buildShapefileZip, esriWkt } from './_shapefile'
import { exportableFeatures, layerFields, safeName } from './_utils'

/**
 * Resolves the output coordinate system: '' → WGS 84, 'source' → the layer's native system
 * when ArcWeb can write a .prj for it (otherwise WGS 84 with a warning), or an explicit EPSG code.
 */
function resolveCrs(layer: MapLayer, choice: string): { crs: string; warning?: string } {
  if (!choice || choice === WGS84) return { crs: WGS84 }
  const code = choice === 'source' ? layer.sourceCrs : choice
  const definition = getCrs(code)
  if (definition && esriWkt(definition.code)) return { crs: definition.code }
  if (choice === 'source') {
    return { crs: WGS84, warning: `The source coordinate system "${crsLabel(layer.sourceCrs)}" cannot be written; exported in WGS 84 instead.` }
  }
  throw new Error(`Unsupported output coordinate system: ${choice}.`)
}

export async function buildShapefile(layer: MapLayer, crsChoice = '', fileName?: string): Promise<{ download: ToolDownload; warnings: string[]; crs: string }> {
  const { crs, warning } = resolveCrs(layer, crsChoice)
  const baseName = safeName(fileName || layer.name)
  const result = await buildShapefileZip(exportableFeatures(layer), layerFields(layer), baseName, crs)
  return { download: { fileName: `${baseName}.zip`, blob: result.blob }, warnings: [...(warning ? [warning] : []), ...result.warnings], crs }
}

export const featuresToShapefileTool: ToolboxTool = {
  id: 'features-to-shapefile',
  name: 'Features To Shapefile ZIP',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export a layer to a zipped ESRI shapefile (.shp, .shx, .dbf, .prj, .cpg) in WGS 84 or a projected coordinate system.',
  keywords: ['shapefile', 'shp', 'zip', 'esri', 'dbf', 'prj', 'export', 'download', 'feature class to shapefile'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    {
      id: 'crs', label: 'Output coordinate system', kind: 'select', defaultValue: '',
      options: [
        { value: '', label: 'WGS 84 (EPSG:4326)' },
        { value: 'source', label: "Layer's source coordinate system" },
        ...crsSelectOptions.filter((option) => option.value !== WGS84),
      ],
    },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Layer name' },
  ],
  execute: async (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const { download, warnings, crs } = await buildShapefile(layer, getOptionalText(parameters, 'crs'), getOptionalText(parameters, 'fileName'))
    return {
      message: `Prepared ${isolate(download.fileName)} in ${crsLabel(crs)}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      kind: warnings.length ? 'warning' : 'success',
      downloads: [download],
    }
  },
}
