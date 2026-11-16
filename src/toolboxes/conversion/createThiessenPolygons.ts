import { isolate } from '../../bidi'
import bbox from '@turf/bbox'
import cleanCoords from '@turf/clean-coords'
import { featureCollection, point } from '@turf/helpers'
import rewind from '@turf/rewind'
import voronoi from '@turf/voronoi'
import type { Feature, Point, Polygon, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { localProjection } from './_utils'

interface Site { position: Position; properties: Record<string, unknown>; fid: number }

function collectSites(features: Feature[]): { sites: Site[]; duplicates: number } {
  const seen = new Set<string>()
  const sites: Site[] = []
  let duplicates = 0
  features.forEach((feature, index) => {
    const geometry = feature.geometry
    const positions = geometry?.type === 'Point' ? [geometry.coordinates] : geometry?.type === 'MultiPoint' ? geometry.coordinates : []
    for (const position of positions) {
      const key = `${position[0].toFixed(9)},${position[1].toFixed(9)}`
      if (seen.has(key)) { duplicates += 1; continue }
      seen.add(key)
      sites.push({ position, properties: { ...(feature.properties ?? {}) }, fid: index + 1 })
    }
  })
  return { sites, duplicates }
}

/**
 * Thiessen (Voronoi) polygons computed in a local metric projection so that each cell holds the
 * area closer (in metres) to its point than to any other. The extent is the points' envelope
 * enlarged by 10 %, like ArcGIS's default.
 */
export function thiessenPolygons(points: Feature[]): { cells: Feature<Polygon>[]; duplicates: number } {
  const { sites, duplicates } = collectSites(points)
  if (!sites.length) throw new Error('The input layer has no point features.')
  const [west, south, east, north] = bbox(featureCollection(sites.map((site) => point(site.position))))
  const projection = localProjection((west + east) / 2, (south + north) / 2)
  const projected = sites.map((site) => projection.forward(site.position))
  const xs = projected.map((xy) => xy[0])
  const ys = projected.map((xy) => xy[1])
  const pad = Math.max(0.1 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), 100)
  const extent: [number, number, number, number] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const diagram = voronoi(featureCollection(projected.map((xy) => point(xy))), { bbox: extent })
  const cells: Feature<Polygon>[] = []
  diagram.features.forEach((cell, index) => {
    if (!cell?.geometry?.coordinates?.[0]?.length) return
    const ring = cell.geometry.coordinates[0].map(projection.inverse)
    const polygon: Feature<Polygon> = { type: 'Feature', properties: { ...sites[index].properties, Input_FID: sites[index].fid }, geometry: { type: 'Polygon', coordinates: [ring] } }
    const cleaned = rewind(cleanCoords(polygon), { mutate: true }) as Feature<Polygon>
    if (cleaned.geometry.coordinates[0].length >= 4) cells.push(cleaned)
  })
  return { cells, duplicates }
}

export const createThiessenPolygonsTool: ToolboxTool = {
  id: 'conversion-create-thiessen-polygons',
  name: 'Create Thiessen Polygons',
  category: 'Conversion',
  subcategory: 'Cartography & Topology',
  description: 'Divide the area around a set of points into proximal (Voronoi) zones: every location in a polygon is closer to its point than to any other.',
  keywords: ['thiessen', 'voronoi', 'proximal', 'proximity', 'dirichlet', 'tessellation', 'service area'],
  parameters: [
    { id: 'target', label: 'Input point features', kind: 'layer', required: true },
    {
      id: 'fields', label: 'Output fields', kind: 'select', defaultValue: 'all',
      options: [
        { value: 'all', label: 'All fields of the input points' },
        { value: 'fid', label: 'Only the input feature ID (Input_FID)' },
      ],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Layer name + Thiessen' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const pointFeatures = layer.data.features.filter((feature): feature is Feature<Point> =>
      feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint')
    const { cells, duplicates } = thiessenPolygons(pointFeatures)
    if (getOptionalText(parameters, 'fields') === 'fid') {
      cells.forEach((cell) => { cell.properties = { Input_FID: cell.properties?.Input_FID } })
    }
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Thiessen`, featureCollection(cells), layer.sourceCrs)
    const skipped = layer.data.features.length - pointFeatures.length
    const notes = [
      duplicates ? `${duplicates} coincident point(s) were merged.` : '',
      skipped ? `${skipped} non-point feature(s) were ignored.` : '',
    ].filter(Boolean)
    return {
      message: `${isolate(output.name)}: created ${cells.length.toLocaleString()} Thiessen polygons.${notes.length ? ` ${notes.join(' ')}` : ''}`,
      kind: notes.length ? 'warning' : 'success',
      layers: [output],
    }
  },
}
