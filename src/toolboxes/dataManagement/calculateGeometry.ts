import area from '@turf/area'
import centroid from '@turf/centroid'
import length from '@turf/length'
import type { Feature, Geometry, Position } from 'geojson'
import { coordinateSystems, projectPosition, requireCrs, transformGeometry, WGS84 } from '../../crs'
import { fieldNames, getLayer, getOptionalText } from '../shared'
import { isLine, isPolygon } from '../spatial'
import type { ToolboxTool } from '../types'

const areaUnits = {
  sqm: { field: 'AREA_SQM', label: 'Square meters (m²)', perSquareMeter: 1, digits: 2 },
  sqkm: { field: 'AREA_SQKM', label: 'Square kilometers (km²)', perSquareMeter: 1e-6, digits: 6 },
  dunum: { field: 'AREA_DUNUM', label: 'Dunums (1 dunum = 1,000 m²)', perSquareMeter: 1e-3, digits: 4 },
  hectare: { field: 'AREA_HA', label: 'Hectares (ha)', perSquareMeter: 1e-4, digits: 4 },
} as const

const lengthUnits = {
  m: { suffix: 'M', label: 'Meters (m)', perMeter: 1, digits: 2 },
  km: { suffix: 'KM', label: 'Kilometers (km)', perMeter: 1e-3, digits: 5 },
} as const

type AreaUnit = keyof typeof areaUnits
type LengthUnit = keyof typeof lengthUnits

const round = (value: number, digits: number) => Number(value.toFixed(digits))

function ringArea(ring: Position[]): number {
  let total = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    total += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return Math.abs(total) / 2
}

function pathLength(path: Position[]): number {
  let total = 0
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1])
  }
  return total
}

/** Planar area (outer rings minus holes) of a geometry already in a projected system. */
function planarArea(geometry: Geometry): number {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.reduce((sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring), 0)
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + planarArea({ type: 'Polygon', coordinates: polygon }), 0)
  }
  if (geometry.type === 'GeometryCollection') return geometry.geometries.reduce((sum, child) => sum + planarArea(child), 0)
  return 0
}

/** Planar length of lines, or perimeter (all rings) of polygons, in a projected system. */
function planarLength(geometry: Geometry): number {
  switch (geometry.type) {
    case 'LineString': return pathLength(geometry.coordinates)
    case 'MultiLineString':
    case 'Polygon': return geometry.coordinates.reduce((sum, path) => sum + pathLength(path), 0)
    case 'MultiPolygon': return geometry.coordinates.flat().reduce((sum, path) => sum + pathLength(path), 0)
    case 'GeometryCollection': return geometry.geometries.reduce((sum, child) => sum + planarLength(child), 0)
    default: return 0
  }
}

const projectedSystems = coordinateSystems.filter((crs) => crs.kind === 'projected')

/**
 * Calculate Geometry: writes area, length/perimeter and centroid coordinates into
 * attribute fields. "Geodesic" measures on the Earth's curved surface; choosing a
 * projected coordinate system measures on that system's flat grid, as ArcGIS does.
 */
export const calculateGeometryTool: ToolboxTool = {
  id: 'calculate-geometry',
  name: 'Calculate Geometry Attributes',
  category: 'Data Management',
  subcategory: 'Fields',
  description: 'Compute area (m², km², dunums, hectares), length or perimeter (m, km) and centroid X/Y into new attribute fields.',
  keywords: ['area', 'length', 'perimeter', 'dunum', 'dunam', 'hectare', 'square meters', 'kilometers', 'measure', 'coordinates', 'x y'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    {
      id: 'areaUnit', label: 'Area (polygons)', kind: 'select', defaultValue: 'sqm',
      options: [
        { value: 'none', label: 'Do not calculate area' },
        ...Object.entries(areaUnits).map(([value, unit]) => ({ value, label: unit.label })),
        { value: 'all', label: 'All area units (m², km², dunums, ha)' },
      ],
    },
    {
      id: 'lengthUnit', label: 'Length (lines) / perimeter (polygons)', kind: 'select', defaultValue: 'm',
      options: [
        { value: 'none', label: 'Do not calculate length' },
        ...Object.entries(lengthUnits).map(([value, unit]) => ({ value, label: unit.label })),
        { value: 'all', label: 'Both meters and kilometers' },
      ],
    },
    {
      id: 'coordinates', label: 'Centroid coordinates', kind: 'select', defaultValue: 'no',
      options: [{ value: 'no', label: 'Do not add X / Y fields' }, { value: 'yes', label: 'Add CENTROID_X and CENTROID_Y' }],
    },
    {
      id: 'method', label: 'Measurement method / coordinate system', kind: 'select', defaultValue: 'geodesic',
      options: [
        { value: 'geodesic', label: 'Geodesic — true ground measure (X/Y in WGS 84)' },
        ...projectedSystems.map((crs) => ({ value: crs.code, label: `Planar in ${crs.name} (${crs.code})` })),
      ],
    },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const areaChoice = getOptionalText(parameters, 'areaUnit') || 'sqm'
    const lengthChoice = getOptionalText(parameters, 'lengthUnit') || 'm'
    const withCoordinates = getOptionalText(parameters, 'coordinates') === 'yes'
    const method = getOptionalText(parameters, 'method') || 'geodesic'
    const crs = method === 'geodesic' ? null : requireCrs(method)

    const hasPolygons = layer.data.features.some(isPolygon)
    const hasLines = layer.data.features.some(isLine)
    const selectedAreas = (areaChoice === 'all' ? Object.keys(areaUnits) : areaChoice === 'none' ? [] : [areaChoice]) as AreaUnit[]
    const selectedLengths = (lengthChoice === 'all' ? Object.keys(lengthUnits) : lengthChoice === 'none' ? [] : [lengthChoice]) as LengthUnit[]
    const areaFields = hasPolygons ? selectedAreas : []
    const lengthFields = hasPolygons || hasLines ? selectedLengths : []
    // ArcGIS convention: PERIM_* for polygon layers, LENGTH_* for line layers.
    const lengthPrefix = hasPolygons && !hasLines ? 'PERIM' : 'LENGTH'
    if (!areaFields.length && !lengthFields.length && !withCoordinates) {
      throw new Error(hasPolygons || hasLines
        ? 'Choose at least one geometry property to calculate.'
        : 'Point layers have no area or length. Enable centroid coordinates to add X / Y fields.')
    }

    let failed = 0
    const features = layer.data.features.map((feature) => {
      const properties: Record<string, unknown> = { ...(feature.properties ?? {}) }
      const assign = (squareMeters: number | null, meters: number | null, xy: Position | null) => {
        for (const unit of areaFields) {
          properties[areaUnits[unit].field] = squareMeters === null ? null : round(squareMeters * areaUnits[unit].perSquareMeter, areaUnits[unit].digits)
        }
        for (const unit of lengthFields) {
          properties[`${lengthPrefix}_${lengthUnits[unit].suffix}`] = meters === null ? null : round(meters * lengthUnits[unit].perMeter, lengthUnits[unit].digits)
        }
        if (withCoordinates) {
          properties.CENTROID_X = xy ? round(xy[0], crs ? 3 : 7) : null
          properties.CENTROID_Y = xy ? round(xy[1], crs ? 3 : 7) : null
        }
      }
      if (!feature.geometry) {
        assign(null, null, null)
        return { ...feature, properties }
      }
      const measured = feature as Feature<Geometry>
      try {
        const polygon = isPolygon(measured)
        const measurable = polygon || isLine(measured)
        const center = withCoordinates ? centroid(measured).geometry.coordinates : null
        if (crs) {
          const projected = areaFields.length || lengthFields.length ? transformGeometry(measured.geometry, WGS84, crs.code) : null
          assign(
            projected && polygon ? planarArea(projected) : null,
            projected && measurable ? planarLength(projected) : null,
            center ? projectPosition(WGS84, crs.code, [center[0], center[1]]) : null,
          )
        } else {
          assign(
            polygon ? area(measured) : null,
            measurable ? length(measured, { units: 'kilometers' }) * 1000 : null,
            center,
          )
        }
      } catch {
        failed += 1
        assign(null, null, null)
      }
      return { ...feature, properties }
    })

    const written = [
      ...areaFields.map((unit) => areaUnits[unit].field),
      ...lengthFields.map((unit) => `${lengthPrefix}_${lengthUnits[unit].suffix}`),
      ...(withCoordinates ? ['CENTROID_X', 'CENTROID_Y'] : []),
    ]
    const existing = fieldNames(layer)
    return {
      message: `Calculated ${written.join(', ')} for ${features.length.toLocaleString()} features in ${layer.name} (${crs ? `planar, ${crs.name}` : 'geodesic'}).${failed ? ` ${failed} features could not be measured and were left empty.` : ''}`,
      kind: failed ? 'warning' : 'success',
      updates: [{
        layerId: layer.id,
        updates: {
          data: { ...layer.data, features },
          customFields: [...layer.customFields, ...written.filter((field) => !existing.includes(field))],
        },
      }],
    }
  },
}
