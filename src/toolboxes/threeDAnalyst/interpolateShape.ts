import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { rasterInput, getRaster } from '../spatialAnalyst/_shared'
import { outputLayer } from '../shared'
import { addZToGeometry, outputNameParameter, sampleRaster, THREE_D_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

export const interpolateShapeTool: ToolboxTool = {
  id: 'interpolateShape',
  name: 'Interpolate Shape',
  category: THREE_D_CATEGORY,
  subcategory: 'Functional Surface',
  description: 'Drape input feature vertices over an elevation raster and write sampled elevations as Z coordinates.',
  keywords: ['interpolate', 'shape', 'drape', 'dem', 'elevation', 'z'],
  parameters: [
    { id: 'features', label: 'Input features', kind: 'layer', required: true },
    rasterInput(),
    { id: 'valueField', label: 'Raster elevation field', kind: 'text', defaultValue: 'value' },
    outputNameParameter('Interpolated Shape'),
  ],
  execute: (context, parameters) => {
    const featureLayer = context.layers.find((layer) => layer.id === parameters.features)
    if (!featureLayer) throw new Error('Choose a valid input feature layer.')
    const { grid } = getRaster(context, parameters)
    let draped = 0
    let missing = 0
    const features = featureLayer.data.features.map((feature) => {
      if (!feature.geometry) return feature
      const geometry = addZToGeometry(feature.geometry, ([x, y]) => {
        const z = sampleRaster(grid, x, y)
        if (z === null) { missing += 1; return null }
        draped += 1
        return z
      })
      return { ...feature, geometry } as Feature
    })
    if (!draped) throw new Error('No input vertices overlap valid raster cells. Check the raster extent, CRS and NoData coverage.')
    const name = typeof parameters.outputName === 'string' && parameters.outputName.trim() ? parameters.outputName.trim() : `${featureLayer.name} Interpolated`
    const output = outputLayer(name, featureCollection(features), featureLayer.sourceCrs)
    return {
      message: `${isolate(name)}: draped ${draped} vertices${missing ? `; ${missing} vertices outside valid raster cells retained without a new elevation` : ''}.`,
      ...(missing ? { kind: 'warning' as const } : {}),
      layers: [output],
    }
  },
}
