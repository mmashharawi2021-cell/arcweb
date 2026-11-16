import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature } from 'geojson'
import { outputLayer } from '../shared'
import { addZToGeometry, fieldParameter, getLayerField, outputNameParameter, readNumericValue, THREE_D_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

export const featureTo3DByAttributeTool: ToolboxTool = {
  id: 'featureTo3DByAttribute',
  name: 'Feature To 3D By Attribute',
  category: THREE_D_CATEGORY,
  subcategory: '3D Features',
  description: 'Copy a numeric attribute value into each feature coordinate as its Z elevation.',
  keywords: ['3d', 'z', 'elevation', 'attribute', 'feature'],
  parameters: [
    { id: 'features', label: 'Input features', kind: 'layer', required: true },
    fieldParameter('heightField', 'Height / elevation field', 'features'),
    outputNameParameter('3D Features'),
  ],
  execute: (context, parameters) => {
    const { layer, field } = getLayerField(context, parameters, 'features', 'heightField')
    let converted = 0
    const features = layer.data.features.map((feature) => {
      const value = readNumericValue(feature.properties?.[field])
      if (!feature.geometry || value === null) return feature
      converted += 1
      return { ...feature, geometry: addZToGeometry(feature.geometry, () => value) } as Feature
    })
    if (!converted) throw new Error(`No features have numeric values in "${isolate(field)}".`)
    const name = typeof parameters.outputName === 'string' && parameters.outputName.trim() ? parameters.outputName.trim() : `${layer.name} 3D`
    const output = outputLayer(name, featureCollection(features), layer.sourceCrs)
    return {
      message: `${isolate(name)}: added Z values to ${converted} features${converted < layer.data.features.length ? '; nonnumeric or empty features were retained unchanged' : ''}.`,
      ...(converted < layer.data.features.length ? { kind: 'warning' as const } : {}),
      layers: [output],
    }
  },
}
