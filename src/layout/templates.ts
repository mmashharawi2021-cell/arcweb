import type { LayoutElement, TitleBlockElement } from './layoutStore'
import { pageSize, paperUnit, type Orientation, type PaperSize } from './paper'

/** Ready-made sheet compositions. Every template keeps exactly one map frame. */

export type LayoutTemplateId = 'classic' | 'side-panel' | 'title-strip' | 'minimal'

export const LAYOUT_TEMPLATES: { id: LayoutTemplateId; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Title on top, large map, legend, scale bar and north arrow below.' },
  { id: 'side-panel', name: 'Side panel', description: 'Map with a right-hand column: title block, legend, north arrow and scale.' },
  { id: 'title-strip', name: 'Title strip', description: 'Full-width map above an engineering-style title block strip.' },
  { id: 'minimal', name: 'Minimal', description: 'Edge-to-edge map with a small title and scale bar.' },
]

const newId = () => crypto.randomUUID()
const round = (value: number) => Math.round(value * 10) / 10
const ink = '#1b2127'

export function defaultTitleBlock(unit: number): Omit<TitleBlockElement, 'id' | 'x' | 'y' | 'w' | 'h'> {
  return {
    type: 'titleblock',
    title: 'Map Title',
    subtitle: 'Study area · purpose of the map',
    fields: [
      { label: 'Author', value: 'Your name' },
      { label: 'Date', value: '{date}' },
      { label: 'Coordinate system', value: '{crs}' },
      { label: 'Scale', value: '{scale}' },
      { label: 'Source', value: 'ArcWeb · {project}' },
    ],
    fontSize: 7.5 * unit,
    frame: true,
    accent: '#e9844a',
  }
}

type Box = { x: number; y: number; w: number; h: number }

export function buildTemplate(id: LayoutTemplateId, paper: PaperSize, orientation: Orientation): LayoutElement[] {
  const { width, height } = pageSize(paper, orientation)
  const unit = paperUnit(paper)
  const margin = 12 * Math.min(unit, 1.6)
  const gap = 4 * unit
  const at = (box: Box) => ({ id: newId(), x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) })
  const title = (box: Box, size: number, align: 'left' | 'center' = 'center'): LayoutElement =>
    ({ ...at(box), type: 'title', text: 'Map Title', fontSize: size, bold: true, italic: false, align, color: ink })
  const scalebar = (box: Box): LayoutElement => ({ ...at(box), type: 'scalebar', style: 'alternating', showRatio: true, fontSize: 7 * unit, units: 'metric' })
  const north = (box: Box): LayoutElement => ({ ...at(box), type: 'north', style: 'classic' })
  const legend = (box: Box): LayoutElement => ({ ...at(box), type: 'legend', title: 'Legend', fontSize: 8 * unit, frame: true })
  const map = (box: Box): LayoutElement => ({ ...at(box), type: 'map', border: true })
  const innerW = width - margin * 2
  const innerH = height - margin * 2

  switch (id) {
    case 'classic': {
      const titleH = 16 * unit
      const footerH = 30 * unit
      const mapTop = margin + titleH + gap
      const mapH = height - mapTop - footerH - margin - gap
      const footerTop = mapTop + mapH + gap
      const legendW = Math.min(70 * unit, innerW * 0.36)
      const middleW = Math.min(80 * unit, innerW - legendW - 34 * unit)
      return [
        title({ x: margin, y: margin, w: innerW, h: titleH }, 24 * unit),
        map({ x: margin, y: mapTop, w: innerW, h: mapH }),
        legend({ x: margin, y: footerTop, w: legendW, h: footerH }),
        scalebar({ x: margin + legendW + 6, y: footerTop + footerH - 16 * unit, w: middleW, h: 16 * unit }),
        { ...at({ x: margin + legendW + 6, y: footerTop, w: middleW, h: 10 * unit }), type: 'text', text: 'Coordinate system: {crs} · Printed {date}', fontSize: 7 * unit, bold: false, italic: false, align: 'left', color: '#4a545e' },
        north({ x: width - margin - 22 * unit, y: footerTop + (footerH - 26 * unit) / 2, w: 22 * unit, h: 26 * unit }),
      ]
    }
    case 'side-panel': {
      const panelW = Math.min(innerW * 0.3, 78 * unit)
      const mapW = innerW - panelW - gap
      const panelX = margin + mapW + gap
      const blockH = Math.min(innerH * 0.36, 62 * unit)
      const bottomH = 30 * unit
      const legendTop = margin + blockH + gap
      const legendH = innerH - blockH - bottomH - gap * 2
      return [
        map({ x: margin, y: margin, w: mapW, h: innerH }),
        { ...at({ x: panelX, y: margin, w: panelW, h: blockH }), ...defaultTitleBlock(unit) },
        legend({ x: panelX, y: legendTop, w: panelW, h: legendH }),
        north({ x: panelX, y: height - margin - bottomH, w: 20 * unit, h: bottomH * 0.85 }),
        scalebar({ x: panelX + 24 * unit, y: height - margin - 16 * unit, w: panelW - 24 * unit, h: 16 * unit }),
      ]
    }
    case 'title-strip': {
      const stripH = Math.min(innerH * 0.26, 46 * unit)
      const mapH = innerH - stripH - gap
      const stripY = margin + mapH + gap
      const blockW = innerW * 0.5
      const legendW = innerW * 0.28
      const restX = margin + blockW + legendW + gap * 2
      const restW = innerW - blockW - legendW - gap * 2
      return [
        map({ x: margin, y: margin, w: innerW, h: mapH }),
        { ...at({ x: margin, y: stripY, w: blockW, h: stripH }), ...defaultTitleBlock(unit) },
        legend({ x: margin + blockW + gap, y: stripY, w: legendW, h: stripH }),
        north({ x: restX + (restW - 18 * unit) / 2, y: stripY, w: 18 * unit, h: stripH * 0.5 }),
        scalebar({ x: restX, y: stripY + stripH - 16 * unit, w: restW, h: 16 * unit }),
      ]
    }
    case 'minimal': {
      return [
        map({ x: margin, y: margin, w: innerW, h: innerH }),
        title({ x: margin + 4 * unit, y: margin + 4 * unit, w: Math.min(innerW * 0.6, 150 * unit), h: 12 * unit }, 16 * unit, 'left'),
        north({ x: width - margin - 18 * unit, y: margin + 4 * unit, w: 14 * unit, h: 18 * unit }),
        scalebar({ x: margin + 4 * unit, y: height - margin - 18 * unit, w: Math.min(70 * unit, innerW * 0.4), h: 14 * unit }),
      ]
    }
  }
}
