import type * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, Geometry, Position } from 'geojson'
import { getLayerIds, getRenderedFeatureLayerIds } from './mapRendering'
import type { FeatureId, FeatureSelection, MapLayer } from './store'

/** Distance label for the measure tool: metres below 1 km, kilometres above. */
export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

export function distanceBetween(a: [number, number], b: [number, number]) {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const [lat1, lat2] = [radians(a[1]), radians(b[1])]
  const deltaLat = lat2 - lat1
  const deltaLon = radians(b[0] - a[0])
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function polygonArea(points: [number, number][]) {
  if (points.length < 3) return 0
  const radius = 6371008.8
  let total = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    total += (next[0] - current[0]) * Math.PI / 180 *
      (2 + Math.sin(current[1] * Math.PI / 180) + Math.sin(next[1] * Math.PI / 180))
  }
  return Math.abs(total * radius * radius / 2)
}

export function getPositions(value: unknown, path: number[] = [], result: { coordinate: Position; path: number[] }[] = []) {
  if (!Array.isArray(value)) return result
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    result.push({ coordinate: value as Position, path })
    return result
  }
  value.forEach((child, index) => getPositions(child, [...path, index], result))
  return result
}

export function snapCoordinate(
  map: MapLibreMap,
  event: maplibregl.MapMouseEvent,
  layers: MapLayer[],
  exclude?: FeatureSelection | null,
  /** Snap only to vertices within this many screen pixels. */
  tolerancePx = 10,
): [number, number] {
  const renderedLayers = getRenderedFeatureLayerIds(map, layers)
  if (!renderedLayers.length) return [event.lngLat.lng, event.lngLat.lat]
  const point = event.point
  const rendered = map.queryRenderedFeatures([
    [point.x - tolerancePx, point.y - tolerancePx],
    [point.x + tolerancePx, point.y + tolerancePx],
  ], { layers: renderedLayers })
  let closest: { coordinate: Position; distance: number } | null = null
  for (const candidate of rendered) {
    if (!candidate.geometry) continue
    const candidateLayer = layers.find((layer) => getLayerIds(layer.id).source === candidate.source)
    if (exclude && candidateLayer?.id === exclude.layerId && candidate.id === exclude.featureId) continue
    if (!('coordinates' in candidate.geometry)) continue
    for (const vertex of getPositions(candidate.geometry.coordinates)) {
      const projected = map.project([vertex.coordinate[0], vertex.coordinate[1]])
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
      if (distance <= tolerancePx && (!closest || distance < closest.distance)) closest = { coordinate: vertex.coordinate, distance }
    }
  }
  return closest
    ? [closest.coordinate[0], closest.coordinate[1]]
    : [event.lngLat.lng, event.lngLat.lat]
}

/** Every feature drawn within a few pixels of `point` (the tolerance makes points and thin lines easy to hit). */
export function queryFeaturesAt(map: MapLibreMap, point: { x: number; y: number }, layers: MapLayer[]): FeatureSelection[] {
  const visibleLayerIds = getRenderedFeatureLayerIds(map, layers)
  if (!visibleLayerIds.length) return []
  const rendered = map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers: visibleLayerIds })
  const hits: FeatureSelection[] = []
  for (const candidate of rendered) {
    const layer = layers.find((item) => getLayerIds(item.id).source === candidate.source)
    if (!layer || candidate.id === undefined) continue
    // A feature drawn across several tiles is reported once per tile.
    if (!hits.some((hit) => hit.layerId === layer.id && hit.featureId === candidate.id)) {
      hits.push({ layerId: layer.id, featureId: candidate.id as FeatureId })
    }
  }
  return hits
}

export function nearestVertexPath(map: MapLibreMap, feature: Feature<Geometry>, position: maplibregl.Point) {
  if (feature.geometry.type === 'GeometryCollection') return null
  let nearest: { path: number[]; distance: number } | null = null
  for (const vertex of getPositions(feature.geometry.coordinates)) {
    const projected = map.project([vertex.coordinate[0], vertex.coordinate[1]])
    const distance = Math.hypot(projected.x - position.x, projected.y - position.y)
    if (!nearest || distance < nearest.distance) nearest = { path: vertex.path, distance }
  }
  return nearest && nearest.distance <= 18 ? nearest : null
}

export function replaceCoordinate(value: unknown, path: number[], coordinate: [number, number]): unknown {
  if (!path.length) return coordinate
  if (!Array.isArray(value)) return value
  const [index, ...remaining] = path
  const copy = [...value]
  copy[index] = replaceCoordinate(copy[index], remaining, coordinate)
  return copy
}

export function createSketchFeature(layer: MapLayer, geometry: Geometry) {
  const properties = Object.fromEntries((layer.customFields ?? []).map((field) => [field, '']))
  return {
    type: 'Feature' as const,
    id: `${layer.id}:${crypto.randomUUID()}`,
    properties,
    geometry,
  }
}
