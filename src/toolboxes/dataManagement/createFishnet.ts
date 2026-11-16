import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, LineString, Point, Polygon, Position } from 'geojson'
import { getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { collectionBBox, METERS_PER_DEGREE, optionalNumber, outputNameParameter, parseBBox, yesNoParameter } from './_utils'

const MAX_CELLS = 250_000

/** Create Fishnet: a grid of rectangular cells (polygons or lines) over an extent, with optional label points. */
export const createFishnetTool: ToolboxTool = {
  id: 'create-fishnet',
  name: 'Create Fishnet',
  category: 'Data Management',
  subcategory: 'Sampling',
  description: 'Create a grid of rectangular cells over a template layer\'s extent or a typed extent, sized by cell width/height in metres or by a number of rows and columns.',
  keywords: ['grid', 'fishnet', 'mesh', 'tessellation', 'cells', 'rectangle grid', 'sampling'],
  parameters: [
    { id: 'template', label: 'Template extent layer (optional)', kind: 'layer' },
    { id: 'extent', label: 'Or extent: west, south, east, north (degrees)', kind: 'text', placeholder: '34.9, 31.0, 35.1, 31.2' },
    { id: 'cellWidth', label: 'Cell width (m)', kind: 'number', min: 0, defaultValue: 1000 },
    { id: 'cellHeight', label: 'Cell height (m, blank = width)', kind: 'number', min: 0 },
    { id: 'rows', label: 'Number of rows (used when cell size is 0/blank)', kind: 'number', min: 0, step: 1 },
    { id: 'columns', label: 'Number of columns (used when cell size is 0/blank)', kind: 'number', min: 0, step: 1 },
    {
      id: 'geometryType', label: 'Geometry type', kind: 'select', defaultValue: 'POLYGON',
      options: [{ value: 'POLYGON', label: 'Polygon cells' }, { value: 'POLYLINE', label: 'Polyline grid lines' }],
    },
    yesNoParameter('labels', 'Create label points', 'no', 'Yes — a point at each cell centre', 'No'),
    outputNameParameter('Fishnet'),
  ],
  execute: (context, parameters) => {
    const templateId = getOptionalText(parameters, 'template')
    const extentText = getOptionalText(parameters, 'extent')
    const template = templateId ? context.layers.find((layer) => layer.id === templateId) : undefined
    if (templateId && !template) throw new Error('The template layer is no longer available.')
    const extent = extentText ? parseBBox(extentText) : template ? collectionBBox(template.data.features) : null
    if (!extent) throw new Error('Choose a template layer or enter an extent.')
    const [west, south, east, north] = extent
    const midLatitude = ((south + north) / 2) * Math.PI / 180
    const metresPerLonDegree = METERS_PER_DEGREE * Math.max(Math.cos(midLatitude), 1e-6)

    const width = optionalNumber(parameters, 'cellWidth', 'cell width') ?? 0
    const height = optionalNumber(parameters, 'cellHeight', 'cell height') || width
    let rows: number
    let columns: number
    let dx: number
    let dy: number
    if (width > 0) {
      dx = width / metresPerLonDegree
      dy = height / METERS_PER_DEGREE
      columns = Math.max(1, Math.ceil((east - west) / dx - 1e-9))
      rows = Math.max(1, Math.ceil((north - south) / dy - 1e-9))
    } else {
      rows = Math.round(optionalNumber(parameters, 'rows', 'number of rows') ?? 0)
      columns = Math.round(optionalNumber(parameters, 'columns', 'number of columns') ?? 0)
      if (rows < 1 || columns < 1) throw new Error('Enter a cell size in metres, or both a number of rows and columns.')
      dx = (east - west) / columns
      dy = (north - south) / rows
    }
    if (rows * columns > MAX_CELLS) {
      throw new Error(`The fishnet would have ${(rows * columns).toLocaleString()} cells (limit ${MAX_CELLS.toLocaleString()}). Use a larger cell size.`)
    }
    const x = (column: number) => west + column * dx
    const y = (row: number) => south + row * dy
    const polylines = getOptionalText(parameters, 'geometryType') === 'POLYLINE'

    const cells: Feature<Polygon | LineString>[] = []
    if (polylines) {
      for (let row = 0; row <= rows; row += 1) {
        cells.push({ type: 'Feature', properties: { DIRECTION: 'HORIZONTAL', INDEX: row + 1 }, geometry: { type: 'LineString', coordinates: [[x(0), y(row)], [x(columns), y(row)]] } })
      }
      for (let column = 0; column <= columns; column += 1) {
        cells.push({ type: 'Feature', properties: { DIRECTION: 'VERTICAL', INDEX: column + 1 }, geometry: { type: 'LineString', coordinates: [[x(column), y(0)], [x(column), y(rows)]] } })
      }
    } else {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const ring: Position[] = [[x(column), y(row)], [x(column + 1), y(row)], [x(column + 1), y(row + 1)], [x(column), y(row + 1)], [x(column), y(row)]]
          cells.push({ type: 'Feature', properties: { CELL_ID: row * columns + column + 1, ROW: row + 1, COL: column + 1 }, geometry: { type: 'Polygon', coordinates: [ring] } })
        }
      }
    }
    const name = getOptionalText(parameters, 'outputName') || 'Fishnet'
    const layers = [outputLayer(name, featureCollection(cells))]
    if (getOptionalText(parameters, 'labels') === 'yes') {
      const points: Feature<Point>[] = []
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          points.push({ type: 'Feature', properties: { CELL_ID: row * columns + column + 1, ROW: row + 1, COL: column + 1 }, geometry: { type: 'Point', coordinates: [x(column + 0.5), y(row + 0.5)] } })
        }
      }
      layers.push(outputLayer(`${name} Labels`, featureCollection(points)))
    }
    return {
      message: `${isolate(name)}: ${rows.toLocaleString()} rows × ${columns.toLocaleString()} columns (${(rows * columns).toLocaleString()} cells, about ${Math.round(dx * metresPerLonDegree).toLocaleString()} × ${Math.round(dy * METERS_PER_DEGREE).toLocaleString()} m).`,
      layers,
    }
  },
}
