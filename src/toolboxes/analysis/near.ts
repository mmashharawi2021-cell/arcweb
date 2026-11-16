import { isolate } from '../../bidi'
import Papa from 'papaparse'
import centroid from '@turf/centroid'
import { featureCollection } from '@turf/helpers'
import type { Feature, Geometry, LineString } from 'geojson'
import { fieldNames, getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, bboxGap, geometryBBox, haversine, nearestBetween } from '../spatial'
import type { ToolboxTool, ToolDownload } from '../types'

const MAX_NEAR_PAIRS = 2_000_000
const MAX_MATRIX_ROWS = 100_000

const round = (value: number, digits: number) => Number(value.toFixed(digits))

function optionalDistance(parameters: Parameters<ToolboxTool['execute']>[1], id: string, label: string): number {
  if (parameters[id] === undefined || parameters[id] === '') return 0
  const value = getNumber(parameters, id, label)
  if (value < 0) throw new Error(`The ${label} cannot be negative.`)
  return value
}

/**
 * Near: for every input feature, finds the closest feature in the near layer and writes
 * NEAR_FID (row number in the near layer), NEAR_DIST (metres) and the closest location
 * NEAR_X / NEAR_Y (WGS 84) into the input layer's attribute table.
 */
export const nearTool: ToolboxTool = {
  id: 'near',
  name: 'Near',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Find the closest feature in another layer and store its ID and geodesic distance on each input feature.',
  keywords: ['distance', 'proximity', 'closest', 'nearest', 'neighbor'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'near', label: 'Near layer', kind: 'layer', required: true },
    { id: 'radius', label: 'Search radius in meters (0 = unlimited)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const nearLayer = getLayer(context, parameters, 'near')
    const radius = optionalDistance(parameters, 'radius', 'search radius')
    const sameLayer = inputLayer.id === nearLayer.id
    const nearFeatures = nearLayer.data.features
      .map((feature, index) => ({ feature, number: index + 1 }))
      .filter((item): item is { feature: Feature<Geometry>; number: number } => item.feature.geometry !== null)
      .map((item) => ({ ...item, bbox: geometryBBox(item.feature.geometry) }))
    assertHasFeatures(nearFeatures, 'The near layer has no usable geometries.')
    if (sameLayer && nearFeatures.length < 2) throw new Error('A layer needs at least two features to be compared with itself.')
    if (inputLayer.data.features.length * nearFeatures.length > MAX_NEAR_PAIRS) {
      throw new Error(`Near would compare more than ${MAX_NEAR_PAIRS.toLocaleString()} feature pairs. Use smaller layers.`)
    }

    let found = 0
    const features = inputLayer.data.features.map((feature) => {
      let best: { number: number; distance: number; x: number; y: number } | null = null
      if (feature.geometry) {
        const bbox = geometryBBox(feature.geometry)
        const limit = radius > 0 ? radius : Infinity
        for (const candidate of nearFeatures) {
          if (sameLayer && candidate.feature === feature) continue
          const ceiling = Math.min(limit, best?.distance ?? Infinity)
          if (bboxGap(bbox, candidate.bbox) > ceiling) continue
          const result = nearestBetween(feature as Feature<Geometry>, candidate.feature)
          if (result.distance <= limit && (!best || result.distance < best.distance)) {
            best = { number: candidate.number, distance: result.distance, x: result.to[0], y: result.to[1] }
            if (result.distance === 0) break
          }
        }
      }
      if (best) found += 1
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          NEAR_FID: best?.number ?? -1,
          NEAR_DIST: best ? round(best.distance, 3) : -1,
          NEAR_X: best ? round(best.x, 7) : null,
          NEAR_Y: best ? round(best.y, 7) : null,
        },
      }
    })

    const existing = fieldNames(inputLayer)
    const added = ['NEAR_FID', 'NEAR_DIST', 'NEAR_X', 'NEAR_Y'].filter((field) => !existing.includes(field))
    const total = inputLayer.data.features.length
    return {
      message: `Near: ${found.toLocaleString()} of ${total.toLocaleString()} features in ${isolate(inputLayer.name)} now have NEAR_FID and NEAR_DIST (meters)${found < total ? '; features with no match within the radius are marked -1' : ''}.`,
      kind: found ? 'success' : 'warning',
      updates: [{
        layerId: inputLayer.id,
        updates: { data: { ...inputLayer.data, features }, customFields: [...inputLayer.customFields, ...added] },
      }],
    }
  },
}

/**
 * Distance Matrix (Generate Near Table): measures the geodesic distance from every input
 * feature to every near feature, optionally limited by radius and number of closest
 * matches. The result is a line layer of links whose attribute table is the matrix.
 */
export const distanceMatrixTool: ToolboxTool = {
  id: 'distance-matrix',
  name: 'Generate Near Table',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Measure distances between all features of two layers. Outputs link lines whose table lists each pair; non-point features use their centroids.',
  keywords: ['distance', 'matrix', 'near table', 'point distance', 'proximity', 'origin destination', 'od'],
  parameters: [
    { id: 'target', label: 'Input layer (origins)', kind: 'layer', required: true },
    { id: 'near', label: 'Near layer (destinations)', kind: 'layer', required: true },
    { id: 'label', label: 'Input name field (optional)', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'nearLabel', label: 'Near name field (optional)', kind: 'field', layerParameter: 'near', allowEmpty: true },
    { id: 'radius', label: 'Search radius in meters (0 = unlimited)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
    { id: 'closest', label: 'Closest matches per feature (0 = all)', kind: 'number', defaultValue: 0, min: 0, step: 1 },
    {
      id: 'table', label: 'Also download table', kind: 'select', defaultValue: 'no',
      options: [{ value: 'no', label: 'No — links layer only' }, { value: 'csv', label: 'Yes — CSV distance table' }],
    },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'Distance matrix' },
  ],
  execute: (context, parameters) => {
    const inputLayer = getLayer(context, parameters, 'target')
    const nearLayer = getLayer(context, parameters, 'near')
    const radius = optionalDistance(parameters, 'radius', 'search radius')
    const closest = Math.floor(optionalDistance(parameters, 'closest', 'number of closest matches'))
    const labelField = getOptionalText(parameters, 'label')
    const nearLabelField = getOptionalText(parameters, 'nearLabel')
    const sameLayer = inputLayer.id === nearLayer.id

    const anchors = (layer: typeof inputLayer, field: string) => layer.data.features
      .map((feature, index) => ({ feature, number: index + 1 }))
      .filter((item): item is { feature: Feature<Geometry>; number: number } => item.feature.geometry !== null)
      .map(({ feature, number }) => ({
        number,
        name: field ? feature.properties?.[field] ?? null : null,
        position: feature.geometry.type === 'Point' ? feature.geometry.coordinates : centroid(feature).geometry.coordinates,
      }))
    const origins = anchors(inputLayer, labelField)
    const destinations = sameLayer ? origins.map((item) => ({ ...item, name: nearLabelField ? nearLayer.data.features[item.number - 1].properties?.[nearLabelField] ?? null : null })) : anchors(nearLayer, nearLabelField)
    assertHasFeatures(origins, 'The input layer has no usable geometries.')
    assertHasFeatures(destinations, 'The near layer has no usable geometries.')
    if (origins.length * destinations.length > MAX_NEAR_PAIRS) {
      throw new Error(`The matrix would compare more than ${MAX_NEAR_PAIRS.toLocaleString()} pairs. Use smaller layers.`)
    }

    const links: Feature<LineString>[] = []
    for (const origin of origins) {
      let pairs = destinations
        .filter((destination) => !(sameLayer && destination.number === origin.number))
        .map((destination) => ({ destination, distance: haversine(origin.position, destination.position) }))
      if (radius > 0) pairs = pairs.filter((pair) => pair.distance <= radius)
      pairs.sort((a, b) => a.distance - b.distance)
      if (closest > 0) pairs = pairs.slice(0, closest)
      pairs.forEach(({ destination, distance }, rank) => {
        links.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [origin.position.slice(0, 2), destination.position.slice(0, 2)] },
          properties: {
            IN_FID: origin.number,
            NEAR_FID: destination.number,
            ...(labelField ? { IN_NAME: origin.name } : {}),
            ...(nearLabelField ? { NEAR_NAME: destination.name } : {}),
            NEAR_RANK: rank + 1,
            DIST_M: round(distance, 3),
            DIST_KM: round(distance / 1000, 6),
          },
        })
      })
      if (links.length > MAX_MATRIX_ROWS) {
        throw new Error(`The matrix exceeds ${MAX_MATRIX_ROWS.toLocaleString()} rows. Set a search radius or a number of closest matches.`)
      }
    }
    assertHasFeatures(links, 'No feature pairs fall within the search radius.')

    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${inputLayer.name} Distance Matrix`, featureCollection(links))
    output.strokeWidth = 1
    const downloads: ToolDownload[] = []
    if (getOptionalText(parameters, 'table') === 'csv') {
      const csv = Papa.unparse(links.map((link) => link.properties as Record<string, unknown>))
      downloads.push({
        fileName: `${output.name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '_')}.csv`,
        blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      })
    }
    return {
      message: `${isolate(output.name)}: ${links.length.toLocaleString()} distance pairs between ${origins.length.toLocaleString()} input and ${destinations.length.toLocaleString()} near features.`,
      layers: [output],
      downloads,
    }
  },
}
