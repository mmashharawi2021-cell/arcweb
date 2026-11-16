import type { Map as MapLibreMap } from 'maplibre-gl'

export type LayoutExportFormat = 'png' | 'pdf'

export interface LayoutExportOptions {
  /** The on-screen page element (the white sheet). */
  page: HTMLElement
  /** The live map shown in the map frame, if the sheet has one. */
  map: MapLibreMap | null
  format: LayoutExportFormat
  /** Paper size in millimetres. */
  widthMm: number
  heightMm: number
  dpi: number
  fileName: string
}

const MAX_MAP_CANVAS = 4096
/** Browsers fail (or crash the tab) on very large canvases; ~100 MP is safe on desktop Chrome, Edge and Firefox. */
export const MAX_EXPORT_PIXELS = 100_000_000

/**
 * The resolution actually used for an export: the requested dpi, lowered just enough to keep the
 * sheet under `maxPixels` (e.g. an A2 poster at 600 dpi), rounded down to a whole dpi.
 */
export function effectiveExportDpi(widthMm: number, heightMm: number, dpi: number, maxPixels = MAX_EXPORT_PIXELS): { dpi: number; capped: boolean } {
  const pixels = (widthMm / 25.4 * dpi) * (heightMm / 25.4 * dpi)
  if (pixels <= maxPixels) return { dpi, capped: false }
  return { dpi: Math.floor(dpi * Math.sqrt(maxPixels / pixels)), capped: true }
}

function waitForIdle(map: MapLibreMap, timeout = 10_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeout)
    function done() {
      window.clearTimeout(timer)
      map.off('idle', done)
      resolve()
    }
    map.once('idle', done)
    map.triggerRepaint()
  })
}

function download(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
}

/**
 * Renders the layout sheet to a high-resolution PNG or a single-page PDF at true
 * paper size. The map is re-rendered at a higher pixel ratio for the capture so the
 * vector layers stay sharp instead of being upscaled from screen resolution.
 */
export async function exportLayoutSheet(options: LayoutExportOptions): Promise<{ width: number; height: number; dpi: number; capped: boolean }> {
  const { page, map, format, widthMm, heightMm, fileName } = options
  const { dpi, capped } = effectiveExportDpi(widthMm, heightMm, options.dpi)
  const screenWidth = page.offsetWidth
  if (!screenWidth) throw new Error('The layout sheet is not visible.')
  const targetWidth = Math.round(widthMm / 25.4 * dpi)
  const targetHeight = Math.round(heightMm / 25.4 * dpi)
  const ratio = targetWidth / screenWidth

  const previousRatio = map?.getPixelRatio()
  const mapInFrame = map && page.contains(map.getContainer()) ? map : null
  page.classList.add('layout-exporting')
  try {
    if (mapInFrame) {
      const container = mapInFrame.getContainer()
      const longest = Math.max(container.clientWidth, container.clientHeight, 1)
      mapInFrame.setPixelRatio(Math.max(1, Math.min(ratio, MAX_MAP_CANVAS / longest)))
      await waitForIdle(mapInFrame)
    }
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(page, {
      pixelRatio: ratio,
      canvasWidth: screenWidth,
      canvasHeight: page.offsetHeight,
      backgroundColor: '#ffffff',
      cacheBust: false,
      skipFonts: true,
      style: { boxShadow: 'none', margin: '0', transform: 'none' },
      // Selection handles, grips and MapLibre's interactive controls are editing chrome, not map content.
      filter: (node) => !(node instanceof HTMLElement &&
        (node.classList.contains('layout-ui') || node.classList.contains('maplibregl-control-container'))),
    })
    if (format === 'png') {
      download(dataUrl, `${fileName}.png`)
    } else {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({
        orientation: widthMm > heightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [widthMm, heightMm],
        compress: true,
      })
      pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST')
      pdf.save(`${fileName}.pdf`)
    }
    return { width: targetWidth, height: targetHeight, dpi, capped }
  } finally {
    page.classList.remove('layout-exporting')
    if (mapInFrame && previousRatio !== undefined) mapInFrame.setPixelRatio(previousRatio)
  }
}
