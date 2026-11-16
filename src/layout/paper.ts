/** Paper sizes for the print layout, in millimetres (portrait: short side × long side). */

export type PaperSize = 'A4' | 'A3' | 'A2' | 'Letter' | 'Legal' | 'Tabloid'
export type Orientation = 'portrait' | 'landscape'

export const PAPER_SIZES: { id: PaperSize; label: string; mm: [number, number] }[] = [
  { id: 'A4', label: 'A4 · 210 × 297 mm', mm: [210, 297] },
  { id: 'A3', label: 'A3 · 297 × 420 mm', mm: [297, 420] },
  { id: 'A2', label: 'A2 · 420 × 594 mm (poster)', mm: [420, 594] },
  { id: 'Letter', label: 'US Letter · 8.5 × 11 in', mm: [215.9, 279.4] },
  { id: 'Legal', label: 'US Legal · 8.5 × 14 in', mm: [215.9, 355.6] },
  { id: 'Tabloid', label: 'Tabloid · 11 × 17 in', mm: [279.4, 431.8] },
]

export function isPaperSize(value: unknown): value is PaperSize {
  return PAPER_SIZES.some((paper) => paper.id === value)
}

export function pageSize(paper: PaperSize, orientation: Orientation): { width: number; height: number } {
  const [short, long] = (PAPER_SIZES.find((item) => item.id === paper) ?? PAPER_SIZES[0]).mm
  return orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short }
}

/** Size factor relative to A4, used to scale default text and element sizes on larger sheets. */
export function paperUnit(paper: PaperSize): number {
  return pageSize(paper, 'portrait').width / 210
}
