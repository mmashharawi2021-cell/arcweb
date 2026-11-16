import { isolate } from '../../bidi'
import { featureCollection } from '@turf/helpers'
import type { Feature, Polygon, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { collectionBBox, METERS_PER_DEGREE, optionalNumber, outputNameParameter } from '../dataManagement/_utils'

const MAX_CELLS = 100_000

/** Creates a rectangular index grid covering the template layer's WGS 84 extent. */
export const gridIndexFeaturesTool: ToolboxTool = {
  id: 'grid-index-features',
  name: 'Grid Index Features',
  category: 'Cartography',
  subcategory: 'Map Series',
  description: 'Create a numbered polygon grid covering an input layer extent, with configurable dimensions in metres or rows and columns. Runs locally in your browser.',
  keywords: ['grid', 'index', 'map series', 'atlas', 'tiles', 'fishnet'],
  parameters: [
    { id: 'template', label: 'Template extent layer', kind: 'layer', required: true },
    { id: 'cellWidth', label: 'Cell width (m, blank = rows/columns)', kind: 'number', min: 0 },
    { id: 'cellHeight', label: 'Cell height (m, blank = width)', kind: 'number', min: 0 },
    { id: 'rows', label: 'Number of rows (used when width is blank)', kind: 'number', min: 0, step: 1 },
    { id: 'columns', label: 'Number of columns (used when width is blank)', kind: 'number', min: 0, step: 1 },
    outputNameParameter('Grid index'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'template')
    const extent = collectionBBox(layer.data.features)
    if (!extent) throw new Error('The template layer has no usable geometry extent.')
    const [west, south, east, north] = extent
    if (west < -180 || east > 180 || south < -90 || north > 90) {
      throw new Error('Grid Index Features requires template coordinates in WGS 84 longitude/latitude.')
    }
    if (west >= east || south >= north) throw new Error('The template layer extent must have positive width and height.')
    const midLatitude = ((south + north) / 2) * Math.PI / 180
    const metresPerLongitudeDegree = METERS_PER_DEGREE * Math.max(Math.cos(midLatitude), 1e-6)
    const width = optionalNumber(parameters, 'cellWidth', 'cell width') ?? 0
    const heightValue = optionalNumber(parameters, 'cellHeight', 'cell height')
    if (width < 0 || (heightValue !== null && heightValue < 0)) throw new Error('Cell dimensions must be zero or greater.')
    let rows: number
    let columns: number
    let dx: number
    let dy: number
    if (width > 0) {
      const height = heightValue && heightValue > 0 ? heightValue : width
      dx = width / metresPerLongitudeDegree
      dy = height / METERS_PER_DEGREE
      columns = Math.max(1, Math.ceil((east - west) / dx - 1e-9))
      rows = Math.max(1, Math.ceil((north - south) / dy - 1e-9))
    } else {
      rows = Math.round(optionalNumber(parameters, 'rows', 'number of rows') ?? 0)
      columns = Math.round(optionalNumber(parameters, 'columns', 'number of columns') ?? 0)
      if (rows < 1 || columns < 1) throw new Error('Enter a positive cell width in metres, or both a number of rows and columns.')
      dx = (east - west) / columns
      dy = (north - south) / rows
    }
    const total = rows * columns
    if (!Number.isSafeInteger(total) || total > MAX_CELLS) {
      throw new Error(`The grid would contain ${Number.isFinite(total) ? total.toLocaleString() : 'too many'} cells (limit ${MAX_CELLS.toLocaleString()}). Increase cell dimensions.`)
    }
    const cells: Feature<Polygon>[] = []
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x0 = west + column * dx
        const x1 = column === columns - 1 ? east : west + (column + 1) * dx
        const y0 = south + row * dy
        const y1 = row === rows - 1 ? north : south + (row + 1) * dy
        const ring: Position[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
        const index = row * columns + column + 1
        cells.push({
          type: 'Feature',
          properties: { GRID_ID: `${row + 1}-${column + 1}`, PAGE_NAME: `${row + 1}-${column + 1}`, ROW: row + 1, COL: column + 1, INDEX: index },
          geometry: { type: 'Polygon', coordinates: [ring] },
        })
      }
    }
    const name = getOptionalText(parameters, 'outputName') || `${layer.name} Grid Index`
    const output = outputLayer(name, featureCollection(cells), layer.sourceCrs)
    return { message: `${isolate(name)}: created ${rows.toLocaleString()} rows × ${columns.toLocaleString()} columns (${total.toLocaleString()} index cells).`, layers: [output] }
  },
}
