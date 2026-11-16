import { Compass, FileText, ListTree, Map as MapIcon, PanelBottom, Ruler, Type } from 'lucide-react'
import type { LayoutElementType, NorthArrowStyle } from './layoutStore'

/** Static catalogs shared by the layout ribbon, panel and sheet. */

export const insertableElements: { type: LayoutElementType; icon: typeof MapIcon }[] = [
  { type: 'map', icon: MapIcon },
  { type: 'title', icon: Type },
  { type: 'text', icon: FileText },
  { type: 'legend', icon: ListTree },
  { type: 'north', icon: Compass },
  { type: 'scalebar', icon: Ruler },
  { type: 'titleblock', icon: PanelBottom },
]

export const layoutDpiOptions = [150, 200, 300, 600] as const

export const northArrowStyles: { id: NorthArrowStyle; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'compass', label: 'Compass rose' },
  { id: 'star', label: 'Star' },
]

const POINT_MM = 25.4 / 72
/** Converts a font size in points to screen pixels at the sheet's current scale (px per mm). */
export const pointsToPx = (points: number, scale: number) => points * POINT_MM * scale
