import area from '@turf/area'
import buffer from '@turf/buffer'
import booleanIntersects from '@turf/boolean-intersects'
import { featureCollection } from '@turf/helpers'
import { union } from '@turf/union'
import type { Feature, Geometry } from 'geojson'
import { getLayer, getNumber, getOptionalText, outputLayer } from '../shared'
import { assertHasFeatures, isPolygon, makeSpatialIndex, pairBudget, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import { optionalNumber, outputNameParameter } from '../dataManagement/_utils'
import { validGeometry } from '../dataManagement/_generalize'
import { isolate } from '../../bidi'

const MAX_POLYGONS = 10_000

/** Joins nearby polygons by buffering each side of the gap, dissolving, then restoring the boundary. */
export const aggregatePolygonsTool: ToolboxTool = {
  id: 'aggregate-polygons',
  name: 'Aggregate Polygons',
  category: 'Cartography',
  subcategory: 'Generalization',
  description: 'Combine intersecting or nearby polygons by closing gaps up to a specified distance. Runs locally in your browser.',
  keywords: ['generalize', 'cluster', 'merge', 'proximity', 'polygons'],
  parameters: [
    { id: 'target', label: 'Input polygon layer', kind: 'layer', required: true },
    { id: 'distance', label: 'Aggregation distance (m)', kind: 'number', required: true, min: 0, defaultValue: 100 },
    { id: 'minimumArea', label: 'Minimum output area (m², optional)', kind: 'number', min: 0 },
    outputNameParameter('Aggregated polygons'),
  ],
  execute: (context, parameters) => {
    const layer = getLayer(context, parameters, 'target')
    const distance = getNumber(parameters, 'distance', 'aggregation distance')
    if (distance < 0) throw new Error('Aggregation distance must be zero or greater.')
    const minimumArea = optionalNumber(parameters, 'minimumArea', 'minimum area')
    if (minimumArea !== null && minimumArea < 0) throw new Error('Minimum area must be zero or greater.')
    const polygons = usableFeatures(layer).filter(isPolygon)
    assertHasFeatures(polygons, 'Aggregate Polygons needs a polygon layer.')
    if (polygons.length > MAX_POLYGONS) throw new Error(`Aggregate Polygons supports at most ${MAX_POLYGONS.toLocaleString()} input features.`)

    const buffered = distance > 0
      ? polygons.map((feature) => {
        const expanded = buffer(feature, distance / 2000, { units: 'kilometers' })
        if (!expanded) throw new Error('One or more polygons could not be buffered; check geometry validity.')
        return expanded
      })
      : polygons
    const parent = buffered.map((_, index) => index)
    const find = (index: number): number => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]]
        index = parent[index]
      }
      return index
    }
    const join = (a: number, b: number) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent[rootB] = rootA
    }
    const index = makeSpatialIndex(buffered)
    const positions = new Map(buffered.map((feature, featureIndex) => [feature, featureIndex]))
    const budget = pairBudget('Aggregate Polygons')
    for (let featureIndex = 0; featureIndex < buffered.length; featureIndex += 1) {
      for (const candidate of index.search(buffered[featureIndex])) {
        const candidateIndex = positions.get(candidate)
        if (candidateIndex === undefined) continue
        if (candidateIndex <= featureIndex) continue
        budget(1)
        if (booleanIntersects(buffered[featureIndex], candidate)) join(featureIndex, candidateIndex)
      }
    }

    const groups = new Map<number, number[]>()
    parent.forEach((_, indexValue) => {
      const root = find(indexValue)
      groups.set(root, [...(groups.get(root) ?? []), indexValue])
    })
    const outputs: Feature<Geometry>[] = []
    for (const members of groups.values()) {
      let geometry: Geometry | null
      if (members.length === 1) {
        geometry = polygons[members[0]].geometry
      } else {
        const merged = union(featureCollection(members.map((member) => buffered[member])))
        if (!merged) continue
        const restored = distance > 0 ? buffer(merged, -distance / 2000, { units: 'kilometers' }) : merged
        geometry = restored?.geometry ? validGeometry(restored.geometry) : null
      }
      if (!geometry) continue
      const candidate: Feature<Geometry> = {
        type: 'Feature',
        properties: { ...(polygons[members[0]].properties ?? {}), SOURCE_COUNT: members.length },
        geometry,
      }
      if (minimumArea !== null) {
        if (area(candidate) < minimumArea) continue
      }
      outputs.push(candidate)
    }
    assertHasFeatures(outputs, 'No valid polygon aggregates remain after applying the minimum-area filter.')
    const name = getOptionalText(parameters, 'outputName') || `${layer.name} Aggregated`
    const result = outputLayer(name, featureCollection(outputs), layer.sourceCrs)
    return { message: `${isolate(name)}: created ${outputs.length.toLocaleString()} polygon aggregates from ${polygons.length.toLocaleString()} input polygons.`, layers: [result] }
  },
}
