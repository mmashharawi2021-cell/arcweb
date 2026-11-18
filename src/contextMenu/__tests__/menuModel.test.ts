import { describe, expect, it, vi } from 'vitest'
import {
  buildLayerMenu, buildMapCanvasMenu, clampMenuPosition, dispatchMenuAction, formatLngLat, isRightClickGesture,
  runLayerMenuAction, runMapCanvasMenuAction, stepMenuFocus, type LayerMenuHandlers, type MapCanvasMenuHandlers,
  type MenuEntry,
} from '../menuModel'

const items = (entries: MenuEntry[]) => entries.filter((entry) => entry.kind === 'item')
const item = (entries: MenuEntry[], id: string) => {
  entries=entries.flatMap(entry=>entry.kind==='item'&&entry.children?[entry,...entry.children]:[entry])
  const found = entries.find((entry) => entry.kind === 'item' && entry.id === id)
  if (!found || found.kind !== 'item') throw new Error(`No menu item ${id}`)
  return found
}

describe('clampMenuPosition (viewport boundary detection)', () => {
  const viewport = { width: 1000, height: 700 }
  const size = { width: 200, height: 300 }

  it('opens down-right of the pointer when there is room', () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 })
  })

  it('flips left near the right edge and up near the bottom edge', () => {
    expect(clampMenuPosition({ x: 950, y: 650 }, size, viewport)).toEqual({ x: 750, y: 350 })
  })

  it('clamps to the margin when flipping would still overflow', () => {
    // A 690 px menu fits neither below (500+690 > 692) nor above (500-690 < 8) the pointer.
    expect(clampMenuPosition({ x: 50, y: 500 }, { width: 200, height: 690 }, viewport)).toEqual({ x: 50, y: 8 })
  })

  it('never returns a position that puts any edge off-screen', () => {
    for (const anchor of [{ x: 0, y: 0 }, { x: 999, y: 699 }, { x: 500, y: 5 }, { x: 3, y: 690 }]) {
      const { x, y } = clampMenuPosition(anchor, size, viewport)
      expect(x).toBeGreaterThanOrEqual(8)
      expect(y).toBeGreaterThanOrEqual(8)
      expect(x + size.width).toBeLessThanOrEqual(viewport.width - 8)
      expect(y + size.height).toBeLessThanOrEqual(viewport.height - 8)
    }
  })
})

describe('keyboard focus stepping', () => {
  const entries: MenuEntry[] = [
    { kind: 'label', id: 'title', label: 'Title' },
    { kind: 'item', id: 'a', label: 'A' },
    { kind: 'separator', id: 's' },
    { kind: 'item', id: 'b', label: 'B', disabled: true },
    { kind: 'item', id: 'c', label: 'C' },
  ]

  it('skips labels, separators and disabled items', () => {
    expect(stepMenuFocus(entries, -1, 1)).toBe(1)
    expect(stepMenuFocus(entries, 1, 1)).toBe(4)
  })

  it('wraps around in both directions', () => {
    expect(stepMenuFocus(entries, 4, 1)).toBe(1)
    expect(stepMenuFocus(entries, 1, -1)).toBe(4)
  })

  it('returns -1 when nothing is selectable', () => {
    expect(stepMenuFocus([{ kind: 'item', id: 'x', label: 'X', disabled: true }], -1, 1)).toBe(-1)
  })
})

describe('map canvas right-click gesture filter', () => {
  it('opens the menu for a stationary right-click', () => {
    expect(isRightClickGesture({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(true)
  })

  it('ignores the contextmenu event that ends a right-drag rotation', () => {
    expect(isRightClickGesture({ x: 10, y: 10 }, { x: 60, y: 30 })).toBe(false)
  })

  it('opens the menu when no right mouse-down was seen (keyboard or touch long-press)', () => {
    expect(isRightClickGesture(null, { x: 40, y: 40 })).toBe(true)
  })
})

describe('layer context menu', () => {
  const polygon = { name: 'Parcels', geometry: 'Polygon' as const }

  it('lists the required commands in order under the layer name', () => {
    const entries = buildLayerMenu({ layer: polygon, index: 1, count: 3, tableShowsLayer: false })
    expect(entries[0]).toEqual({ kind: 'label', id: 'title', label: 'Parcels' })
    expect(items(entries).map((entry) => entry.id)).toEqual([
      'zoom', 'zoom-visible', 'table', 'selection-menu', 'label', 'label-properties', 'symbology', 'data-menu', 'move-up', 'move-down', 'remove', 'properties',
    ])
    expect(item(entries,'zoom-visible').disabled).toBe(true)
    expect(item(entries, 'remove').danger).toBe(true)
  })

  it('disables Move Up for the top layer and Move Down for the bottom layer', () => {
    const top = buildLayerMenu({ layer: polygon, index: 0, count: 2, tableShowsLayer: false })
    expect(item(top, 'move-up').disabled).toBe(true)
    expect(item(top, 'move-down').disabled).toBe(false)
    const bottom = buildLayerMenu({ layer: polygon, index: 1, count: 2, tableShowsLayer: false })
    expect(item(bottom, 'move-down').disabled).toBe(true)
    const only = buildLayerMenu({ layer: polygon, index: 0, count: 1, tableShowsLayer: false })
    expect(item(only, 'move-up').disabled && item(only, 'move-down').disabled).toBe(true)
  })

  it('disables Zoom and Symbology for standalone tables', () => {
    const entries = buildLayerMenu({ layer: { name: 'Lookup', geometry: 'Unknown' }, index: 0, count: 1, tableShowsLayer: false })
    expect(item(entries, 'zoom').disabled).toBe(true)
    expect(item(entries, 'symbology').disabled).toBe(true)
    expect(item(entries, 'table').disabled).toBeFalsy()
  })

  it('offers to close the attribute table when it already shows this layer', () => {
    expect(item(buildLayerMenu({ layer: polygon, index: 0, count: 1, tableShowsLayer: true }), 'table').label).toBe('Close Attribute Table')
    expect(item(buildLayerMenu({ layer: polygon, index: 0, count: 1, tableShowsLayer: false }), 'table').label).toBe('Open Attribute Table')
  })

  it('routes each action to its handler with the right arguments', () => {
    const handlers: LayerMenuHandlers = {
      zoomTo: vi.fn(), toggleTable: vi.fn(), openSymbology: vi.fn(), move: vi.fn(), exportAs: vi.fn(), requestRemove: vi.fn(),
    }
    for (const id of ['zoom', 'table', 'symbology', 'move-up', 'move-down', 'export-geojson', 'export-csv', 'remove']) {
      expect(runLayerMenuAction(id, handlers)).toBe(true)
    }
    expect(handlers.zoomTo).toHaveBeenCalledTimes(1)
    expect(handlers.toggleTable).toHaveBeenCalledTimes(1)
    expect(handlers.openSymbology).toHaveBeenCalledTimes(1)
    expect(handlers.move).toHaveBeenNthCalledWith(1, -1)
    expect(handlers.move).toHaveBeenNthCalledWith(2, 1)
    expect(handlers.exportAs).toHaveBeenNthCalledWith(1, 'geojson')
    expect(handlers.exportAs).toHaveBeenNthCalledWith(2, 'csv')
    // Remove only asks for confirmation; it must not remove anything by itself.
    expect(handlers.requestRemove).toHaveBeenCalledTimes(1)
  })
})

describe('map canvas context menu', () => {
  it('shows the clicked coordinate and the three quick actions', () => {
    const entries = buildMapCanvasMenu({ lngLat: [34.46667, 31.5], canIdentify: true, markerCount: 0 })
    expect(entries[0]).toMatchObject({ kind: 'label', label: '31.50000° N, 34.46667° E' })
    expect(items(entries).map((entry) => entry.id)).toEqual(['identify', 'center', 'marker', 'copy'])
  })

  it('disables Identify when no feature layer is visible', () => {
    expect(item(buildMapCanvasMenu({ lngLat: [0, 0], canIdentify: false, markerCount: 0 }), 'identify').disabled).toBe(true)
  })

  it('adds a Clear Quick Markers command once markers exist', () => {
    const entries = buildMapCanvasMenu({ lngLat: [0, 0], canIdentify: true, markerCount: 2 })
    expect(item(entries, 'clear-markers').label).toBe('Clear Quick Markers (2)')
  })

  it('routes each action to its handler', () => {
    const handlers: MapCanvasMenuHandlers = {
      identify: vi.fn(), center: vi.fn(), addMarker: vi.fn(), copyCoordinates: vi.fn(), clearMarkers: vi.fn(),
    }
    for (const id of ['identify', 'center', 'marker', 'copy', 'clear-markers']) expect(runMapCanvasMenuAction(id, handlers)).toBe(true)
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('menu helpers', () => {
  it('reports unknown action ids instead of throwing', () => {
    const handler = vi.fn()
    expect(dispatchMenuAction('nope', { known: handler })).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('formats coordinates with hemispheres', () => {
    expect(formatLngLat([-74.006, 40.7128])).toBe('40.71280° N, 74.00600° W')
    expect(formatLngLat([151.2093, -33.8688])).toBe('33.86880° S, 151.20930° E')
  })
})
