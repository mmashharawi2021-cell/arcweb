import type { Feature, Point } from 'geojson'
import { crsLabel, crsSelectOptions, projectPosition, requireCrs, WGS84 } from '../../crs'
import { getFile, getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxContext, ToolboxParameters, ToolboxTool } from '../types'
import { layerFields, readTableFile } from './_utils'
import { isolate } from '../../bidi'

const X_NAMES = ['x', 'point_x', 'lon', 'long', 'lng', 'longitude', 'easting', 'east', 'e', 'xcoord', 'x_coord']
const Y_NAMES = ['y', 'point_y', 'lat', 'latitude', 'northing', 'north', 'n', 'ycoord', 'y_coord']

function pickField(fields: string[], requested: string, candidates: string[], label: string): string {
  if (requested) {
    const match = fields.find((field) => field === requested) ?? fields.find((field) => field.toLowerCase() === requested.toLowerCase())
    if (!match) throw new Error(`The ${label} field "${isolate(requested)}" was not found. Available fields: ${fields.map(isolate).join(', ')}.`)
    return match
  }
  for (const candidate of candidates) {
    const match = fields.find((field) => field.trim().toLowerCase() === candidate)
    if (match) return match
  }
  throw new Error(`Choose the ${label} field; none could be detected. Available fields: ${fields.map(isolate).join(', ')}.`)
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || !value.trim()) return Number.NaN
  return Number(value.trim())
}

async function readRows(context: ToolboxContext, parameters: ToolboxParameters) {
  if (parameters.file instanceof File) {
    const file = getFile(parameters, 'file', 'table')
    const { fields, records } = await readTableFile(file)
    return { fields, records: records as Record<string, unknown>[], name: file.name.replace(/\.[^.]+$/, '') }
  }
  if (typeof parameters.table === 'string' && parameters.table) {
    const layer = getLayer(context, parameters, 'table')
    return { fields: layerFields(layer), records: layer.data.features.map((feature) => ({ ...(feature.properties ?? {}) })), name: layer.name }
  }
  throw new Error('Choose an input table layer or upload a CSV / Excel file.')
}

export const xyTableToPointTool: ToolboxTool = {
  id: 'xy-table-to-point',
  runsOnMainThread: true,
  name: 'XY Table To Point',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Create a point layer from X/Y (and optional Z) coordinate fields in a table layer or an uploaded CSV / Excel file, in any supported coordinate system.',
  keywords: ['xy', 'coordinates', 'lat', 'long', 'easting', 'northing', 'csv', 'excel', 'table to points', 'make xy event layer'],
  parameters: [
    { id: 'table', label: 'Input table (layer)', kind: 'layer' },
    { id: 'file', label: '…or input file (.csv / .xlsx)', kind: 'file', accept: '.csv,.txt,.xlsx' },
    { id: 'xField', label: 'X field (longitude / easting)', kind: 'text', placeholder: 'Auto-detect' },
    { id: 'yField', label: 'Y field (latitude / northing)', kind: 'text', placeholder: 'Auto-detect' },
    { id: 'zField', label: 'Z field (optional)', kind: 'text', placeholder: 'None' },
    { id: 'crs', label: 'Coordinate system of the X/Y values', kind: 'select', defaultValue: WGS84, options: crsSelectOptions },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Table name + Points' },
  ],
  execute: async (context, parameters) => {
    const { fields, records, name } = await readRows(context, parameters)
    if (!records.length) throw new Error('The input table has no rows.')
    const xField = pickField(fields, getOptionalText(parameters, 'xField'), X_NAMES, 'X')
    const yField = pickField(fields, getOptionalText(parameters, 'yField'), Y_NAMES, 'Y')
    const zRequested = getOptionalText(parameters, 'zField')
    const zField = zRequested ? pickField(fields, zRequested, [], 'Z') : ''
    const crs = requireCrs(getOptionalText(parameters, 'crs') || WGS84).code

    const features: Feature<Point>[] = []
    let skipped = 0
    for (const record of records) {
      const x = toNumber(record[xField])
      const y = toNumber(record[yField])
      const position = Number.isFinite(x) && Number.isFinite(y) ? projectPosition(crs, WGS84, [x, y]) : null
      if (!position || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) {
        skipped += 1
        continue
      }
      const z = zField ? toNumber(record[zField]) : Number.NaN
      const properties: Record<string, unknown> = {}
      for (const field of fields) properties[field] = record[field] ?? null
      features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: Number.isFinite(z) ? [...position, z] : position } })
    }
    if (!features.length) {
      const hint = crs === WGS84 ? ' If the values are metres (easting/northing), choose the matching projected coordinate system.' : ''
      throw new Error(`No rows had valid ${isolate(xField)}/${isolate(yField)} coordinates in ${crsLabel(crs)}.${hint}`)
    }
    const layer = outputLayer(getOptionalText(parameters, 'outputName') || `${name} Points`, { type: 'FeatureCollection', features }, crs)
    return {
      message: `${isolate(layer.name)}: created ${features.length.toLocaleString()} points from ${isolate(xField)}/${isolate(yField)} (${crsLabel(crs)}).${skipped ? ` ${skipped} row(s) with missing or invalid coordinates were skipped.` : ''}`,
      kind: skipped ? 'warning' : 'success',
      layers: [layer],
    }
  },
}
