import { isolate } from '../../bidi'
import type { Geometry, Position } from 'geojson'
import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { exportableFeatures, safeName } from './_utils'

type DxfPair = [number, string | number]

const pair = (code: number, value: string | number): DxfPair => [code, value]
const pointPairs = (position: Position): DxfPair[] => [
  pair(10, position[0]), pair(20, position[1]), ...(position[2] === undefined ? [] : [pair(30, position[2])]),
]

function withAttributes(entity: DxfPair[], properties: Record<string, unknown>): DxfPair[] {
  const encoded = encodeURIComponent(JSON.stringify(properties))
  const chunks = encoded.match(/.{1,240}/g) ?? []
  return [...entity, pair(1001, 'ARCWEB'), ...chunks.map((chunk) => pair(1000, chunk))]
}

function lineEntity(start: Position, end: Position, layer: string, properties: Record<string, unknown>): DxfPair[] {
  return withAttributes([pair(0, 'LINE'), pair(8, layer), ...pointPairs(start), ...pointPairs(end).map(([code, value]) => [code === 10 ? 11 : code === 20 ? 21 : code === 30 ? 31 : code, value] as DxfPair)], properties)
}

function geometryEntities(geometry: Geometry, layer: string, properties: Record<string, unknown>): DxfPair[][] {
  switch (geometry.type) {
    case 'Point': return [withAttributes([pair(0, 'POINT'), pair(8, layer), ...pointPairs(geometry.coordinates)], properties)]
    case 'MultiPoint': return geometry.coordinates.map((position) => geometryEntities({ type: 'Point', coordinates: position }, layer, properties)[0])
    case 'LineString': return geometry.coordinates.length > 1
      ? geometry.coordinates.slice(1).map((position, index) => lineEntity(geometry.coordinates[index], position, layer, properties)) : []
    case 'MultiLineString': return geometry.coordinates.flatMap((line) => geometryEntities({ type: 'LineString', coordinates: line }, layer, properties))
    case 'Polygon':
    case 'MultiPolygon': {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
      return polygons.flatMap((rings) => rings.filter((ring) => ring.length >= 4).map((ring) => withAttributes([
        pair(0, 'LWPOLYLINE'), pair(8, layer), pair(90, ring.length - 1), pair(70, 1),
        ...ring.slice(0, -1).flatMap((position) => [pair(10, position[0]), pair(20, position[1])]),
      ], properties)))
    }
    case 'GeometryCollection': return geometry.geometries.flatMap((child) => geometryEntities(child, layer, properties))
  }
}

/** Build an ASCII DXF R2000 file. Coordinates are written in the layer's WGS 84 map coordinates. */
export function buildDxf(layerName: string, features: ReturnType<typeof exportableFeatures>): ToolDownload {
  const entities = features.flatMap((feature) => feature.geometry ? geometryEntities(feature.geometry, '0', feature.properties ?? {}) : [])
  if (!entities.length) throw new Error('The selected layer has no supported features with geometry to export.')
  const body = [
    pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$ACADVER'), pair(1, 'AC1015'), pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'TABLES'), pair(0, 'TABLE'), pair(2, 'APPID'), pair(70, 1),
    pair(0, 'APPID'), pair(2, 'ARCWEB'), pair(70, 0), pair(0, 'ENDTAB'), pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'ENTITIES'), ...entities.flat(), pair(0, 'ENDSEC'), pair(0, 'EOF'),
  ].map(([code, value]) => `${code}\r\n${value}`).join('\r\n')
  return {
    fileName: `${safeName(layerName)}.dxf`,
    blob: new Blob([body], { type: 'application/dxf;charset=utf-8' }),
  }
}

export const featuresToDxfTool: ToolboxTool = {
  id: 'features-to-dxf',
  name: 'Features To DXF',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export points, lines and polygon boundaries to an ASCII DXF drawing.',
  keywords: ['dxf', 'cad', 'autocad', 'export', 'features'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Layer name' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const result = buildDxf(getOptionalText(parameters, 'fileName') || layer.name, exportableFeatures(layer))
    return { message: `Prepared ${isolate(result.fileName)} in WGS 84 coordinates.`, downloads: [result] }
  },
}
