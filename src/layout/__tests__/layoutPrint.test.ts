import { beforeEach, describe, expect, it } from 'vitest'
import { resolveDynamicText, type DynamicTextContext } from '../dynamicText'
import { effectiveExportDpi } from '../exportLayout'
import { useLayoutStore } from '../layoutStore'
import { PAPER_SIZES, pageSize, paperUnit, type Orientation } from '../paper'
import { formatRatio, scaleBarSpec } from '../scaleBar'
import { buildTemplate, LAYOUT_TEMPLATES } from '../templates'

describe('scale bar', () => {
  it('picks round metric distances and switches to kilometres', () => {
    // 70 mm of paper at 1 mm = 10 m → 700 m available → 500 m bar of 5 divisions.
    const metres = scaleBarSpec(70, 10)
    expect(metres).toMatchObject({ unitLabel: 'm', divisions: 5, barMm: 50 })
    expect(metres.labels).toEqual(['0', '100', '200', '300', '400', '500'])
    const kilometres = scaleBarSpec(70, 100)
    expect(kilometres).toMatchObject({ unitLabel: 'km', barMm: 50 })
    expect(kilometres.labels.at(-1)).toBe('5')
  })

  it('draws imperial bars in feet, then miles once a mile fits', () => {
    const feet = scaleBarSpec(70, 1, 'imperial')
    expect(feet.unitLabel).toBe('ft')
    expect(feet.labels.at(-1)).toBe('200')
    expect(feet.barMm).toBeCloseTo(200 / 3.280839895, 5)
    const miles = scaleBarSpec(70, 100, 'imperial')
    expect(miles.unitLabel).toBe('mi')
    expect(miles.labels.at(-1)).toBe('2')
    expect(miles.barMm).toBeCloseTo(2 * 1609.344 / 100, 5)
  })

  it('formats representative fractions to three significant figures', () => {
    expect(formatRatio(24_123)).toBe('1:24,100')
    expect(formatRatio(512)).toBe('1:512')
  })
})

describe('dynamic text', () => {
  const context: DynamicTextContext = {
    now: new Date(2026, 10, 15, 9, 30), projectName: 'Flood study', crsName: 'WGS 84', crsCode: 'EPSG:4326',
    scaleDenominator: 25_000, layerCount: 3, paper: 'A3 landscape',
  }

  it('replaces known tokens, case-insensitively', () => {
    expect(resolveDynamicText('{project} · {CRS} ({crsCode}) · {scale} · {layers} layers · {year}', context))
      .toBe('Flood study · WGS 84 (EPSG:4326) · 1:25,000 · 3 layers · 2026')
    // Dates follow the user's locale (digits and month names may not be Latin).
    expect(resolveDynamicText('{date}', context)).toBe(context.now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))
  })

  it('leaves unknown tokens and plain braces alone, and shows — without a map frame', () => {
    expect(resolveDynamicText('{author} {} {scale}', { ...context, scaleDenominator: null })).toBe('{author} {} —')
  })
})

describe('layout templates', () => {
  const orientations: Orientation[] = ['portrait', 'landscape']
  for (const template of LAYOUT_TEMPLATES) {
    it(`"${template.name}" has one map frame and stays on every sheet`, () => {
      for (const paper of PAPER_SIZES) {
        for (const orientation of orientations) {
          const elements = buildTemplate(template.id, paper.id, orientation)
          const { width, height } = pageSize(paper.id, orientation)
          expect(elements.filter((element) => element.type === 'map')).toHaveLength(1)
          for (const element of elements) {
            expect(element.w).toBeGreaterThan(0)
            expect(element.h).toBeGreaterThan(0)
            expect(element.x).toBeGreaterThanOrEqual(0)
            expect(element.y).toBeGreaterThanOrEqual(0)
            expect(element.x + element.w).toBeLessThanOrEqual(width + 0.1)
            expect(element.y + element.h).toBeLessThanOrEqual(height + 0.1)
          }
        }
      }
    })
  }

  it('scales element sizes with the paper', () => {
    expect(paperUnit('A4')).toBe(1)
    expect(paperUnit('A2')).toBe(2)
  })
})

describe('layout store templates', () => {
  beforeEach(() => useLayoutStore.getState().restore({ paper: 'A4', orientation: 'landscape', elements: buildTemplate('classic', 'A4', 'landscape') }))

  it('applies a template and can undo it once', () => {
    const before = useLayoutStore.getState().elements
    useLayoutStore.getState().applyTemplate('side-panel')
    expect(useLayoutStore.getState().elements.some((element) => element.type === 'titleblock')).toBe(true)
    useLayoutStore.getState().undoTemplate()
    expect(useLayoutStore.getState().elements).toBe(before)
    expect(useLayoutStore.getState().previousElements).toBeNull()
  })

  it('inserts a title block and rescales the sheet to a new paper size', () => {
    useLayoutStore.getState().addElement('titleblock')
    const block = useLayoutStore.getState().elements.at(-1)!
    expect(block.type).toBe('titleblock')
    useLayoutStore.getState().setPage('Tabloid', 'landscape')
    const moved = useLayoutStore.getState().elements.find((element) => element.id === block.id)!
    expect(moved.w).toBeGreaterThan(block.w)
    expect(useLayoutStore.getState().paper).toBe('Tabloid')
  })
})

describe('export resolution guard', () => {
  it('keeps the requested dpi when the sheet fits', () => {
    expect(effectiveExportDpi(297, 210, 300)).toEqual({ dpi: 300, capped: false })
  })

  it('lowers the dpi for very large sheets so the canvas stays under the pixel budget', () => {
    const result = effectiveExportDpi(594, 420, 600)
    expect(result.capped).toBe(true)
    expect(result.dpi).toBeLessThan(600)
    const pixels = (594 / 25.4 * result.dpi) * (420 / 25.4 * result.dpi)
    expect(pixels).toBeLessThanOrEqual(100_000_000)
  })
})
