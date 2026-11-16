import { isNoData } from '../../rasterEngine'
import { assertAlignedGrids, getBandGrids, gridOutput, outputName, getPositiveNumber, IMAGE_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

const indices = {
  NDVI: { label: 'NDVI (NIR - Red) / (NIR + Red)', roles: ['nirBand', 'redBand'] },
  NDWI: { label: 'NDWI (Green - NIR) / (Green + NIR)', roles: ['greenBand', 'nirBand'] },
  NDBI: { label: 'NDBI (SWIR - NIR) / (SWIR + NIR)', roles: ['swirBand', 'nirBand'] },
} as const

export const spectralIndicesTool: ToolboxTool = {
  id: 'spectralIndices',
  name: 'Spectral Indices',
  category: IMAGE_ANALYST_CATEGORY,
  subcategory: 'Spectral',
  description: 'Calculate NDVI, NDWI or standard NDBI from selected GeoTIFF bands or two aligned raster layers. NDBI uses SWIR + NIR in its denominator.',
  keywords: ['NDVI', 'NDWI', 'NDBI', 'vegetation', 'water', 'built-up', 'spectral'],
  parameters: [
    { id: 'index', label: 'Index preset', kind: 'select', defaultValue: 'NDVI', options: Object.entries(indices).map(([value, index]) => ({ value, label: index.label })) },
    { id: 'file', label: 'Multi-band GeoTIFF (optional)', kind: 'file', accept: '.tif,.tiff,image/tiff' },
    { id: 'redBand', label: 'GeoTIFF Red band', kind: 'number', defaultValue: 3, min: 1, step: 1 },
    { id: 'greenBand', label: 'GeoTIFF Green band', kind: 'number', defaultValue: 2, min: 1, step: 1 },
    { id: 'nirBand', label: 'GeoTIFF NIR band', kind: 'number', defaultValue: 4, min: 1, step: 1 },
    { id: 'swirBand', label: 'GeoTIFF SWIR band', kind: 'number', defaultValue: 5, min: 1, step: 1 },
    { id: 'bandRasters', label: 'Separate raster bands (select exactly 2, in formula order)', kind: 'layers' },
    { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Spectral index' },
  ],
  execute: async (context, parameters) => {
    const presetName = typeof parameters.index === 'string' ? parameters.index : 'NDVI'
    if (!(presetName in indices)) throw new Error('Choose NDVI, NDWI or NDBI.')
    const preset = indices[presetName as keyof typeof indices]
    const file = parameters.file
    const isGeoTiff = typeof File !== 'undefined' && file instanceof File
    const formulaBands = preset.roles.map((role) => getPositiveNumber(parameters, role, role.replace('Band', ' band'), role === 'redBand' ? 3 : role === 'greenBand' ? 2 : role === 'nirBand' ? 4 : 5))
    if (formulaBands.some((band) => !Number.isInteger(band))) throw new Error('GeoTIFF band numbers must be positive integers.')
    const { grids, name } = await getBandGrids(context, parameters, {
      maxLayers: 2,
      defaultGeoTiffBands: isGeoTiff ? formulaBands : undefined,
    })
    if (!isGeoTiff && grids.length !== 2) throw new Error('Select exactly two separate raster bands in formula order.')
    if (isGeoTiff && grids.length !== 2) throw new Error('Select valid GeoTIFF bands for the selected index.')
    assertAlignedGrids(grids)
    const [first, second] = grids
    const values = new Float32Array(first.values.length).fill(Number.NaN)
    for (let index = 0; index < values.length; index += 1) {
      const a = first.values[index]
      const b = second.values[index]
      if (isNoData(a, first.noData) || isNoData(b, second.noData)) continue
      const denominator = a + b
      if (denominator === 0 || !Number.isFinite(denominator)) continue
      const result = (a - b) / denominator
      if (Number.isFinite(result)) values[index] = result
    }
    const grid = { ...first, values, noData: Number.NaN }
    const output = gridOutput(outputName(parameters, `${presetName} ${name}`), grid)
    return {
      message: `${output.name}: calculated ${presetName} for ${values.length} aligned cells. ${presetName === 'NDBI' ? 'NDBI uses the standard SWIR + NIR denominator.' : ''}`,
      layers: [output],
    }
  },
}

export { indices as spectralIndexPresets }
