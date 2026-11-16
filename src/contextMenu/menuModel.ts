import type { ComponentType } from 'react'
import {
  ArrowDown, ArrowUp, Copy, Crosshair, FileJson, FileSpreadsheet, LocateFixed, MapPin, MapPinOff,
  Paintbrush, ScanSearch, Table2, Trash2,
} from 'lucide-react'
import type { MapLayer } from '../store'

export type MenuIcon = ComponentType<{ size?: number | string }>

/**
 * Menu entries are plain data: an item names an action by `id` and the host dispatches it when the
 * item is chosen. Keeping callbacks out of the model makes menus cheap to build during render and
 * lets the action wiring be tested on its own.
 */
export type MenuEntry<Id extends string = string> =
  | { kind: 'item'; id: Id; label: string; icon?: MenuIcon; disabled?: boolean; danger?: boolean }
  | { kind: 'label'; id: string; label: string }
  | { kind: 'separator'; id: string }

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/**
 * Places a menu of `size` at `anchor` (the pointer) inside `viewport`. It opens down-right like a
 * native menu, flips left/up when that would overflow, and finally clamps to a `margin` from every
 * edge so a menu taller or wider than the free space never leaves the screen.
 */
export function clampMenuPosition(anchor: Point, size: Size, viewport: Size, margin = 8): Point {
  const place = (start: number, extent: number, limit: number) => {
    let position = start
    if (position + extent > limit - margin) position = start - extent
    return Math.max(margin, Math.min(position, limit - margin - extent))
  }
  return { x: place(anchor.x, size.width, viewport.width), y: place(anchor.y, size.height, viewport.height) }
}

/** Index of the next enabled item when stepping with the arrow keys (wraps); -1 if none is enabled. */
export function stepMenuFocus(entries: readonly MenuEntry[], from: number, direction: 1 | -1): number {
  const count = entries.length
  for (let offset = 1; offset <= count; offset += 1) {
    const index = ((from + direction * offset) % count + count) % count
    const entry = entries[index]
    if (entry.kind === 'item' && !entry.disabled) return index
  }
  return -1
}

/**
 * Right-dragging rotates/tilts the map. Browsers that fire `contextmenu` on mouse-up would then pop
 * a menu at the end of every rotation, so a menu only opens if the pointer barely moved.
 */
export function isRightClickGesture(down: Point | null, up: Point, tolerance = 4): boolean {
  return !down || Math.hypot(up.x - down.x, up.y - down.y) <= tolerance
}

export function formatLngLat([lng, lat]: [number, number]): string {
  const hemi = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positive : negative}`
  return `${hemi(lat, 'N', 'S')}, ${hemi(lng, 'E', 'W')}`
}

/** Runs the handler registered for an action id; returns false for unknown or missing handlers. */
export function dispatchMenuAction<Id extends string>(id: string, handlers: Partial<Record<Id, () => void>>): boolean {
  const handler = (handlers as Record<string, (() => void) | undefined>)[id]
  if (!handler) return false
  handler()
  return true
}

// ── Contents pane: layer menu ────────────────────────────────────────────────

export type LayerMenuAction =
  | 'zoom' | 'table' | 'symbology' | 'move-up' | 'move-down' | 'export-geojson' | 'export-csv' | 'remove'

export interface LayerMenuContext {
  layer: Pick<MapLayer, 'name' | 'geometry'>
  /** Position in the drawing order (0 = top). */
  index: number
  count: number
  /** True when the attribute table is open and showing this layer. */
  tableShowsLayer: boolean
}

export function buildLayerMenu({ layer, index, count, tableShowsLayer }: LayerMenuContext): MenuEntry<LayerMenuAction>[] {
  const isTable = layer.geometry === 'Unknown'
  return [
    { kind: 'label', id: 'title', label: layer.name },
    { kind: 'item', id: 'zoom', label: 'Zoom To Layer', icon: LocateFixed, disabled: isTable },
    { kind: 'item', id: 'table', label: tableShowsLayer ? 'Close Attribute Table' : 'Open Attribute Table', icon: Table2 },
    { kind: 'item', id: 'symbology', label: 'Symbology…', icon: Paintbrush, disabled: isTable },
    { kind: 'separator', id: 'sep-order' },
    { kind: 'item', id: 'move-up', label: 'Move Up', icon: ArrowUp, disabled: index <= 0 },
    { kind: 'item', id: 'move-down', label: 'Move Down', icon: ArrowDown, disabled: index >= count - 1 },
    { kind: 'separator', id: 'sep-export' },
    { kind: 'item', id: 'export-geojson', label: 'Export as GeoJSON', icon: FileJson },
    { kind: 'item', id: 'export-csv', label: 'Export as CSV', icon: FileSpreadsheet },
    { kind: 'separator', id: 'sep-remove' },
    { kind: 'item', id: 'remove', label: 'Remove Layer…', icon: Trash2, danger: true },
  ]
}

export interface LayerMenuHandlers {
  zoomTo: () => void
  toggleTable: () => void
  openSymbology: () => void
  move: (direction: -1 | 1) => void
  exportAs: (format: 'geojson' | 'csv') => void
  /** Asks for confirmation; the layer is removed only once the user confirms. */
  requestRemove: () => void
}

export function runLayerMenuAction(id: string, handlers: LayerMenuHandlers): boolean {
  return dispatchMenuAction<LayerMenuAction>(id, {
    zoom: handlers.zoomTo,
    table: handlers.toggleTable,
    symbology: handlers.openSymbology,
    'move-up': () => handlers.move(-1),
    'move-down': () => handlers.move(1),
    'export-geojson': () => handlers.exportAs('geojson'),
    'export-csv': () => handlers.exportAs('csv'),
    remove: handlers.requestRemove,
  })
}

// ── Map canvas menu ──────────────────────────────────────────────────────────

export type MapCanvasMenuAction = 'identify' | 'center' | 'marker' | 'copy' | 'clear-markers'

export interface MapCanvasMenuContext {
  lngLat: [number, number]
  /** Whether any visible feature layer could be hit by Identify. */
  canIdentify: boolean
  markerCount: number
}

export function buildMapCanvasMenu({ lngLat, canIdentify, markerCount }: MapCanvasMenuContext): MenuEntry<MapCanvasMenuAction>[] {
  const entries: MenuEntry<MapCanvasMenuAction>[] = [
    { kind: 'label', id: 'title', label: formatLngLat(lngLat) },
    { kind: 'item', id: 'identify', label: 'Identify Features Here', icon: ScanSearch, disabled: !canIdentify },
    { kind: 'item', id: 'center', label: 'Center Map Here', icon: Crosshair },
    { kind: 'item', id: 'marker', label: 'Add Quick Marker', icon: MapPin },
    { kind: 'separator', id: 'sep-copy' },
    { kind: 'item', id: 'copy', label: 'Copy Coordinates', icon: Copy },
  ]
  if (markerCount > 0) {
    entries.push({ kind: 'item', id: 'clear-markers', label: `Clear Quick Markers (${markerCount})`, icon: MapPinOff })
  }
  return entries
}

export interface MapCanvasMenuHandlers {
  identify: () => void
  center: () => void
  addMarker: () => void
  copyCoordinates: () => void
  clearMarkers: () => void
}

export function runMapCanvasMenuAction(id: string, handlers: MapCanvasMenuHandlers): boolean {
  return dispatchMenuAction<MapCanvasMenuAction>(id, {
    identify: handlers.identify,
    center: handlers.center,
    marker: handlers.addMarker,
    copy: handlers.copyCoordinates,
    'clear-markers': handlers.clearMarkers,
  })
}
