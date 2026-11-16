import { crsSelectOptions, getCrs, projectPosition, WGS84 } from '../../crs'
import { fieldNames, getLayer, getOptionalText } from '../shared'
import type { ToolboxTool } from '../types'

/**
 * Add XY Coordinates: writes POINT_X / POINT_Y (and POINT_Z when present) into the
 * attribute table of a point layer, in WGS 84 or another supported coordinate system.
 */
export const addXYCoordinatesTool: ToolboxTool = {
  id: 'add-xy-coordinates',
  name: 'Add XY Coordinates',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Add POINT_X and POINT_Y fields holding the coordinates of each point (in WGS 84, the layer\'s source system, or a chosen system).',
  keywords: ['x y', 'coordinates', 'latitude', 'longitude', 'easting', 'northing', 'point_x', 'point_y'],
  parameters: [
    { id: 'target', label: 'Input point layer', kind: 'layer', required: true },
    {
      id: 'crs', label: 'Coordinate system', kind: 'select', defaultValue: 'source',
      options: [{ value: 'source', label: 'Layer source coordinate system (WGS 84 if unsupported)' }, ...crsSelectOptions],
    },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const choice = getOptionalText(parameters, 'crs') || 'source'
    const crs = getCrs(choice === 'source' ? layer.sourceCrs : choice)
    if (!crs && choice !== 'source') throw new Error(`Unsupported coordinate system: ${choice}.`)
    const code = crs?.code ?? WGS84
    const digits = getCrs(code)?.unit === 'metre' ? 3 : 8
    const hasPoints = layer.data.features.some((feature) => feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint')
    if (!hasPoints) throw new Error('Add XY Coordinates needs a point layer.')
    let skipped = 0
    let hasZ = false
    const features = layer.data.features.map((feature) => {
      const properties: Record<string, unknown> = { ...(feature.properties ?? {}) }
      const geometry = feature.geometry
      const position = geometry?.type === 'Point' ? geometry.coordinates : geometry?.type === 'MultiPoint' ? geometry.coordinates[0] : undefined
      const projected = position ? projectPosition(WGS84, code, [position[0], position[1]]) : null
      if (!projected) skipped += 1
      properties.POINT_X = projected ? Number(projected[0].toFixed(digits)) : null
      properties.POINT_Y = projected ? Number(projected[1].toFixed(digits)) : null
      if (position && position.length > 2 && Number.isFinite(position[2])) {
        hasZ = true
        properties.POINT_Z = position[2]
      }
      return { ...feature, properties }
    })
    const written = ['POINT_X', 'POINT_Y', ...(hasZ ? ['POINT_Z'] : [])]
    const existing = fieldNames(layer)
    return {
      message: `Added ${written.join(', ')} (${getCrs(code)?.name ?? code}) to ${layer.name}.${skipped ? ` ${skipped} non-point or unprojectable features were left empty.` : ''}`,
      kind: skipped ? 'warning' : 'success',
      updates: [{
        layerId: layer.id,
        updates: { data: { ...layer.data, features }, customFields: [...layer.customFields, ...written.filter((field) => !existing.includes(field))] },
      }],
    }
  },
}
