import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { FeatureId, FeatureSelection, MapLayer, RendererConfig } from './store'
import { labelTextExpression } from './symbology'

const sourceDataSnapshots = new WeakMap<MapLibreMap, Map<string, FeatureCollection>>()
const renderFeatureIdProperty = '__arcweb_feature_id'

function getRenderableData(data: FeatureCollection): FeatureCollection {
  return {
    ...data,
    features: data.features.filter((feature) => feature.geometry !== null).map((feature) => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), [renderFeatureIdProperty]: feature.id ?? '' },
    })),
  }
}

function hasRenderableGeometry(layer: MapLayer): boolean {
  return layer.geometry !== 'Unknown' && layer.data.features.some((feature) => feature.geometry !== null)
}

function hasPointFeatures(layer: MapLayer): boolean {
  return layer.data.features.some((feature) => feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint')
}

function colorExpression(renderer: RendererConfig, fallback: string): string | ExpressionSpecification {
  if (renderer.type === 'single') return fallback
  if (renderer.type === 'unique') {
    const categories = Object.entries(renderer.colors).flatMap(([value, color]) => [value, color])
    if (!categories.length) return fallback
    return ['match', ['to-string', ['get', renderer.field]], ...categories, fallback] as ExpressionSpecification
  }
  if (!renderer.breaks.length) return renderer.colors[0] ?? fallback
  const expression: unknown[] = ['step', ['to-number', ['get', renderer.field], 0], renderer.colors[0] ?? fallback]
  renderer.breaks.forEach((value, index) => {
    expression.push(value, renderer.colors[index + 1] ?? fallback)
  })
  return expression as ExpressionSpecification
}

export function getLayerIds(layerId: string) {
  const key = layerId.replace(/[^a-zA-Z0-9_-]/g, '-')
  return {
    source: `aw-layer-${key}`,
    fill: `aw-layer-${key}-fill`,
    line: `aw-layer-${key}-line`,
    point: `aw-layer-${key}-point`,
    pointMarker: `aw-layer-${key}-point-marker`,
    label: `aw-layer-${key}-label`,
    extrusion: `aw-layer-${key}-extrusion`,
  }
}

function lineDash(layer: MapLayer): number[] {
  if (layer.strokeDash === 'dashed') return [2, 1.5]
  if (layer.strokeDash === 'dotted') return [0.2, 1.6]
  return [1, 0]
}

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[previous]
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) inside = !inside
  }
  return inside
}

function segmentDistance(x: number, y: number, start: [number, number], end: [number, number]): number {
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]]
  const lengthSquared = dx * dx + dy * dy
  const projection = lengthSquared ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared)) : 0
  return Math.hypot(x - (start[0] + projection * dx), y - (start[1] + projection * dy))
}

function markerShapeDistance(shape: MapLayer['pointShape'], x: number, y: number): number {
  if (shape === 'circle') return 16 - Math.hypot(x - 24, y - 24)
  const points: [number, number][] = shape === 'square'
    ? [[8, 8], [40, 8], [40, 40], [8, 40]]
    : shape === 'triangle'
      ? [[24, 5], [43, 40], [5, 40]]
      : [[24, 5], [43, 24], [24, 43], [5, 24]]
  const distance = Math.min(...points.map((point, index) => segmentDistance(x, y, point, points[(index + 1) % points.length])))
  return pointInPolygon(x, y, points) ? distance : -distance
}

function ensureMarkerImage(map: MapLibreMap, shape: MapLayer['pointShape']): string {
  const id = `aw-marker-sdf-${shape}`
  if (map.hasImage(id)) return id
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create a canvas context for the point marker.')
  const image = context.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const signedDistance = markerShapeDistance(shape, x + 0.5, y + 0.5)
      const alpha = Math.max(0, Math.min(255, Math.round(128 + signedDistance * 16)))
      const offset = (y * canvas.width + x) * 4
      image.data[offset] = 255
      image.data[offset + 1] = 255
      image.data[offset + 2] = 255
      image.data[offset + 3] = alpha
    }
  }
  map.addImage(id, image, { sdf: true, pixelRatio: 2 })
  return id
}

function markerImageExpression(map: MapLibreMap, layer: MapLayer): string {
  return ensureMarkerImage(map, layer.pointShape)
}

const heightFieldNames = [
  'height', 'height_m', 'building_height', 'building_height_m', 'building:height',
  'levels', 'building:levels', 'num_levels', 'levels_count',
  'floors', 'floor_count', 'num_floors', 'storeys', 'stories',
]
const polygonHeightFieldCache = new WeakMap<MapLayer['data'], { field: string; multiplier: number } | null>()

function polygonHeightField(layer: MapLayer): { field: string; multiplier: number } | null {
  // An explicit choice (field or "off") wins over detection.
  if (layer.extrusion === null) return null
  if (layer.extrusion?.field) return layer.extrusion
  if (polygonHeightFieldCache.has(layer.data)) return polygonHeightFieldCache.get(layer.data) ?? null
  const fields = new Map<string, string>()
  for (const feature of layer.data.features) {
    if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue
    for (const name of Object.keys(feature.properties ?? {})) {
      if (!fields.has(name.toLowerCase())) fields.set(name.toLowerCase(), name)
    }
  }
  for (const candidate of heightFieldNames) {
    const field = fields.get(candidate.toLowerCase())
    if (!field) continue
    let plausible = false
    for (const feature of layer.data.features) {
      if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue
      const value = Number(feature.properties?.[field])
      const isLevels = /level|floor|stor/i.test(field)
      const limit = isLevels ? 300 : 2_000
      if (Number.isFinite(value) && value > 0 && value <= limit) { plausible = true; break }
    }
    if (plausible) {
      const result = { field, multiplier: /level|floor|stor/i.test(field) ? 3.2 : 1 }
      polygonHeightFieldCache.set(layer.data, result)
      return result
    }
  }
  polygonHeightFieldCache.set(layer.data, null)
  return null
}

function updateExtrusion(map: MapLibreMap, layer: MapLayer, sceneView: boolean) {
  const ids = getLayerIds(layer.id)
  const height = layer.geometry === 'Polygon' || layer.geometry === 'Mixed' ? polygonHeightField(layer) : null
  if (!sceneView || !height || !layer.visible) {
    if (map.getLayer(ids.extrusion)) map.removeLayer(ids.extrusion)
    return false
  }
  if (!map.getLayer(ids.extrusion)) {
    map.addLayer({
      id: ids.extrusion,
      type: 'fill-extrusion',
      source: ids.source,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'fill-extrusion-color': colorExpression(layer.renderer, layer.fillColor),
        'fill-extrusion-height': ['max', 0, ['*', ['to-number', ['get', height.field], 0], height.multiplier]],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': Math.min(1, layer.opacity),
        'fill-extrusion-vertical-gradient': true,
      },
    })
  } else {
    map.setPaintProperty(ids.extrusion, 'fill-extrusion-color', colorExpression(layer.renderer, layer.fillColor))
    map.setPaintProperty(ids.extrusion, 'fill-extrusion-height', ['max', 0, ['*', ['to-number', ['get', height.field], 0], height.multiplier]])
    map.setPaintProperty(ids.extrusion, 'fill-extrusion-opacity', Math.min(1, layer.opacity))
    map.setLayoutProperty(ids.extrusion, 'visibility', 'visible')
  }
  return true
}

function addLayerSourcesAndStyles(map: MapLibreMap, layer: MapLayer, sceneView: boolean) {
  const ids = getLayerIds(layer.id)
  map.addSource(ids.source, {
    type: 'geojson',
    data: getRenderableData(layer.data),
    promoteId: renderFeatureIdProperty,
  })
  map.addLayer({
    id: ids.fill,
    type: 'fill',
    source: ids.source,
    filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
    paint: { 'fill-color': colorExpression(layer.renderer, layer.fillColor), 'fill-opacity': layer.opacity * layer.fillOpacity },
  })
  map.addLayer({
    id: ids.line,
    type: 'line',
    source: ids.source,
    filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false],
    paint: { 'line-color': colorExpression(layer.renderer, layer.strokeColor), 'line-width': layer.strokeWidth, 'line-opacity': layer.opacity, 'line-dasharray': lineDash(layer) },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })
  map.addLayer({
    id: ids.point,
    type: 'circle',
    source: ids.source,
    filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
    paint: {
      'circle-radius': layer.pointRadius,
      'circle-color': colorExpression(layer.renderer, layer.fillColor),
      'circle-stroke-color': layer.strokeColor,
      'circle-stroke-width': layer.strokeWidth,
      'circle-opacity': layer.opacity * layer.fillOpacity,
      'circle-stroke-opacity': layer.opacity,
    },
  })
  if (hasPointFeatures(layer)) {
    map.addLayer({
      id: ids.pointMarker,
      type: 'symbol',
      source: ids.source,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      layout: {
        'icon-image': markerImageExpression(map, layer),
        'icon-size': layer.pointRadius / 8,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        visibility: layer.pointShape === 'circle' ? 'none' : layer.visible ? 'visible' : 'none',
      },
      paint: {
        'icon-color': colorExpression(layer.renderer, layer.fillColor),
        'icon-halo-color': layer.strokeColor,
        'icon-halo-width': layer.strokeWidth,
        'icon-halo-blur': 0,
        'icon-opacity': layer.opacity * layer.fillOpacity,
      },
    })
  }
  if (isLabelingEnabled(layer)) addLabelLayer(map, layer)
  updateExtrusion(map, layer, sceneView)
}

function isLabelingEnabled(layer: MapLayer): boolean {
  return layer.labelStyle?.enabled ?? Boolean(layer.labelField)
}

function labelExpression(layer: MapLayer): ExpressionSpecification {
  return labelTextExpression(layer.labelStyle?.expression ?? '', layer.labelField) as ExpressionSpecification
}

function addLabelLayer(map: MapLibreMap, layer: MapLayer) {
  const ids = getLayerIds(layer.id)
  if (map.getLayer(ids.label) || (!layer.labelField && !layer.labelStyle?.expression.trim())) return
  const placement = layer.labelStyle?.placement ?? 'point'
  map.addLayer({
    id: ids.label,
    type: 'symbol',
    source: ids.source,
    filter: ['!=', ['to-string', labelExpression(layer)], ''],
    layout: {
      'text-field': labelExpression(layer),
      'text-size': layer.labelStyle?.fontSize ?? 11,
      'text-offset': [0, layer.labelStyle?.offset ?? 1.15],
      'text-anchor': 'top',
      'symbol-placement': placement === 'line' ? 'line' : 'point',
      'text-writing-mode': ['horizontal'],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': layer.labelStyle?.color ?? layer.strokeColor,
      'text-halo-color': layer.labelStyle?.haloColor ?? 'rgba(18, 22, 30, 0.88)',
      'text-halo-width': layer.labelStyle?.haloWidth ?? 1.4,
      'text-opacity': layer.opacity,
    },
  })
}

function updateLayerStyle(map: MapLibreMap, layer: MapLayer, sceneView: boolean) {
  const ids = getLayerIds(layer.id)
  const extruded = updateExtrusion(map, layer, sceneView)
  const visibility = layer.visible ? 'visible' : 'none'
  for (const id of [ids.line, ids.point, ids.label]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility)
  }
  if (map.getLayer(ids.pointMarker)) {
    map.setLayoutProperty(ids.pointMarker, 'visibility', layer.visible && layer.pointShape !== 'circle' ? 'visible' : 'none')
    map.setLayoutProperty(ids.pointMarker, 'icon-image', markerImageExpression(map, layer))
    map.setLayoutProperty(ids.pointMarker, 'icon-size', layer.pointRadius / 8)
  }
  if (map.getLayer(ids.fill)) map.setLayoutProperty(ids.fill, 'visibility', extruded ? 'none' : visibility)
  if (map.getLayer(ids.fill)) {
    map.setPaintProperty(ids.fill, 'fill-color', colorExpression(layer.renderer, layer.fillColor))
    map.setPaintProperty(ids.fill, 'fill-opacity', layer.opacity * layer.fillOpacity)
  }
  if (map.getLayer(ids.line)) {
    map.setPaintProperty(ids.line, 'line-color', colorExpression(layer.renderer, layer.strokeColor))
    map.setPaintProperty(ids.line, 'line-width', layer.strokeWidth)
    map.setPaintProperty(ids.line, 'line-opacity', layer.opacity)
    map.setPaintProperty(ids.line, 'line-dasharray', lineDash(layer))
  }
  if (map.getLayer(ids.point)) {
    map.setPaintProperty(ids.point, 'circle-radius', layer.pointRadius)
    map.setPaintProperty(ids.point, 'circle-color', colorExpression(layer.renderer, layer.fillColor))
    map.setPaintProperty(ids.point, 'circle-stroke-color', layer.strokeColor)
    map.setPaintProperty(ids.point, 'circle-stroke-width', layer.strokeWidth)
    map.setPaintProperty(ids.point, 'circle-opacity', layer.opacity * layer.fillOpacity)
    map.setPaintProperty(ids.point, 'circle-stroke-opacity', layer.opacity)
  }
  if (map.getLayer(ids.pointMarker)) {
    map.setPaintProperty(ids.pointMarker, 'icon-color', colorExpression(layer.renderer, layer.fillColor))
    map.setPaintProperty(ids.pointMarker, 'icon-halo-color', layer.strokeColor)
    map.setPaintProperty(ids.pointMarker, 'icon-halo-width', layer.strokeWidth)
    map.setPaintProperty(ids.pointMarker, 'icon-halo-blur', 0)
    map.setPaintProperty(ids.pointMarker, 'icon-opacity', layer.opacity * layer.fillOpacity)
  }
  if (isLabelingEnabled(layer) && (layer.labelField || layer.labelStyle?.expression.trim())) {
    addLabelLayer(map, layer)
    map.setFilter(ids.label, ['!=', ['to-string', labelExpression(layer)], ''])
    map.setLayoutProperty(ids.label, 'text-field', labelExpression(layer))
    map.setLayoutProperty(ids.label, 'text-size', layer.labelStyle.fontSize)
    map.setLayoutProperty(ids.label, 'text-offset', [0, layer.labelStyle.offset])
    map.setLayoutProperty(ids.label, 'symbol-placement', layer.labelStyle.placement === 'line' ? 'line' : 'point')
    map.setPaintProperty(ids.label, 'text-color', layer.labelStyle.color)
    map.setPaintProperty(ids.label, 'text-halo-color', layer.labelStyle.haloColor)
    map.setPaintProperty(ids.label, 'text-halo-width', layer.labelStyle.haloWidth)
    map.setPaintProperty(ids.label, 'text-opacity', layer.opacity)
  } else if (map.getLayer(ids.label)) {
    map.removeLayer(ids.label)
  }
}

export function syncMapLayers(map: MapLibreMap, layers: MapLayer[], sceneView = false) {
  if (!map.isStyleLoaded()) return
  const snapshots = sourceDataSnapshots.get(map) ?? new Map<string, FeatureCollection>()
  sourceDataSnapshots.set(map, snapshots)
  const activeIds = new Set(layers.filter(hasRenderableGeometry).map((layer) => getLayerIds(layer.id).source))

  for (const styleLayer of map.getStyle().layers ?? []) {
    if (styleLayer.id.startsWith('aw-layer-') && !layers.some((layer) => Object.values(getLayerIds(layer.id)).includes(styleLayer.id))) {
      map.removeLayer(styleLayer.id)
    }
  }
  for (const sourceId of Object.keys(map.getStyle().sources)) {
    if (sourceId.startsWith('aw-layer-') && !activeIds.has(sourceId)) {
      for (const id of Object.keys(map.getStyle().layers.reduce<Record<string, true>>((accumulator, layer) => {
        if (layer.id.startsWith(`${sourceId}-`)) accumulator[layer.id] = true
        return accumulator
      }, {}))) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      map.removeSource(sourceId)
      snapshots.delete(sourceId)
    }
  }

  for (const layer of layers) {
    if (!hasRenderableGeometry(layer)) continue
    const ids = getLayerIds(layer.id)
    if (!map.getSource(ids.source)) {
      addLayerSourcesAndStyles(map, layer, sceneView)
      snapshots.set(ids.source, layer.data)
    } else {
      if (snapshots.get(ids.source) !== layer.data) {
        ;(map.getSource(ids.source) as GeoJSONSource).setData(getRenderableData(layer.data))
        snapshots.set(ids.source, layer.data)
      }
      if (!map.getLayer(ids.fill) || !map.getLayer(ids.line) || !map.getLayer(ids.point) || (hasPointFeatures(layer) && !map.getLayer(ids.pointMarker))) {
        for (const id of [ids.extrusion, ids.label, ids.pointMarker, ids.point, ids.line, ids.fill]) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        addLayerSourcesAndStyles(map, layer, sceneView)
      }
    }
    updateLayerStyle(map, layer, sceneView)
  }

  for (const layer of [...layers].reverse()) {
    const ids = getLayerIds(layer.id)
    for (const id of [ids.fill, ids.extrusion, ids.line, ids.point, ids.pointMarker, ids.label]) {
      if (map.getLayer(id)) map.moveLayer(id)
    }
  }
  for (const id of [
    'aw-measure-fill', 'aw-measure-line', 'aw-measure-points',
    'aw-sketch-fill', 'aw-sketch-line', 'aw-sketch-points',
    'aw-selection-fill', 'aw-selection-line', 'aw-selection-points',
  ]) {
    if (map.getLayer(id)) map.moveLayer(id)
  }
}

function ensureGeoJsonSource(map: MapLibreMap, sourceId: string) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
}

function ensureOverlayLayer(map: MapLibreMap, id: string, type: 'fill' | 'line' | 'circle', source: string) {
  if (map.getLayer(id)) return
  if (type === 'fill') {
    map.addLayer({ id, type, source, filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], paint: { 'fill-color': '#61d8bc', 'fill-opacity': 0.18 } })
  } else if (type === 'line') {
    map.addLayer({ id, type, source, paint: { 'line-color': '#61d8bc', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
  } else {
    map.addLayer({ id, type, source, filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], paint: { 'circle-radius': 5, 'circle-color': '#e5fff7', 'circle-stroke-color': '#28b397', 'circle-stroke-width': 2 } })
  }
}

export function ensureMapOverlays(map: MapLibreMap) {
  if (!map.isStyleLoaded()) return
  for (const sourceId of ['aw-measure', 'aw-sketch', 'aw-selection']) ensureGeoJsonSource(map, sourceId)
  for (const [prefix, source] of [['aw-measure', 'aw-measure'], ['aw-sketch', 'aw-sketch']] as const) {
    ensureOverlayLayer(map, `${prefix}-fill`, 'fill', source)
    ensureOverlayLayer(map, `${prefix}-line`, 'line', source)
    ensureOverlayLayer(map, `${prefix}-points`, 'circle', source)
  }
  ensureOverlayLayer(map, 'aw-selection-fill', 'fill', 'aw-selection')
  ensureOverlayLayer(map, 'aw-selection-line', 'line', 'aw-selection')
  ensureOverlayLayer(map, 'aw-selection-points', 'circle', 'aw-selection')
  // Selected features use a solid cyan highlight so they stand out from sketches and measurements.
  map.setPaintProperty('aw-selection-fill', 'fill-color', '#00e5ff')
  map.setPaintProperty('aw-selection-fill', 'fill-opacity', 0.3)
  map.setPaintProperty('aw-selection-line', 'line-color', '#00e5ff')
  map.setPaintProperty('aw-selection-line', 'line-width', 3)
  map.setPaintProperty('aw-selection-line', 'line-dasharray', [1, 0])
  map.setPaintProperty('aw-selection-points', 'circle-radius', 7)
  map.setPaintProperty('aw-selection-points', 'circle-color', '#00e5ff')
  map.setPaintProperty('aw-selection-points', 'circle-stroke-color', '#003c46')
  for (const id of [
    'aw-measure-fill', 'aw-measure-line', 'aw-measure-points',
    'aw-sketch-fill', 'aw-sketch-line', 'aw-sketch-points',
    'aw-selection-fill', 'aw-selection-line', 'aw-selection-points',
  ]) {
    if (map.getLayer(id)) map.moveLayer(id)
  }
}

function updateOverlay(map: MapLibreMap, sourceId: string, data: FeatureCollection) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined
  if (source && map.isStyleLoaded()) source.setData(data)
}

export function setMeasureOverlay(map: MapLibreMap, features: Feature<Geometry>[]) {
  updateOverlay(map, 'aw-measure', { type: 'FeatureCollection', features })
}

export function setSketchOverlay(map: MapLibreMap, features: Feature<Geometry>[]) {
  updateOverlay(map, 'aw-sketch', { type: 'FeatureCollection', features })
}

export function setSelectionOverlay(
  map: MapLibreMap,
  layers: MapLayer[],
  selection: FeatureSelection | null,
  selections: Record<string, FeatureId[]> = {},
) {
  // Highlight the selection sets of visible layers plus the identified (primary) feature.
  const features: Feature<Geometry>[] = []
  for (const layer of layers) {
    const ids = new Set<FeatureId>(layer.visible ? selections[layer.id] ?? [] : [])
    if (selection?.layerId === layer.id) ids.add(selection.featureId)
    if (!ids.size) continue
    for (const feature of layer.data.features) {
      if (feature.geometry && feature.id !== undefined && ids.has(feature.id)) features.push(feature as Feature<Geometry>)
    }
  }
  updateOverlay(map, 'aw-selection', { type: 'FeatureCollection', features })
}

export function getRenderedFeatureLayerIds(map: MapLibreMap, layers: MapLayer[]) {
  return layers
    .filter((layer) => layer.visible)
    .flatMap((layer) => {
      const ids = getLayerIds(layer.id)
      return [ids.fill, ids.line, ids.point, ids.pointMarker, ids.extrusion].filter((id) => map.getLayer(id))
    })
}

export function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      bounds[0] = Math.min(bounds[0], value[0])
      bounds[1] = Math.min(bounds[1], value[1])
      bounds[2] = Math.max(bounds[2], value[0])
      bounds[3] = Math.max(bounds[3], value[1])
      return
    }
    value.forEach(walk)
  }
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((item) => {
    const result = geometryBounds(item)
    if (result) {
      bounds[0] = Math.min(bounds[0], result[0])
      bounds[1] = Math.min(bounds[1], result[1])
      bounds[2] = Math.max(bounds[2], result[2])
      bounds[3] = Math.max(bounds[3], result[3])
    }
  })
  else if ('coordinates' in geometry) walk(geometry.coordinates)
  return bounds.every(Number.isFinite) ? bounds as [number, number, number, number] : null
}

/** The extrusion actually used for a layer in the 3D Scene (explicit setting or detected field). */
export const resolveExtrusion = polygonHeightField
