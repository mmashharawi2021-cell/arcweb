import { crsLabel, crsSelectOptions, getCrs, requireCrs } from '../../crs'
import { getLayer, getText } from '../shared'
import type { ToolboxTool } from '../types'

/**
 * Define Projection: records the coordinate system of a layer's source data without
 * changing coordinates (ArcWeb always holds geometry in WGS 84). Use Project to convert.
 */
export const defineProjectionTool: ToolboxTool = {
  id: 'define-projection',
  name: 'Define Projection',
  category: 'Data Management',
  subcategory: 'Projections',
  description: 'Set (or correct) the coordinate system recorded for a layer, e.g. when a shapefile had no .prj. Coordinates are not changed — use Project to convert.',
  keywords: ['coordinate system', 'crs', 'prj', 'spatial reference', 'epsg', 'assign projection'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'crs', label: 'Coordinate system', kind: 'select', required: true, defaultValue: 'EPSG:4326', options: crsSelectOptions },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const crs = requireCrs(getText(parameters, 'crs', 'a coordinate system'))
    const previous = layer.sourceCrs
    const unchanged = getCrs(previous)?.code === crs.code
    if (unchanged) return { message: `${layer.name} is already defined as ${crs.name} (${crs.code}).` }
    const unknown = !previous || /assumed|unknown|defined by \.prj/i.test(previous)
    return {
      message: unknown
        ? `Defined ${layer.name} as ${crs.name} (${crs.code}).`
        : `Warning: ${layer.name} was defined as ${crsLabel(previous)}; it is now ${crs.name} (${crs.code}). Coordinates were not changed — use Project to convert data between systems.`,
      kind: unknown ? 'success' : 'warning',
      updates: [{ layerId: layer.id, updates: { sourceCrs: crs.code } }],
    }
  },
}
