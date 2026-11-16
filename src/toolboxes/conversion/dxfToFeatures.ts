import { isolate } from '../../bidi'
import type { Feature, Geometry, Position } from 'geojson'
import { getFile, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'

type Pair = { code: number; value: string }
type Entity = { type: string; pairs: Pair[] }

function parsePairs(text: string): Pair[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines.length < 2) throw new Error('The DXF file is empty or malformed.')
  if (lines.length % 2 === 0 && lines.at(-1)?.trim() === '') lines.pop()
  if (lines.length % 2 !== 0) throw new Error('The DXF file has an incomplete group-code pair.')
  const pairs: Pair[] = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim())
    if (!Number.isInteger(code)) throw new Error(`Invalid DXF group code on line ${index + 1}.`)
    pairs.push({ code, value: lines[index + 1].trim() })
  }
  return pairs
}

function entitiesFrom(pairs: Pair[]): Entity[] {
  const entities: Entity[] = []
  let inEntities = false
  let current: Entity | undefined
  for (let index = 0; index < pairs.length; index += 1) {
    const item = pairs[index]
    if (item.code === 0 && item.value === 'SECTION' && pairs[index + 1]?.code === 2) {
      inEntities = pairs[index + 1].value.toUpperCase() === 'ENTITIES'
      index += 1
      continue
    }
    if (!inEntities) continue
    if (item.code === 0 && item.value === 'ENDSEC') {
      if (current) entities.push(current)
      current = undefined
      inEntities = false
      continue
    }
    if (item.code === 0) {
      if (current) entities.push(current)
      current = { type: item.value.toUpperCase(), pairs: [] }
    } else if (current) current.pairs.push(item)
  }
  return entities
}

const values = (entity: Entity, code: number) => entity.pairs.filter((item) => item.code === code).map((item) => item.value)
const value = (entity: Entity, code: number, fallback = '') => values(entity, code)[0] ?? fallback
const number = (entity: Entity, code: number, fallback = 0) => {
  const parsed = Number(value(entity, code))
  return Number.isFinite(parsed) ? parsed : fallback
}
const coordinate = (x: number, y: number, z?: number): Position => z === undefined ? [x, y] : [x, y, z]

function polylineVertices(entity: Entity, following: Entity[]): Position[] {
  const result = [...values(entity, 10)].map((xText, index) => coordinate(
    Number(xText), Number(values(entity, 20)[index]),
    values(entity, 30)[index] === undefined ? undefined : Number(values(entity, 30)[index]),
  ))
  for (const vertex of following) {
    if (vertex.type !== 'VERTEX') break
    result.push(coordinate(number(vertex, 10), number(vertex, 20), values(vertex, 30).length ? number(vertex, 30) : undefined))
  }
  return result
}

function attributes(entity: Entity): Record<string, unknown> {
  const marker = entity.pairs.findIndex((item) => item.code === 1001 && item.value === 'ARCWEB')
  if (marker < 0) return {}
  const encoded = entity.pairs.slice(marker + 1).filter((item) => item.code === 1000).map((item) => item.value).join('')
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(encoded))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function arcPoints(cx: number, cy: number, radius: number, start: number, end: number): Position[] {
  let sweep = end - start
  if (sweep <= 0) sweep += 360
  const segments = Math.max(8, Math.ceil(sweep / 10))
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = ((start + sweep * index / segments) * Math.PI) / 180
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  })
}

/** Parse common 2D DXF entities (POINT, LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC). */
export function parseDxf(text: string): { features: Feature<Geometry>[]; unsupported: number } {
  const entities = entitiesFrom(parsePairs(text))
  const features: Feature<Geometry>[] = []
  let unsupported = 0
  entities.forEach((entity, index) => {
    if (entity.type === 'VERTEX' || entity.type === 'SEQEND') return
    let geometry: Geometry | null = null
    if (entity.type === 'POINT') geometry = { type: 'Point', coordinates: coordinate(number(entity, 10), number(entity, 20), values(entity, 30).length ? number(entity, 30) : undefined) }
    else if (entity.type === 'LINE') geometry = { type: 'LineString', coordinates: [coordinate(number(entity, 10), number(entity, 20), values(entity, 30).length ? number(entity, 30) : undefined), coordinate(number(entity, 11), number(entity, 21), values(entity, 31).length ? number(entity, 31) : undefined)] }
    else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const followers: Entity[] = []
      for (let next = index + 1; next < entities.length && ['VERTEX', 'SEQEND'].includes(entities[next].type); next += 1) followers.push(entities[next])
      const coordinates = polylineVertices(entity, followers)
      const closed = (number(entity, 70) & 1) !== 0
      if (coordinates.length >= 2 && coordinates.every((position) => position.every(Number.isFinite))) {
        if (closed && coordinates.length >= 3) {
          if (coordinates[0][0] !== coordinates[coordinates.length - 1][0] || coordinates[0][1] !== coordinates[coordinates.length - 1][1]) coordinates.push(coordinates[0])
          geometry = { type: 'Polygon', coordinates: [coordinates] }
        } else geometry = { type: 'LineString', coordinates }
      }
    } else if (entity.type === 'CIRCLE') {
      const coords = arcPoints(number(entity, 10), number(entity, 20), number(entity, 40), 0, 360)
      coords[coords.length - 1] = coords[0]
      geometry = { type: 'Polygon', coordinates: [coords] }
    } else if (entity.type === 'ARC') {
      geometry = { type: 'LineString', coordinates: arcPoints(number(entity, 10), number(entity, 20), number(entity, 40), number(entity, 50), number(entity, 51)) }
    }
    if (geometry) features.push({ type: 'Feature', properties: {
      ...attributes(entity), LAYER: value(entity, 8, '0'), ENTITY: entity.type, DXF_ID: value(entity, 5, String(features.length + 1)),
    }, geometry })
    else unsupported += 1
  })
  if (!features.length) throw new Error('The DXF contains no supported entities.')
  return { features, unsupported }
}

export const dxfToFeaturesTool: ToolboxTool = {
  id: 'dxf-to-features',
  name: 'DXF To Features',
  category: 'Conversion',
  subcategory: 'From/To Files',
  description: 'Read common 2D DXF entities into a feature layer. DXF coordinates are assumed to be WGS 84.',
  keywords: ['dxf', 'cad', 'autocad', 'import', 'features'],
  parameters: [
    { id: 'file', label: 'Input DXF file', kind: 'file', required: true, accept: '.dxf' },
    { id: 'outputName', label: 'Output layer name', kind: 'text', placeholder: 'DXF features' },
  ],
  execute: async (_context, parameters) => {
    const file = getFile(parameters, 'file', 'DXF')
    const { features, unsupported } = parseDxf(await file.text())
    const output = outputLayer(getOptionalText(parameters, 'outputName') || file.name.replace(/\.dxf$/i, '') || 'DXF features', { type: 'FeatureCollection', features })
    output.customFields = ['LAYER', 'ENTITY', 'DXF_ID']
    return {
      message: `${isolate(output.name)}: imported ${features.length} entities. DXF has no embedded CRS; coordinates are assumed to be WGS 84.${unsupported ? ` Skipped ${unsupported} unsupported entities.` : ''}`,
      kind: 'warning',
      layers: [output],
    }
  },
}
