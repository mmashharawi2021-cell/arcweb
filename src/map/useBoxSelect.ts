import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { BoundingBox } from './boxSelect'

export type BoxSelectMethod = 'new' | 'add' | 'remove'

/** A click (or a drag shorter than this, in pixels) selects within this many pixels of the pointer. */
const CLICK_TOLERANCE = 4

/**
 * Rectangle selection on the map while `active`: drag to draw a box (Shift adds, Ctrl/⌘
 * removes), or click to select under the pointer. Map panning and MapLibre's Shift box zoom
 * are off while active. `onBox` is read through a ref, so it may change freely.
 */
export function useBoxSelect(map: MapLibreMap | null, active: boolean, onBox: (bounds: BoundingBox, method: BoxSelectMethod) => void): void {
  const onBoxRef = useRef(onBox)
  useEffect(() => { onBoxRef.current = onBox })

  useEffect(() => {
    if (!map || !active) return
    map.dragPan.disable()
    map.boxZoom.disable()
    const container = map.getCanvasContainer()
    let start: { x: number; y: number; method: BoxSelectMethod } | null = null
    let rectangle: HTMLDivElement | null = null

    const clear = () => {
      rectangle?.remove()
      rectangle = null
      start = null
    }
    const onMouseDown = (event: MapMouseEvent) => {
      if (event.originalEvent.button !== 0) return
      const original = event.originalEvent
      start = { x: event.point.x, y: event.point.y, method: original.shiftKey ? 'add' : original.ctrlKey || original.metaKey ? 'remove' : 'new' }
      rectangle = document.createElement('div')
      rectangle.className = 'box-select-rectangle'
      rectangle.setAttribute('aria-hidden', 'true')
      container.appendChild(rectangle)
    }
    const onMouseMove = (event: MapMouseEvent) => {
      if (!start || !rectangle) return
      rectangle.style.left = `${Math.min(start.x, event.point.x)}px`
      rectangle.style.top = `${Math.min(start.y, event.point.y)}px`
      rectangle.style.width = `${Math.abs(event.point.x - start.x)}px`
      rectangle.style.height = `${Math.abs(event.point.y - start.y)}px`
    }
    const onMouseUp = (event: MapMouseEvent) => {
      if (!start) return
      const { x, y, method } = start
      const isClick = Math.abs(event.point.x - x) < CLICK_TOLERANCE && Math.abs(event.point.y - y) < CLICK_TOLERANCE
      const [a, b] = isClick
        ? [[x - CLICK_TOLERANCE, y - CLICK_TOLERANCE], [x + CLICK_TOLERANCE, y + CLICK_TOLERANCE]] as [number, number][]
        : [[x, y], [event.point.x, event.point.y]] as [number, number][]
      const first = map.unproject(a)
      const second = map.unproject(b)
      clear()
      onBoxRef.current([
        Math.min(first.lng, second.lng), Math.min(first.lat, second.lat),
        Math.max(first.lng, second.lng), Math.max(first.lat, second.lat),
      ], method)
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      clear()
      map.dragPan.enable()
      map.boxZoom.enable()
    }
  }, [map, active])
}
