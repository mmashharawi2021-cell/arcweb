import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { crsSelectOptions, isInsideAreaOfUse, requireCrs, transformGeometry, WGS84 } from '../../crs'
import { getCollectionBounds } from '../../geo'
import { getLayer, getOptionalText, getText, outputLayer } from '../shared'
import { assertHasFeatures, usableFeatures } from '../spatial'
import type { ToolboxTool, ToolDownload } from '../types'

function roundCoordinates(geometry: Geometry, digits: number): Geometry {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((child) => roundCoordinates(child, digits)) }
  }
  const walk = (value: unknown): unknown => Array.isArray(value)
    ? value.map(walk)
    : typeof value === 'number' ? Number(value.toFixed(digits)) : value
  return { ...geometry, coordinates: walk(geometry.coordinates) } as Geometry
}

function projectedGeoJson(name: string, code: string, features: Feature[]): ToolDownload {
  const epsg = code.replace('EPSG:', '')
  const data: FeatureCollection & { name: string; crs: { type: 'name'; properties: { name: string } } } = {
    type: 'FeatureCollection',
    name,
    crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${epsg}` } },
    features,
  }
  const safeName = name.trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '_') || 'projected_output'
  return {
    fileName: `${safeName}_EPSG-${epsg}.geojson`,
    blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json;charset=utf-8' }),
  }
}

/**
 * Project: reprojects a layer into another coordinate system. The reprojected
 * coordinates are exported as a CRS-tagged GeoJSON; the copy added to the map keeps
 * WGS 84 geometry for rendering but records the output system as its spatial reference.
 */
export const projectTool: ToolboxTool = {
  id: 'project',
  name: 'Project',
  category: 'Data Management',
  subcategory: 'Projections',
  description: 'Reproject a layer to another coordinate system (WGS 84, Web Mercator, UTM, Palestine 1923 Grid, Israeli TM Grid) and export it.',
  keywords: ['coordinate system', 'crs', 'reproject', 'utm', 'epsg', 'transform', 'palestine grid', 'israeli tm', 'itm', 'web mercator', 'projection'],
  parameters: [
    { id: 'target', label: 'Input layer', kind: 'layer', required: true },
    { id: 'targetCrs', label: 'Output coordinate system', kind: 'select', required: true, defaultValue: 'EPSG:32636', options: crsSelectOptions },
    {
      id: 'output', label: 'Output', kind: 'select', defaultValue: 'both',
      options: [
        { value: 'both', label: 'Download GeoJSON and add layer to map' },
        { value: 'download', label: 'Download projected GeoJSON only' },
        { value: 'map', label: 'Add projected layer to map only' },
      ],
    },
    { id: 'outputName', label: 'Output name', kind: 'text', placeholder: 'Projected output' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const crs = requireCrs(getText(parameters, 'targetCrs', 'an output coordinate system'))
    const mode = getOptionalText(parameters, 'output') || 'both'
    const source = usableFeatures(layer)
    assertHasFeatures(source, 'The input layer has no features with geometry to project.')

    const digits = crs.unit === 'degree' ? 9 : 4
    const projected: Feature[] = source.map((feature) => ({
      type: 'Feature',
      properties: { ...(feature.properties ?? {}) },
      geometry: roundCoordinates(transformGeometry(feature.geometry, WGS84, crs.code), digits),
    }))

    const name = getOptionalText(parameters, 'outputName') || `${layer.name} ${crs.code.replace(':', ' ')}`
    const bounds = getCollectionBounds([layer.data])
    const outside = bounds !== null && !(isInsideAreaOfUse(crs, bounds[0], bounds[1]) && isInsideAreaOfUse(crs, bounds[2], bounds[3]))
    const layers = mode === 'download' ? [] : [outputLayer(name, {
      type: 'FeatureCollection',
      features: source.map((feature) => ({ type: 'Feature', properties: { ...(feature.properties ?? {}) }, geometry: feature.geometry })),
    }, crs.code)]
    const downloads = mode === 'map' ? [] : [projectedGeoJson(name, crs.code, projected)]
    return {
      message: `Projected ${projected.length.toLocaleString()} features to ${crs.name} (${crs.code}).${outside ? ` Warning: the layer extends beyond this system's area of use (${crs.areaOfUse}); coordinates there are distorted.` : ''}`,
      kind: outside ? 'warning' : 'success',
      layers,
      downloads,
    }
  },
}
