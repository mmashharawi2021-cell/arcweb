import booleanIntersects from '@turf/boolean-intersects'
import type { Feature, Geometry } from 'geojson'
import type { FeatureId, MapLayer } from '../store'
import { bboxGap, featureContains, geometryBBox, makeSpatialIndex, nearestBetween, pairBudget } from '../toolboxes/spatial'

/** Select By Location: choose target features by their spatial relationship to a source layer. */

export const spatialRelationships = [
  { id: 'intersect', label: 'Intersect the source layer', hint: 'Target features that touch or overlap any source feature.' },
  { id: 'within', label: 'Are within the source layer', hint: 'Target features lying completely inside a source feature.' },
  { id: 'contain', label: 'Contain the source layer', hint: 'Target features that completely contain a source feature.' },
  { id: 'within-distance', label: 'Are within a distance of the source layer', hint: 'Target features no farther than the search distance from any source feature (geodesic).' },
] as const
export type SpatialRelationship = typeof spatialRelationships[number]['id']

export interface LocationQuery {
  target: MapLayer
  source: MapLayer
  /** Restrict the source to these features (its current selection). */
  sourceIds?: FeatureId[]
  relationship: SpatialRelationship
  /** Search distance in metres, for `within-distance`. */
  distance?: number
}

const MAX_DISTANCE_PAIRS = 2_000_000

export function selectByLocation({ target, source, sourceIds, relationship, distance = 0 }: LocationQuery): FeatureId[] {
  const wanted = sourceIds ? new Set(sourceIds) : null
  const sources = source.data.features.filter((feature): feature is Feature<Geometry> =>
    feature.geometry !== null && (!wanted || (feature.id !== undefined && wanted.has(feature.id))))
  if (!sources.length) throw new Error(wanted ? 'The source layer has no selected features with geometry.' : 'The source layer has no features with geometry.')
  const targets = target.data.features.filter((feature): feature is Feature<Geometry> & { id: FeatureId } =>
    feature.geometry !== null && feature.id !== undefined)
  const sameLayer = target.id === source.id
  const ids: FeatureId[] = []

  if (relationship === 'within-distance') {
    if (!Number.isFinite(distance) || distance < 0) throw new Error('Enter a search distance of zero or more meters.')
    if (targets.length * sources.length > MAX_DISTANCE_PAIRS) {
      throw new Error(`This would compare more than ${MAX_DISTANCE_PAIRS.toLocaleString('en-US')} feature pairs. Select fewer source features first.`)
    }
    const boxed = sources.map((feature) => ({ feature, bbox: geometryBBox(feature.geometry) }))
    for (const feature of targets) {
      const bbox = geometryBBox(feature.geometry)
      const near = boxed.some((candidate) => !(sameLayer && candidate.feature === feature) &&
        bboxGap(bbox, candidate.bbox) <= distance && nearestBetween(feature, candidate.feature).distance <= distance)
      if (near) ids.push(feature.id)
    }
    return ids
  }

  const index = makeSpatialIndex(sources)
  const spend = pairBudget('Select By Location', 500_000)
  for (const feature of targets) {
    const candidates = index.search(feature).filter((candidate) => !(sameLayer && candidate === feature))
    spend(candidates.length)
    const match = candidates.some((candidate) => relationship === 'within' ? featureContains(candidate, feature)
      : relationship === 'contain' ? featureContains(feature, candidate)
        : booleanIntersects(feature, candidate))
    if (match) ids.push(feature.id)
  }
  return ids
}
