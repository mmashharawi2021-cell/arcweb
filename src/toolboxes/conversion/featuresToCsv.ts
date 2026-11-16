import Papa from 'papaparse'
import centroid from '@turf/centroid'
import pointOnFeature from '@turf/point-on-feature'
import type { Feature } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { layerFields, safeName, scalar, toWkt, uniqueField } from './_utils'

export type CsvGeometryMode = 'wkt' | 'xy' | 'geojson' | 'none'

/** Representative X/Y of a feature: the point itself, else the centroid (or a point on the feature if the centroid falls outside). */
function featureXY(feature: Feature): [number, number] | null {
  if (!feature.geometry) return null
  if (feature.geometry.type === 'Point') return [feature.geometry.coordinates[0], feature.geometry.coordinates[1]]
  try {
    const point = feature.geometry.type.includes('Polygon') ? pointOnFeature(feature) : centroid(feature)
    const [x, y] = point.geometry.coordinates
    return [x, y]
  } catch {
    return null
  }
}

export function buildCsv(layer: MapLayer, mode: CsvGeometryMode, fileName?: string): ToolDownload {
  const fields = layerFields(layer)
  const xField = uniqueField('X', fields)
  const yField = uniqueField('Y', [...fields, xField])
  const wktField = uniqueField('WKT', fields)
  const geoField = uniqueField('GEOMETRY', fields)
  const geometryColumns = mode === 'xy' ? [xField, yField] : mode === 'wkt' ? [wktField] : mode === 'geojson' ? [geoField] : []
  const rows = layer.data.features.map((feature) => {
    const row: (string | number | boolean)[] = fields.map((field) => scalar(feature.properties?.[field]))
    if (mode === 'xy') {
      const xy = featureXY(feature)
      row.push(xy?.[0] ?? '', xy?.[1] ?? '')
    } else if (mode === 'wkt') {
      row.push(toWkt(feature.geometry))
    } else if (mode === 'geojson') {
      row.push(feature.geometry ? JSON.stringify(feature.geometry) : '')
    }
    return row
  })
  // A UTF-8 BOM lets Excel open Arabic/Hebrew text correctly.
  const csv = `﻿${Papa.unparse({ fields: [...fields, ...geometryColumns], data: rows })}`
  return {
    fileName: `${safeName(fileName || layer.name)}${mode === 'xy' && !fileName ? '_xy' : ''}.csv`,
    blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  }
}

export const featuresToCsvTool: ToolboxTool = {
  id: 'features-to-csv',
  name: 'Features To CSV',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export the attribute table of a layer to CSV, with geometry as WKT, X/Y columns or GeoJSON text.',
  keywords: ['csv', 'table', 'excel', 'wkt', 'xy', 'export', 'attributes', 'download'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    {
      id: 'geometry', label: 'Geometry output', kind: 'select', defaultValue: 'wkt',
      options: [
        { value: 'wkt', label: 'WKT column' },
        { value: 'xy', label: 'X / Y columns (point, centroid or inner point; WGS 84)' },
        { value: 'geojson', label: 'GeoJSON geometry column' },
        { value: 'none', label: 'Attributes only' },
      ],
    },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Layer name' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const mode = (getOptionalText(parameters, 'geometry') || 'wkt') as CsvGeometryMode
    if (!['wkt', 'xy', 'geojson', 'none'].includes(mode)) throw new Error(`Unknown geometry output: ${mode}.`)
    const download = buildCsv(layer, mode, getOptionalText(parameters, 'fileName'))
    return { message: `Prepared ${download.fileName} (${layer.data.features.length.toLocaleString()} rows).`, downloads: [download] }
  },
}
