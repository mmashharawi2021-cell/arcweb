/** Scale bar and representative-fraction maths for the layout (pure, unit-tested). */

export type ScaleUnits = 'metric' | 'imperial'

const FEET_PER_METER = 3.280839895
const METERS_PER_MILE = 1609.344

/** Largest "nice" distance (1, 2 or 5 × 10ⁿ) not exceeding `max`, with a sensible number of divisions. */
export function niceDistance(max: number): { value: number; divisions: number } {
  const exponent = Math.floor(Math.log10(max))
  const base = 10 ** exponent
  const lead = max / base
  if (lead >= 5) return { value: 5 * base, divisions: 5 }
  if (lead >= 2) return { value: 2 * base, divisions: 4 }
  return { value: base, divisions: 4 }
}

/** "1:24,000"-style ratio, rounded to three significant figures like printed maps. */
export function formatRatio(denominator: number): string {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(denominator)) - 2)
  return `1:${(Math.round(denominator / magnitude) * magnitude).toLocaleString('en-US')}`
}

export interface ScaleBarSpec {
  /** Bar length on paper. */
  barMm: number
  divisions: number
  /** Tick labels from 0 to the full length, in `unitLabel` units. */
  labels: string[]
  unitLabel: 'm' | 'km' | 'ft' | 'mi'
}

/**
 * Picks a round ground distance that fits `availableMm` of paper. Metric bars switch from metres
 * to kilometres at 1 km; imperial bars switch from feet to miles once a mile fits.
 */
export function scaleBarSpec(availableMm: number, groundMetersPerMm: number, units: ScaleUnits = 'metric'): ScaleBarSpec {
  const groundMeters = availableMm * groundMetersPerMm
  let unitMeters: number
  let unitLabel: ScaleBarSpec['unitLabel']
  if (units === 'imperial') {
    const useMiles = groundMeters >= METERS_PER_MILE
    unitMeters = useMiles ? METERS_PER_MILE : 1 / FEET_PER_METER
    unitLabel = useMiles ? 'mi' : 'ft'
  } else {
    const useKilometers = groundMeters >= 1000
    unitMeters = useKilometers ? 1000 : 1
    unitLabel = useKilometers ? 'km' : 'm'
  }
  const { value, divisions } = niceDistance(groundMeters / unitMeters)
  const labels = Array.from({ length: divisions + 1 }, (_, index) =>
    Number((value * index / divisions).toPrecision(6)).toLocaleString('en-US'))
  return { barMm: value * unitMeters / groundMetersPerMm, divisions, labels, unitLabel }
}
