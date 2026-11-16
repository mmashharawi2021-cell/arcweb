import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { GripVertical, Maximize2, Minus, Plus } from 'lucide-react'
import { getCrs, metersPerPixel } from '../crs'
import { useArcWebStore, type BasemapId, type MapLayer } from '../store'
import { resolveDynamicText } from './dynamicText'
import { Legend, NorthArrow, ScaleBar, TextBox, TitleBlock } from './LayoutElements'
import { elementLabels, pageSize, useLayoutStore, type LayoutElement } from './layoutStore'

interface LayoutViewProps {
  map: MapLibreMap | null
  layers: MapLayer[]
  basemap: BasemapId
  /** Receives the white sheet element so the app can export it. */
  pageRef: RefObject<HTMLDivElement | null>
  /** Receives the element inside the map frame that should host the live map (null when there is no frame). */
  onMapFrameHost: (host: HTMLDivElement | null) => void
}

const basemapCredits: Record<BasemapId, string> = {
  osm: '© OpenStreetMap contributors',
  satellite: 'Imagery © Esri, Maxar, Earthstar Geographics',
  dark: '© CARTO · © OpenStreetMap contributors',
  light: '© CARTO · © OpenStreetMap contributors',
}

const MIN_SIZE_MM = 6
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = typeof handles[number]
type SnapGuide = { axis: 'x' | 'y'; position: number }
type SnapTarget = { position: number; alignment: 'start' | 'end' | 'both' }

const snap = (value: number, free: boolean) => free ? Math.round(value * 10) / 10 : Math.round(value)

function nearestEdge(value: number, size: number, targets: SnapTarget[], tolerance: number): { value: number; guide: number | null } {
  let bestValue = value
  let bestGuide: number | null = null
  let bestDistance = tolerance
  for (const target of targets) {
    const candidates = target.alignment === 'start'
      ? [target.position]
      : target.alignment === 'end'
        ? [target.position - size]
        : [target.position, target.position - size]
    for (const candidate of candidates) {
      const distance = Math.abs(candidate - value)
      if (distance <= bestDistance) {
        bestValue = candidate
        bestGuide = target.position
        bestDistance = distance
      }
    }
  }
  return { value: bestValue, guide: bestGuide }
}

export default function LayoutView({ map, layers, basemap, pageRef, onMapFrameHost }: LayoutViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const [mapView, setMapView] = useState<{ latitude: number; zoom: number; bearing: number } | null>(null)
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])

  const paper = useLayoutStore((state) => state.paper)
  const orientation = useLayoutStore((state) => state.orientation)
  const elements = useLayoutStore((state) => state.elements)
  const selectedId = useLayoutStore((state) => state.selectedId)
  const page = pageSize(paper, orientation)
  /** Screen pixels per millimetre of paper. Elements are sized with this instead of a CSS transform so the live map keeps correct pointer coordinates. */
  const scale = (fitScale ?? 2.4) * zoom
  const hasMapFrame = elements.some((element) => element.type === 'map')

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const width = viewport.clientWidth - 56
      const height = viewport.clientHeight - 56
      if (width > 0 && height > 0) setFitScale(Math.max(0.5, Math.min(width / page.width, height / page.height)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [page.width, page.height])

  // Track the live map so the scale bar and north arrow follow panning, zooming and rotation.
  useEffect(() => {
    if (!map || !hasMapFrame) return
    const update = () => setMapView({ latitude: map.getCenter().lat, zoom: map.getZoom(), bearing: map.getBearing() })
    update()
    map.on('move', update)
    return () => { map.off('move', update) }
  }, [map, hasMapFrame])

  // When the sheet is zoomed on screen, zoom the map by the same factor so the frame keeps
  // showing the same ground extent (the paper scale does not change with the screen zoom).
  const previousScaleRef = useRef<number | null>(null)
  useEffect(() => {
    if (fitScale === null) return
    const previous = previousScaleRef.current
    previousScaleRef.current = scale
    if (!map || !hasMapFrame || previous === null || previous === scale) return
    map.jumpTo({ zoom: map.getZoom() + Math.log2(scale / previous) })
  }, [fitScale, scale, map, hasMapFrame])

  const beginDrag = useCallback((event: ReactPointerEvent, element: LayoutElement, handle: Handle | 'move') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    useLayoutStore.getState().select(element.id)
    const startX = event.clientX
    const startY = event.clientY
    const origin = { x: element.x, y: element.y, w: element.w, h: element.h }
    const peers = useLayoutStore.getState().elements.filter((item) => item.id !== element.id)
    const xTargets: SnapTarget[] = [
      { position: 0, alignment: 'start' },
      { position: page.width, alignment: 'end' },
      ...peers.flatMap((item) => [
        { position: item.x, alignment: 'both' as const },
        { position: item.x + item.w, alignment: 'both' as const },
      ]),
    ]
    const yTargets: SnapTarget[] = [
      { position: 0, alignment: 'start' },
      { position: page.height, alignment: 'end' },
      ...peers.flatMap((item) => [
        { position: item.y, alignment: 'both' as const },
        { position: item.y + item.h, alignment: 'both' as const },
      ]),
    ]
    const onMove = (moveEvent: PointerEvent) => {
      const free = moveEvent.altKey
      const dx = (moveEvent.clientX - startX) / scale
      const dy = (moveEvent.clientY - startY) / scale
      let { x, y, w, h } = origin
      const guides: SnapGuide[] = []
      if (handle === 'move') {
        x = snap(Math.max(-origin.w + 4, Math.min(page.width - 4, origin.x + dx)), free)
        y = snap(Math.max(-origin.h + 4, Math.min(page.height - 4, origin.y + dy)), free)
        if (!free) {
          const snappedX = nearestEdge(x, w, xTargets, 7 / scale)
          const snappedY = nearestEdge(y, h, yTargets, 7 / scale)
          x = snappedX.value
          y = snappedY.value
          if (snappedX.guide !== null) guides.push({ axis: 'x', position: snappedX.guide })
          if (snappedY.guide !== null) guides.push({ axis: 'y', position: snappedY.guide })
        }
      } else {
        if (handle.includes('e')) {
          let edge = snap(origin.x + origin.w + dx, free)
          if (!free) {
            const result = nearestEdge(edge, 0, xTargets, 7 / scale)
            edge = result.value
            if (result.guide !== null) guides.push({ axis: 'x', position: result.guide })
          }
          w = Math.max(MIN_SIZE_MM, edge - origin.x)
        }
        if (handle.includes('w')) {
          x = snap(origin.x + dx, free)
          if (!free) {
            const result = nearestEdge(x, 0, xTargets, 7 / scale)
            x = result.value
            if (result.guide !== null) guides.push({ axis: 'x', position: result.guide })
          }
          w = Math.max(MIN_SIZE_MM, origin.x + origin.w - x)
          x = origin.x + origin.w - w
        }
        if (handle.includes('s')) {
          let edge = snap(origin.y + origin.h + dy, free)
          if (!free) {
            const result = nearestEdge(edge, 0, yTargets, 7 / scale)
            edge = result.value
            if (result.guide !== null) guides.push({ axis: 'y', position: result.guide })
          }
          h = Math.max(MIN_SIZE_MM, edge - origin.y)
        }
        if (handle.includes('n')) {
          y = snap(origin.y + dy, free)
          if (!free) {
            const result = nearestEdge(y, 0, yTargets, 7 / scale)
            y = result.value
            if (result.guide !== null) guides.push({ axis: 'y', position: result.guide })
          }
          h = Math.max(MIN_SIZE_MM, origin.y + origin.h - y)
          y = origin.y + origin.h - h
        }
      }
      setSnapGuides(guides)
      useLayoutStore.getState().updateElement(element.id, { x, y, w, h })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setSnapGuides([])
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [page.height, page.width, scale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const state = useLayoutStore.getState()
      const element = state.elements.find((item) => item.id === state.selectedId)
      if (!element) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        state.removeElement(element.id)
      } else if (event.key === 'Escape') {
        state.select(null)
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 5 : 1
        state.updateElement(element.id, {
          x: element.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          y: element.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const groundMetersPerMm = hasMapFrame && mapView ? metersPerPixel(mapView.latitude, mapView.zoom) * scale : null

  // Dynamic text ({date}, {scale}, {crs}…) is resolved on every draw, so exports always print current values.
  const projectName = useArcWebStore((state) => state.projectName)
  const displayCrs = useArcWebStore((state) => state.displayCrs)
  // The clock lives in state (ticking each minute) so rendering stays pure while {datetime} stays current.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const resolve = useMemo(() => {
    const crs = getCrs(displayCrs)
    const context = {
      now, projectName, crsName: crs?.name ?? displayCrs, crsCode: crs?.code ?? displayCrs,
      scaleDenominator: groundMetersPerMm ? groundMetersPerMm * 1000 : null, layerCount: layers.length, paper: `${paper} ${orientation}`,
    }
    return (text: string) => resolveDynamicText(text, context)
  }, [now, projectName, displayCrs, groundMetersPerMm, layers.length, paper, orientation])

  const renderContent = (element: LayoutElement) => {
    switch (element.type) {
      case 'map':
        return (
          <div className={`layout-map-frame ${element.border ? 'bordered' : ''}`}>
            <div className="layout-map-host" ref={onMapFrameHost} />
            <span className="layout-map-credit" style={{ fontSize: Math.max(5, 1.9 * scale) }}>{basemapCredits[basemap]}</span>
          </div>
        )
      case 'title':
      case 'text':
        return <TextBox element={element} scale={scale} resolve={resolve} />
      case 'legend':
        return <Legend element={element} layers={layers} scale={scale} />
      case 'north':
        return <NorthArrow style={element.style} bearing={mapView?.bearing ?? 0} />
      case 'scalebar':
        return <ScaleBar element={element} scale={scale} groundMetersPerMm={groundMetersPerMm} />
      case 'titleblock':
        return <TitleBlock element={element} scale={scale} resolve={resolve} />
    }
  }

  return (
    <div className="layout-view">
      <div className="layout-viewport" ref={viewportRef} onPointerDown={(event) => {
        if (event.target === event.currentTarget) useLayoutStore.getState().select(null)
      }}>
        <div
          className="layout-page"
          ref={pageRef}
          style={{ width: page.width * scale, height: page.height * scale }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) useLayoutStore.getState().select(null)
          }}
        >
          {elements.map((element) => {
            const selected = element.id === selectedId
            const isMap = element.type === 'map'
            return (
              <div
                key={element.id}
                className={`layout-element layout-element-${element.type} ${selected ? 'selected' : ''}`}
                style={{ left: element.x * scale, top: element.y * scale, width: element.w * scale, height: element.h * scale }}
                // The map frame's interior pans the live map, so the frame itself is moved by its grip.
                onPointerDown={isMap ? () => useLayoutStore.getState().select(element.id) : (event) => beginDrag(event, element, 'move')}
              >
                {renderContent(element)}
                {isMap && (
                  <button className="layout-ui layout-grip" title="Drag to move the map frame" onPointerDown={(event) => beginDrag(event, element, 'move')}>
                    <GripVertical size={11} />{elementLabels.map}
                  </button>
                )}
                <div className="layout-ui layout-outline" />
                {selected && handles.map((handle) => (
                  <span key={handle} className={`layout-ui layout-handle handle-${handle}`} onPointerDown={(event) => beginDrag(event, element, handle)} />
                ))}
              </div>
            )
          })}
          {snapGuides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.position}`}
              className={`layout-snap-guide ${guide.axis === 'x' ? 'vertical' : 'horizontal'}`}
              style={guide.axis === 'x'
                ? { left: guide.position * scale, height: '100%' }
                : { top: guide.position * scale, width: '100%' }}
            />
          ))}
        </div>
      </div>
      <div className="layout-zoom">
        <button title="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}><Minus size={13} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button title="Zoom in" onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}><Plus size={13} /></button>
        <button title="Fit page" onClick={() => setZoom(1)}><Maximize2 size={12} /></button>
        <em>{paper} · {orientation} · {page.width} × {page.height} mm</em>
      </div>
    </div>
  )
}
