import { isolate } from '../../bidi'
import type { Feature, Geometry, Position } from 'geojson'
import { withoutGeometry } from '../../geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { geometryProblems } from './checkGeometry'
import { outputNameParameter, repairLineGeometry, repairPolygonGeometry, yesNoParameter } from './_utils'

const validPosition = (position: Position) => Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1])

/** Returns a repaired geometry, or null when nothing valid remains. */
export function repairGeometry(geometry: Geometry | null): Geometry | null {
  if (!geometry) return null
  switch (geometry.type) {
    case 'Point': return validPosition(geometry.coordinates) ? geometry : null
    case 'MultiPoint': {
      const coordinates = geometry.coordinates.filter(validPosition)
      if (!coordinates.length) return null
      return coordinates.length === 1 ? { type: 'Point', coordinates: coordinates[0] } : { type: 'MultiPoint', coordinates }
    }
    case 'LineString':
    case 'MultiLineString': return repairLineGeometry(geometry)
    case 'Polygon':
    case 'MultiPolygon': return repairPolygonGeometry(geometry)
    default: return geometry
  }
}

/** Repair Geometry: fixes the problems reported by Check Geometry. */
export const repairGeometryTool: ToolboxTool = {
  id: 'repair-geometry',
  name: 'Repair Geometry',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Fix geometry problems: close rings, remove duplicate vertices, fix ring orientation, resolve self-intersections and drop empty or degenerate features.',
  keywords: ['fix', 'validate', 'topology', 'self intersection', 'clean', 'invalid'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    yesNoParameter('deleteNull', 'Delete features with null geometry', 'yes', 'Yes — delete null / empty features', 'No — keep them as records without geometry'),
    {
      id: 'output', label: 'Output', kind: 'select', defaultValue: 'new',
      options: [{ value: 'new', label: 'Create a repaired copy' }, { value: 'inplace', label: 'Repair the input layer in place' }],
    },
    outputNameParameter('Repaired layer'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const deleteNull = getOptionalText(parameters, 'deleteNull') !== 'no'
    const inPlace = getOptionalText(parameters, 'output') === 'inplace'
    let repaired = 0
    let deleted = 0
    const features: Feature[] = []
    for (const feature of layer.data.features) {
      const problems = geometryProblems(feature.geometry ?? null)
      const geometry = problems.length ? repairGeometry(feature.geometry ?? null) : feature.geometry
      if (problems.length && geometry) repaired += 1
      if (!geometry) {
        if (deleteNull) { deleted += 1; continue }
        features.push(withoutGeometry(feature))
        continue
      }
      features.push(inPlace ? { ...feature, geometry } : { type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry })
    }
    const summary = `repaired ${repaired.toLocaleString()} features${deleted ? `, deleted ${deleted.toLocaleString()} null or degenerate features` : ''}`
    if (inPlace) {
      return {
        message: `${isolate(layer.name)}: ${summary}.`,
        updates: [{ layerId: layer.id, updates: { data: { ...layer.data, features } } }],
      }
    }
    if (!features.length) throw new Error('No features with valid geometry remain after repair.')
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Repaired`, { type: 'FeatureCollection', features }, layer.sourceCrs)
    return { message: `${isolate(output.name)}: ${summary}.`, layers: [output] }
  },
}
