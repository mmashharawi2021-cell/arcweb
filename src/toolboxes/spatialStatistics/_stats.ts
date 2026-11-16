import centroid from '@turf/centroid'
import proj4 from 'proj4'
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from 'geojson'
import type { MapLayer } from '../../store'
import { fieldNames, outputLayer } from '../shared'

/**
 * Shared math for the Spatial Statistics toolbox: feature anchors, a local metric
 * frame, attribute readers, case grouping, normal-distribution helpers, FDR, and a
 * seeded RNG. All inputs are WGS 84; distance math runs in metres on an azimuthal
 * equidistant plane centred on the data, and results are converted back to WGS 84.
 */

/** A feature reduced to one location (points as-is, other geometries by centroid). */
export interface Site {
  feature: Feature<Geometry>
  /** Row of the feature in its layer (0-based). */
  row: number
  lon: number
  lat: number
}

export interface PlanarSite extends Site {
  x: number
  y: number
}

export function anchorPosition(feature: Feature<Geometry>): Position {
  if (feature.geometry.type === 'Point') return feature.geometry.coordinates
  return centroid(feature).geometry.coordinates
}

/** Every feature with a usable geometry, reduced to its anchor point. */
export function layerSites(layer: MapLayer): Site[] {
  const sites: Site[] = []
  layer.data.features.forEach((feature, row) => {
    if (!feature.geometry) return
    const [lon, lat] = anchorPosition(feature as Feature<Geometry>)
    if (Number.isFinite(lon) && Number.isFinite(lat)) sites.push({ feature: feature as Feature<Geometry>, row, lon, lat })
  })
  return sites
}

export interface LocalFrame {
  toPlane: (lon: number, lat: number) => [number, number]
  toLonLat: (x: number, y: number) => [number, number]
}

/** Azimuthal equidistant projection (metres) centred on the mean location of the sites. */
export function localFrame(sites: { lon: number; lat: number }[]): LocalFrame {
  let lon0 = 0
  let lat0 = 0
  for (const site of sites) {
    lon0 += site.lon
    lat0 += site.lat
  }
  lon0 /= sites.length || 1
  lat0 /= sites.length || 1
  const converter = proj4('EPSG:4326', `+proj=aeqd +lat_0=${lat0} +lon_0=${lon0} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`)
  return {
    toPlane: (lon, lat) => {
      const [x, y] = converter.forward([lon, lat])
      return [x, y]
    },
    toLonLat: (x, y) => {
      const [lon, lat] = converter.inverse([x, y])
      return [lon, lat]
    },
  }
}

export function projectSites<T extends Site>(sites: T[], frame: LocalFrame = localFrame(sites)): (T & PlanarSite)[] {
  return sites.map((site) => {
    const [x, y] = frame.toPlane(site.lon, site.lat)
    return { ...site, x, y }
  })
}

/** A closed polygon ring traced in the local plane and converted back to WGS 84. */
export function planarPolygon(frame: LocalFrame, trace: (angle: number) => [number, number], vertices = 72): Polygon {
  const ring: Position[] = []
  for (let index = 0; index < vertices; index += 1) {
    const [x, y] = trace((index / vertices) * 2 * Math.PI)
    ring.push(roundPosition(frame.toLonLat(x, y)))
  }
  ring.push([...ring[0]])
  return { type: 'Polygon', coordinates: [ring] }
}

export const roundPosition = ([lon, lat]: Position): Position => [Number(lon.toFixed(9)), Number(lat.toFixed(9))]

/** Tidies a statistic for the attribute table (10 significant digits). */
export const tidy = (value: number) => Number.isFinite(value) ? Number(value.toPrecision(10)) : null

/** Compact text form of a number for messages. */
export const fmt = (value: number, digits = 6) => {
  if (!Number.isFinite(value)) return String(value)
  if (value !== 0 && Math.abs(value) < 1e-4) return value.toExponential(3)
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 8 })
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export function requireField(layer: MapLayer, field: string, label: string) {
  if (field && !fieldNames(layer).includes(field)) throw new Error(`The ${label} "${field}" does not exist in ${layer.name}.`)
}

/** `null` for empty values, NaN for values that are not numbers. */
export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

/** Reads a numeric field for every site; throws if any non-empty value is not a number. */
export function readNumbers(sites: Site[], field: string, label: string): (number | null)[] {
  return sites.map((site) => {
    const value = numericValue(site.feature.properties?.[field])
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`The ${label} "${field}" must be numeric (found "${String(site.feature.properties?.[field])}").`)
    }
    return value
  })
}

/**
 * Sites carrying a numeric analysis value, projected to the local plane. Features with an
 * empty value are excluded; a non-numeric value or constant field is an error.
 */
export function valueSites(layer: MapLayer, field: string, minimum: number, toolName: string) {
  if (!field) throw new Error('Choose an input field.')
  requireField(layer, field, 'input field')
  const sites = layerSites(layer)
  const values = readNumbers(sites, field, 'input field')
  const kept = sites.flatMap((site, index) => values[index] === null ? [] : [{ ...site, value: values[index] as number }])
  if (kept.length < minimum) {
    throw new Error(`${toolName} requires at least ${minimum} features with a location and a value in "${field}" (found ${kept.length}).`)
  }
  const first = kept[0].value
  if (kept.every((site) => site.value === first)) throw new Error(`Every value in "${field}" is the same, so there is no variation to analyze.`)
  return { sites: projectSites(kept), excluded: layer.data.features.length - kept.length }
}

export interface WeightedSite extends Site {
  weight: number
  /** Value of an optional extra numeric field (e.g. Mean Center's dimension field). */
  extra: number | null
}

export interface CaseGroup<T> {
  caseValue: unknown
  sites: T[]
}

/** Groups items by the value of a case field, in first-seen order. */
export function groupByCase<T extends Site>(items: T[], caseField: string): CaseGroup<T>[] {
  if (!caseField) return [{ caseValue: undefined, sites: items }]
  const groups = new Map<string, CaseGroup<T>>()
  for (const item of items) {
    const value = item.feature.properties?.[caseField] ?? null
    const key = value === null ? '\u0000null' : `${typeof value}:${String(value)}`
    let group = groups.get(key)
    if (!group) {
      group = { caseValue: value, sites: [] }
      groups.set(key, group)
    }
    group.sites.push(item)
  }
  return [...groups.values()]
}

/**
 * Common input handling for the Measuring Geographic Distributions tools: anchors,
 * optional weight field (non-negative; empty weights are excluded), optional extra
 * numeric field, and case grouping. Groups smaller than `minimum` are skipped.
 */
export function distributionGroups(layer: MapLayer, options: {
  weightField: string
  caseField: string
  extraField?: string
  minimum: number
  toolName: string
}): { groups: CaseGroup<WeightedSite>[]; excluded: number; skippedCases: number } {
  requireField(layer, options.weightField, 'weight field')
  requireField(layer, options.caseField, 'case field')
  requireField(layer, options.extraField ?? '', 'field')
  const sites = layerSites(layer)
  const weights = options.weightField ? readNumbers(sites, options.weightField, 'weight field') : sites.map(() => 1)
  const extras = options.extraField ? readNumbers(sites, options.extraField, 'field') : sites.map(() => null)
  const usable: WeightedSite[] = []
  sites.forEach((site, index) => {
    const weight = weights[index]
    if (weight === null) return
    if (weight < 0) throw new Error(`Weights cannot be negative (field "${options.weightField}").`)
    if (options.extraField && extras[index] === null) return
    usable.push({ ...site, weight, extra: extras[index] })
  })
  const excluded = layer.data.features.length - usable.length
  const all = groupByCase(usable, options.caseField)
  const groups = all.filter((group) => group.sites.length >= options.minimum && group.sites.some((site) => site.weight > 0))
  if (!groups.length) {
    throw new Error(`${options.toolName} requires at least ${options.minimum} feature${options.minimum === 1 ? '' : 's'} with a usable location${options.weightField ? ' and a positive weight' : ''}${options.caseField ? ' in at least one case' : ''}.`)
  }
  return { groups, excluded, skippedCases: all.length - groups.length }
}

/** Properties carrying the case field value into an output feature. */
export const caseProperties = (caseField: string, caseValue: unknown): Record<string, unknown> =>
  caseField ? { [caseField]: caseValue ?? null } : {}

export function distributionNotes(excluded: number, skippedCases: number, minimum: number): string {
  const notes: string[] = []
  if (excluded) notes.push(`${excluded.toLocaleString()} feature(s) without a usable location or value were excluded`)
  if (skippedCases) notes.push(`${skippedCases.toLocaleString()} case(s) with fewer than ${minimum} usable feature(s) were skipped`)
  return notes.length ? ` Note: ${notes.join('; ')}.` : ''
}

// ---------------------------------------------------------------------------
// Normal distribution and significance
// ---------------------------------------------------------------------------

/** Complementary error function (Numerical Recipes `erfcc`, fractional error < 1.2e-7 everywhere). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}

export const normalCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2)

/** Two-tailed p-value of a standard normal z-score. */
export const twoTailedP = (z: number) => Number.isFinite(z) ? Math.min(1, erfc(Math.abs(z) / Math.SQRT2)) : z === z ? 0 : 1

/** Confidence level (99, 95, 90) at which a p-value is significant, or 0. */
export const confidence = (p: number) => p < 0.01 ? 99 : p < 0.05 ? 95 : p < 0.1 ? 90 : 0

/**
 * ArcGIS-style interpretation of a global pattern statistic. `positive` names the pattern a
 * significant positive z-score indicates (Moran's I: clustered; nearest neighbor: dispersed).
 */
export function interpretPattern(z: number, p: number, positive: 'Clustered' | 'Dispersed' = 'Clustered'): { pattern: 'Clustered' | 'Dispersed' | 'Random'; sentence: string } {
  const level = confidence(p)
  if (!level) {
    return { pattern: 'Random', sentence: `Given the z-score of ${fmt(z, 4)}, the pattern does not appear to be significantly different than random.` }
  }
  const pattern = z > 0 ? positive : positive === 'Clustered' ? 'Dispersed' : 'Clustered'
  return {
    pattern,
    sentence: `Given the z-score of ${fmt(z, 4)}, there is a less than ${100 - level}% likelihood that this ${pattern.toLowerCase()} pattern could be the result of random chance.`,
  }
}

/** p-value cutoffs for 90/95/99% confidence; with FDR, the Benjamini–Hochberg critical p for each level. */
export interface SignificanceCutoffs { p90: number; p95: number; p99: number }

export function significanceCutoffs(pValues: number[], falseDiscoveryRate: boolean): SignificanceCutoffs {
  if (!falseDiscoveryRate) return { p90: 0.1, p95: 0.05, p99: 0.01 }
  const sorted = [...pValues].sort((a, b) => a - b)
  const cutoff = (alpha: number) => {
    let critical = -1
    sorted.forEach((p, index) => {
      if (p <= alpha * (index + 1) / sorted.length) critical = p
    })
    return critical
  }
  return { p90: cutoff(0.1), p95: cutoff(0.05), p99: cutoff(0.01) }
}

/** Confidence bin −3..3 (99/95/90%), signed by the z-score. */
export function confidenceBin(z: number, p: number, cutoffs: SignificanceCutoffs, fdr: boolean): number {
  const within = (cut: number) => fdr ? p <= cut : p < cut
  const level = within(cutoffs.p99) ? 3 : within(cutoffs.p95) ? 2 : within(cutoffs.p90) ? 1 : 0
  return level === 0 ? 0 : Math.sign(z) * level
}

/** Deterministic PRNG (mulberry32) for permutation tests. */
export function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** A geometry-less, one-row table layer holding a tool's summary statistics. */
export function statisticsTable(name: string, row: Record<string, unknown>): MapLayer {
  const table: FeatureCollection<Geometry | null> = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: row }] }
  // Layers hold null geometries for table rows (see `usableFeatures`); the store type is not nullable.
  return outputLayer(name, table as FeatureCollection)
}
