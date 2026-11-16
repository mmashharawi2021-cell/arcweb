import { featureCollection, point } from '@turf/helpers'
import voronoi from '@turf/voronoi'
import type { Feature, Point } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { cleanPolygonGeometry, outputName, outputNameParameter, polygonFeature, type PolygonGeometry } from './_utils'

const MAX_POINTS = 50_000

/**
 * Create Thiessen Polygons: Voronoi proximal zones around points, each carrying the
 * attributes of its point. The diagram is clipped to the point extent enlarged by 10%.
 * Coincident points produce one polygon (the first point's attributes).
 */
export const createThiessenPolygonsTool: ToolboxTool = {
  id: 'create-thiessen-polygons',
  name: 'Create Thiessen Polygons',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Create Voronoi (Thiessen) polygons so every location is assigned to its nearest input point.',
  keywords: ['voronoi', 'thiessen', 'proximal', 'nearest', 'zones', 'tessellation'],
  parameters: [
    { id: 'target', label: 'Input features (points)', kind: 'layer', required: true },
    {
      id: 'fields', label: 'Output fields', kind: 'select', defaultValue: 'ALL',
      options: [{ value: 'ALL', label: 'All attributes of the points' }, { value: 'ONLY_FID', label: 'Only INPUT_FID' }],
    },
    outputNameParameter('Thiessen polygons'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const onlyFid = getOptionalText(parameters, 'fields') === 'ONLY_FID'
    const seen = new Set<string>()
    const sites: Feature<Point>[] = []
    let duplicates = 0
    target.data.features.forEach((feature, index) => {
      if (!feature.geometry) return
      if (feature.geometry.type !== 'Point') throw new Error(`Create Thiessen Polygons needs point features; found ${feature.geometry.type}.`)
      const [x, y] = feature.geometry.coordinates
      const key = `${x},${y}`
      if (seen.has(key)) { duplicates += 1; return }
      seen.add(key)
      sites.push(point([x, y], onlyFid ? { INPUT_FID: index + 1 } : { INPUT_FID: index + 1, ...(feature.properties ?? {}) }))
    })
    assertHasFeatures(sites, 'The input layer has no points.')
    if (sites.length > MAX_POINTS) throw new Error(`Use at most ${MAX_POINTS.toLocaleString()} points.`)

    const xs = sites.map((site) => site.geometry.coordinates[0])
    const ys = sites.map((site) => site.geometry.coordinates[1])
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = Math.max(maxX - minX, maxY - minY) * 0.1 || 0.01
    const cells = voronoi(featureCollection(sites), { bbox: [minX - pad, minY - pad, maxX + pad, maxY + pad] })
    const polygons: Feature<PolygonGeometry>[] = []
    cells.features.forEach((cell, index) => {
      const geometry = cell ? cleanPolygonGeometry(cell.geometry) : null
      if (geometry) polygons.push(polygonFeature(geometry, { ...(sites[index].properties ?? {}) }))
    })
    assertHasFeatures(polygons, 'No Thiessen polygons could be created.')
    const output = outputLayer(outputName(parameters, `${target.name} Thiessen`), featureCollection(polygons), target.sourceCrs)
    return {
      message: `${output.name}: ${polygons.length.toLocaleString()} Thiessen polygons${duplicates ? `; ${duplicates} coincident points were merged` : ''}.`,
      kind: duplicates ? 'warning' : 'success',
      layers: [output],
    }
  },
}
