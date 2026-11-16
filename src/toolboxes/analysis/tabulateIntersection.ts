import area from '@turf/area'
import length from '@turf/length'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getOptionalText, getText } from '../shared'
import { assertHasFeatures, isLine, isPoint, isPolygon, makeSpatialIndex, pairBudget, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import {
  compareValues, downloadParameter, intersectPolygons, outputName, outputNameParameter, overlayGeometry, resolveField, round,
  tableResult, type Row,
} from './_utils'

type ClassKind = 'polygon' | 'line' | 'point'

function measureOf(kind: ClassKind, geometry: Geometry): number {
  if (kind === 'polygon') return area(geometry)
  if (kind === 'line') return length({ type: 'Feature', properties: {}, geometry }, { units: 'kilometers' }) * 1000
  return geometry.type === 'MultiPoint' ? geometry.coordinates.length : 1
}

/**
 * Tabulate Intersection: for each zone, the area (m²), length (m) or count of class
 * features that fall inside it, per class value, with PERCENTAGE: for polygon classes the
 * share of the zone area, for lines/points the share of all class length/count in the zone.
 */
export const tabulateIntersectionTool: ToolboxTool = {
  id: 'tabulate-intersection',
  name: 'Tabulate Intersection',
  category: 'Analysis',
  subcategory: 'Statistics',
  description: 'Cross-tabulate the area, length or count of class features inside each zone polygon, with percentages.',
  keywords: ['cross tabulate', 'zonal', 'area', 'percentage', 'land use', 'statistics', 'overlay'],
  parameters: [
    { id: 'zones', label: 'Input zone features (polygons)', kind: 'layer', required: true },
    { id: 'zoneField', label: 'Zone field', kind: 'field', layerParameter: 'zones', required: true },
    { id: 'classes', label: 'Input class features', kind: 'layer', required: true },
    { id: 'classField', label: 'Class field (optional)', kind: 'field', layerParameter: 'classes', allowEmpty: true },
    downloadParameter,
    outputNameParameter('Tabulate intersection'),
  ],
  execute: (context, parameters) => {
    const zoneLayer = getLayer(context, parameters, 'zones')
    const classLayer = getLayer(context, parameters, 'classes')
    const zoneField = resolveField(zoneLayer, getText(parameters, 'zoneField', 'a zone field'))
    const classText = getOptionalText(parameters, 'classField')
    const classField = classText ? resolveField(classLayer, classText) : ''
    const zones = zoneLayer.data.features.filter(isPolygon)
    assertHasFeatures(zones, 'The zone layer must contain polygon features.')
    const classes = usableFeatures(classLayer)
    assertHasFeatures(classes, 'The class layer has no usable geometries.')
    const kind: ClassKind = classes.every(isPolygon) ? 'polygon' : classes.every(isLine) ? 'line' : classes.every(isPoint) ? 'point' : (() => {
      throw new Error('The class layer must contain a single geometry type (polygons, lines or points).')
    })()
    const measureField = kind === 'polygon' ? 'AREA' : kind === 'line' ? 'LENGTH' : 'PNT_COUNT'

    const zoneKey = (feature: Feature) => feature.properties?.[zoneField] ?? null
    const zoneArea = new Map<unknown, number>()
    for (const zone of zones) zoneArea.set(zoneKey(zone), (zoneArea.get(zoneKey(zone)) ?? 0) + area(zone))

    const index = makeSpatialIndex(classes)
    const spend = pairBudget('Tabulate Intersection')
    // zone value -> class value -> measure
    const totals = new Map<unknown, Map<unknown, number>>()
    for (const zone of zones) {
      const candidates = index.search(zone)
      spend(candidates.length)
      for (const item of candidates) {
        const geometry = kind === 'polygon' && isPolygon(item) ? intersectPolygons(item, zone) : overlayGeometry(item, [zone], 'inside')
        if (!geometry) continue
        const measure = measureOf(kind, geometry)
        if (!(measure > 0)) continue
        const byClass = totals.get(zoneKey(zone)) ?? new Map<unknown, number>()
        const classValue = classField ? item.properties?.[classField] ?? null : null
        byClass.set(classValue, (byClass.get(classValue) ?? 0) + measure)
        totals.set(zoneKey(zone), byClass)
      }
    }

    const rows: Row[] = []
    for (const [zoneValue, byClass] of [...totals.entries()].sort(([a], [b]) => compareValues(a, b))) {
      const zoneTotal = kind === 'polygon' ? zoneArea.get(zoneValue) ?? 0 : [...byClass.values()].reduce((sum, value) => sum + value, 0)
      for (const [classValue, measure] of [...byClass.entries()].sort(([a], [b]) => compareValues(a, b))) {
        rows.push({
          [zoneField]: zoneValue,
          ...(classField ? { [classField]: classValue } : {}),
          [measureField]: kind === 'point' ? measure : round(measure, 3),
          PERCENTAGE: zoneTotal > 0 ? round((measure / zoneTotal) * 100, 6) : 0,
        })
      }
    }
    assertHasFeatures(rows, 'No class features intersect the zones.')
    const fields = [zoneField, ...(classField && classField !== zoneField ? [classField] : []), measureField, 'PERCENTAGE']
    const { layer, downloads } = tableResult(parameters, outputName(parameters, `${zoneLayer.name} TabulateIntersection`), rows, fields)
    return {
      message: `${layer.name}: ${rows.length.toLocaleString()} zone/class rows (${measureField}${kind === 'polygon' ? ' in square meters' : kind === 'line' ? ' in meters' : ''}).`,
      layers: [layer],
      downloads,
    }
  },
}
