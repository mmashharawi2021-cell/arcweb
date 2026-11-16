import area from '@turf/area'
import { featureCollection, polygon as turfPolygon } from '@turf/helpers'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPolygon } from '../spatial'
import type { ToolboxTool } from '../types'
import { closeRing, optionalNumber, outputNameParameter, polygonsToGeometry } from './_utils'

const ringArea = (ring: Position[]) => {
  const closed = closeRing(ring)
  return closed ? area(turfPolygon([closed])) : 0
}

/** Eliminate Polygon Part: removes small holes (and optionally small separate parts) from polygons. */
export const eliminatePolygonPartTool: ToolboxTool = {
  id: 'eliminate-polygon-part',
  name: 'Eliminate Polygon Part',
  category: 'Data Management',
  subcategory: 'Features',
  description: 'Fill holes (and optionally drop parts) smaller than an area in square metres or a percentage of the feature\'s total outer area.',
  keywords: ['holes', 'gaps', 'slivers', 'fill', 'donut', 'clean', 'parts'],
  parameters: [
    { id: 'target', label: 'Input polygon layer', kind: 'layer', required: true },
    {
      id: 'condition', label: 'Condition', kind: 'select', defaultValue: 'AREA',
      options: [
        { value: 'AREA', label: 'Area — smaller than the area' },
        { value: 'PERCENT', label: 'Percent — smaller than the percentage of total outer area' },
        { value: 'AREA_AND_PERCENT', label: 'Area and percent — both must be smaller' },
        { value: 'AREA_OR_PERCENT', label: 'Area or percent — either is smaller' },
      ],
    },
    { id: 'area', label: 'Area (m²)', kind: 'number', min: 0, defaultValue: 1000 },
    { id: 'percent', label: 'Percentage (0–100)', kind: 'number', min: 0, max: 100, defaultValue: 5 },
    {
      id: 'partOption', label: 'Eliminate', kind: 'select', defaultValue: 'CONTAINED_ONLY',
      options: [
        { value: 'CONTAINED_ONLY', label: 'Contained only — fill small holes' },
        { value: 'ANY', label: 'Any — also drop small separate parts (the largest part is kept)' },
      ],
    },
    outputNameParameter('Eliminated layer'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const condition = getOptionalText(parameters, 'condition') || 'AREA'
    const areaLimit = optionalNumber(parameters, 'area', 'area') ?? 0
    const percentLimit = optionalNumber(parameters, 'percent', 'percentage') ?? 0
    if (areaLimit < 0 || percentLimit < 0 || percentLimit > 100) throw new Error('Area must be ≥ 0 and percentage between 0 and 100.')
    const needsArea = condition === 'AREA' || condition === 'AREA_AND_PERCENT'
    const needsPercent = condition === 'PERCENT' || condition === 'AREA_AND_PERCENT'
    if ((needsArea && areaLimit === 0) || (needsPercent && percentLimit === 0) || (condition === 'AREA_OR_PERCENT' && areaLimit === 0 && percentLimit === 0)) {
      throw new Error('Enter a threshold greater than zero.')
    }
    const any = getOptionalText(parameters, 'partOption') === 'ANY'
    const polygons = layer.data.features.filter(isPolygon)
    assertHasFeatures(polygons, 'Eliminate Polygon Part needs a polygon layer.')

    let removedHoles = 0
    let removedParts = 0
    const features: Feature[] = layer.data.features.map((feature) => {
      if (!isPolygon(feature)) return { type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry: feature.geometry }
      const parts = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
      const outerAreas = parts.map((rings) => ringArea(rings[0]))
      const total = outerAreas.reduce((sum, value) => sum + value, 0)
      const small = (value: number) => {
        const byArea = value < areaLimit
        const byPercent = total > 0 && (value / total) * 100 < percentLimit
        return condition === 'AREA' ? byArea : condition === 'PERCENT' ? byPercent : condition === 'AREA_AND_PERCENT' ? byArea && byPercent : byArea || byPercent
      }
      const largest = outerAreas.indexOf(Math.max(...outerAreas))
      const kept = parts.flatMap((rings, index) => {
        if (any && index !== largest && small(outerAreas[index])) { removedParts += 1; return [] }
        const holes = rings.slice(1).filter((ring) => {
          const remove = small(ringArea(ring))
          if (remove) removedHoles += 1
          return !remove
        })
        return [[rings[0], ...holes]]
      })
      return { type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry: polygonsToGeometry(kept) as Geometry }
    })
    const output = outputLayer(getOptionalText(parameters, 'outputName') || `${layer.name} Eliminate`, featureCollection(features as Feature<Geometry>[]), layer.sourceCrs)
    return {
      message: `${output.name}: filled ${removedHoles.toLocaleString()} holes${any ? ` and removed ${removedParts.toLocaleString()} parts` : ''}.`,
      layers: [output],
    }
  },
}
