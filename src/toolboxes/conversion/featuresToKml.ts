import { isolate } from '../../bidi'
import type { Geometry, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { getLayer, getOptionalText } from '../shared'
import type { ToolboxTool, ToolDownload } from '../types'
import { exportableFeatures, safeName, scalar, xmlEscape } from './_utils'

const coordinate = (position: Position) =>
  `${position[0]},${position[1]}${position[2] === undefined ? '' : `,${position[2]}`}`

const coordinates = (positions: Position[]) => `<coordinates>${positions.map(coordinate).join(' ')}</coordinates>`

const closeRing = (ring: Position[]) => {
  const [first, last] = [ring[0], ring[ring.length - 1]]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

function polygonKml(rings: Position[][]): string {
  const [outer, ...holes] = rings.filter((ring) => ring.length >= 3).map(closeRing)
  if (!outer) return ''
  const boundary = (ring: Position[], tag: string) => `<${tag}><LinearRing>${coordinates(ring)}</LinearRing></${tag}>`
  return `<Polygon>${boundary(outer, 'outerBoundaryIs')}${holes.map((hole) => boundary(hole, 'innerBoundaryIs')).join('')}</Polygon>`
}

const multi = (parts: string[]) => {
  const kept = parts.filter(Boolean)
  return kept.length ? `<MultiGeometry>${kept.join('')}</MultiGeometry>` : ''
}

/** KML 2.2 geometry markup; multi-part geometries become MultiGeometry. Empty parts are dropped. */
export function kmlGeometry(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point': return `<Point>${coordinates([geometry.coordinates])}</Point>`
    case 'MultiPoint': return multi(geometry.coordinates.map((position) => `<Point>${coordinates([position])}</Point>`))
    case 'LineString': return geometry.coordinates.length > 1 ? `<LineString>${coordinates(geometry.coordinates)}</LineString>` : ''
    case 'MultiLineString': return multi(geometry.coordinates.map((line) => kmlGeometry({ type: 'LineString', coordinates: line })))
    case 'Polygon': return polygonKml(geometry.coordinates)
    case 'MultiPolygon': return multi(geometry.coordinates.map(polygonKml))
    case 'GeometryCollection': return multi(geometry.geometries.map(kmlGeometry))
  }
}

/** `#rrggbb` to KML's `aabbggrr`. */
function kmlColor(hex: string, opacity: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const [r, g, b] = match ? [match[1].slice(0, 2), match[1].slice(2, 4), match[1].slice(4, 6)] : ['ff', 'a5', '00']
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')
  return `${alpha}${b}${g}${r}`.toLowerCase()
}

export function buildKmlDocument(layer: MapLayer, nameField?: string): { kml: string; count: number } {
  const placemarks: string[] = []
  exportableFeatures(layer).forEach((feature, index) => {
    if (!feature.geometry) return
    const geometry = kmlGeometry(feature.geometry)
    if (!geometry) return
    const properties = feature.properties ?? {}
    const title = (nameField ? properties[nameField] : undefined) ?? properties.name ?? properties.Name ?? properties.NAME ?? `${layer.name} ${index + 1}`
    const data = Object.entries(properties).map(([name, value]) =>
      `<Data name="${xmlEscape(name)}"><value>${xmlEscape(scalar(value))}</value></Data>`).join('')
    placemarks.push(`    <Placemark><name>${xmlEscape(scalar(title))}</name><styleUrl>#layerStyle</styleUrl>${data ? `<ExtendedData>${data}</ExtendedData>` : ''}${geometry}</Placemark>`)
  })
  const style = `    <Style id="layerStyle"><IconStyle><color>${kmlColor(layer.fillColor, 1)}</color></IconStyle>` +
    `<LineStyle><color>${kmlColor(layer.strokeColor, 1)}</color><width>${layer.strokeWidth}</width></LineStyle>` +
    `<PolyStyle><color>${kmlColor(layer.fillColor, layer.opacity * 0.6)}</color></PolyStyle></Style>`
  const kml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${xmlEscape(layer.name)}</name>`,
    style,
    ...placemarks,
    '  </Document>',
    '</kml>',
  ].join('\n')
  return { kml, count: placemarks.length }
}

export function buildKml(layer: MapLayer, nameField?: string, fileName?: string): ToolDownload {
  const { kml, count } = buildKmlDocument(layer, nameField)
  if (!count) throw new Error('The selected layer has no features with geometry to export.')
  return {
    fileName: `${safeName(fileName || layer.name)}.kml`,
    blob: new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }),
  }
}

export const featuresToKmlTool: ToolboxTool = {
  id: 'features-to-kml',
  name: 'Features To KML',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Export a layer to KML 2.2 for Google Earth, with attributes stored as ExtendedData.',
  keywords: ['kml', 'google earth', 'layer to kml', 'export', 'download', 'placemark'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'nameField', label: 'Placemark name field', kind: 'field', layerParameter: 'target', allowEmpty: true },
    { id: 'fileName', label: 'Output file name', kind: 'text', placeholder: 'Layer name' },
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const download = buildKml(layer, getOptionalText(parameters, 'nameField') || undefined, getOptionalText(parameters, 'fileName'))
    return { message: `Prepared ${isolate(download.fileName)}.`, downloads: [download] }
  },
}
