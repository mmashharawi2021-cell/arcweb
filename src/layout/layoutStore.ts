import { create } from 'zustand'
import { isPaperSize, pageSize, paperUnit, type Orientation, type PaperSize } from './paper'
import type { ScaleUnits } from './scaleBar'
import { buildTemplate, defaultTitleBlock, type LayoutTemplateId } from './templates'

export { pageSize, type Orientation, type PaperSize }

/** State of the print layout sheet. All element geometry is in millimetres on the page. */

export type NorthArrowStyle = 'classic' | 'compass' | 'arrow' | 'star'
export type LayoutElementType = 'map' | 'title' | 'text' | 'legend' | 'north' | 'scalebar' | 'titleblock' | 'picture'

interface ElementBase {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface MapFrameElement extends ElementBase { type: 'map'; border: boolean }
export interface TextElement extends ElementBase {
  type: 'title' | 'text'
  text: string
  /** Font size in points. */
  fontSize: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  color: string
}
export interface LegendElement extends ElementBase { type: 'legend'; title: string; fontSize: number; frame: boolean }
export interface NorthArrowElement extends ElementBase { type: 'north'; style: NorthArrowStyle }
export interface ScaleBarElement extends ElementBase {
  type: 'scalebar'
  style: 'alternating' | 'line'
  showRatio: boolean
  fontSize: number
  /** Older layouts have no units and draw metric bars. */
  units?: ScaleUnits
}
/** Bordered title block: title, subtitle and label/value metadata rows (values accept {tokens}). */
export interface TitleBlockElement extends ElementBase {
  type: 'titleblock'
  title: string
  subtitle: string
  fields: { label: string; value: string }[]
  fontSize: number
  frame: boolean
  /** Accent rule colour (printed, so a fixed colour rather than a theme token). */
  accent: string
}

export interface PictureElement extends ElementBase { type: 'picture'; src: string; alt: string; fit: 'contain' | 'cover' }

export type LayoutElement = PictureElement | MapFrameElement | TextElement | LegendElement | NorthArrowElement | ScaleBarElement | TitleBlockElement

export interface LayoutDocument {
  paper: PaperSize
  orientation: Orientation
  elements: LayoutElement[]
}

export const elementLabels: Record<LayoutElementType, string> = {
  map: 'Map frame',
  title: 'Title',
  text: 'Text',
  legend: 'Legend',
  north: 'North arrow',
  scalebar: 'Scale bar',
  titleblock: 'Title block',
  picture: 'Picture',
}

const newId = () => crypto.randomUUID()
const round = (value: number) => Math.round(value * 10) / 10

/** A ready-to-print starting composition: title, map frame, legend, north arrow, scale bar and credits. */
export function defaultElements(paper: PaperSize, orientation: Orientation): LayoutElement[] {
  return buildTemplate('classic', paper, orientation)
}

function createElement(type: LayoutElementType, paper: PaperSize, orientation: Orientation, count: number): LayoutElement {
  const { width, height } = pageSize(paper, orientation)
  const unit = paperUnit(paper)
  // Stagger new elements so repeated inserts do not stack exactly on top of each other.
  const offset = (count % 6) * 4
  const place = (w: number, h: number) => ({ id: newId(), x: round((width - w) / 2 + offset), y: round((height - h) / 2 + offset), w: round(w), h: round(h) })
  switch (type) {
    case 'picture': return { ...place(60 * unit, 40 * unit), type, src: '', alt: 'Picture', fit: 'contain' }
    case 'map': return { ...place(width * 0.7, height * 0.5), type, border: true }
    case 'title': return { ...place(width * 0.7, 16 * unit), y: round(14 + offset), type, text: 'Map Title', fontSize: 24 * unit, bold: true, italic: false, align: 'center', color: '#1b2127' }
    case 'text': return { ...place(70 * unit, 12 * unit), type, text: 'Text', fontSize: 10 * unit, bold: false, italic: false, align: 'left', color: '#1b2127' }
    case 'legend': return { ...place(60 * unit, 42 * unit), type, title: 'Legend', fontSize: 8 * unit, frame: true }
    case 'north': return { ...place(22 * unit, 26 * unit), type, style: 'classic' }
    case 'scalebar': return { ...place(80 * unit, 16 * unit), type, style: 'alternating', showRatio: true, fontSize: 7 * unit, units: 'metric' }
    case 'titleblock': return { ...place(Math.min(width * 0.45, 120 * unit), 46 * unit), ...defaultTitleBlock(unit) }
  }
}

interface LayoutState extends LayoutDocument {
  selectedId: string | null
  setPage: (paper: PaperSize, orientation: Orientation) => void
  addElement: (type: LayoutElementType) => void
  updateElement: (id: string, updates: Partial<LayoutElement>) => void
  removeElement: (id: string) => void
  reorderElement: (id: string, position: 'front' | 'back') => void
  select: (id: string | null) => void
  resetTemplate: () => void
  /** Replaces the sheet with a template; the previous elements can be brought back once. */
  applyTemplate: (id: LayoutTemplateId) => void
  /** Elements as they were before the last template was applied. */
  previousElements: LayoutElement[] | null
  undoTemplate: () => void
  restore: (document: LayoutDocument) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  paper: 'A4',
  orientation: 'landscape',
  elements: defaultElements('A4', 'landscape'),
  selectedId: null,
  previousElements: null,
  setPage: (paper, orientation) => set((state) => {
    if (paper === state.paper && orientation === state.orientation) return state
    // Keep the composition by scaling every element to the new sheet.
    const from = pageSize(state.paper, state.orientation)
    const to = pageSize(paper, orientation)
    const scaleX = to.width / from.width
    const scaleY = to.height / from.height
    const textScale = Math.min(scaleX, scaleY)
    return {
      paper,
      orientation,
      elements: state.elements.map((element) => ({
        ...element,
        x: round(element.x * scaleX),
        y: round(element.y * scaleY),
        w: round(element.w * scaleX),
        h: round(element.h * scaleY),
        ...('fontSize' in element ? { fontSize: round(element.fontSize * textScale) } : {}),
      }) as LayoutElement),
    }
  }),
  addElement: (type) => set((state) => {
    // The map frame hosts the single live map, so a sheet holds at most one.
    const existing = type === 'map' ? state.elements.find((element) => element.type === 'map') : undefined
    if (existing) return { selectedId: existing.id }
    const element = createElement(type, state.paper, state.orientation, state.elements.length)
    return { elements: [...state.elements, element], selectedId: element.id }
  }),
  updateElement: (id, updates) => set((state) => ({
    elements: state.elements.map((element) => element.id === id ? { ...element, ...updates } as LayoutElement : element),
  })),
  removeElement: (id) => set((state) => ({
    elements: state.elements.filter((element) => element.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),
  reorderElement: (id, position) => set((state) => {
    const element = state.elements.find((item) => item.id === id)
    if (!element) return state
    const others = state.elements.filter((item) => item.id !== id)
    return { elements: position === 'front' ? [...others, element] : [element, ...others] }
  }),
  select: (selectedId) => set({ selectedId }),
  resetTemplate: () => set((state) => ({ elements: defaultElements(state.paper, state.orientation), selectedId: null, previousElements: state.elements })),
  applyTemplate: (id) => set((state) => ({ elements: buildTemplate(id, state.paper, state.orientation), selectedId: null, previousElements: state.elements })),
  undoTemplate: () => set((state) => state.previousElements ? { elements: state.previousElements, previousElements: null, selectedId: null } : state),
  restore: (document) => set({
    previousElements: null,
    paper: isPaperSize(document.paper) ? document.paper : 'A4',
    orientation: document.orientation === 'portrait' ? 'portrait' : 'landscape',
    elements: Array.isArray(document.elements) ? document.elements : [],
    selectedId: null,
  }),
}))
