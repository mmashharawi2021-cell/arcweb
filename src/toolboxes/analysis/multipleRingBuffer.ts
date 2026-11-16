import { isolate } from '../../bidi'
import type { Feature } from 'geojson'
import { featureCollection } from '@turf/helpers'
import { getLayer, getOptionalText, getText, outputLayer } from '../shared'
import { assertHasFeatures, usableFeatures } from '../spatial'
import type { ToolboxTool } from '../types'
import {
  bufferGeometry, cleanPolygonGeometry, distanceUnitParameter, outputName, outputNameParameter, parseList, polygonFeature,
  subtractPolygons, unionPolygons, unitFactor, unitLabel, type PolygonGeometry,
} from './_utils'

const MAX_RINGS = 50

/**
 * Multiple Ring Buffer: concentric, non-overlapping rings at several distances. Each
 * ring covers the band between the previous distance and its own `distance`.
 */
export const multipleRingBufferTool: ToolboxTool = {
  id: 'multiple-ring-buffer',
  name: 'Multiple Ring Buffer',
  category: 'Analysis',
  subcategory: 'Proximity',
  description: 'Create non-overlapping concentric buffer rings at several distances around input features.',
  keywords: ['rings', 'concentric', 'distance bands', 'buffer', 'proximity', 'zones'],
  parameters: [
    { id: 'target', label: 'Input features', kind: 'layer', required: true },
    { id: 'distances', label: 'Distances (comma separated)', kind: 'text', required: true, defaultValue: '100, 250, 500', placeholder: '100, 250, 500' },
    distanceUnitParameter,
    {
      id: 'dissolve', label: 'Dissolve option', kind: 'select', defaultValue: 'ALL',
      options: [
        { value: 'ALL', label: 'All — rings are bands around all features' },
        { value: 'NONE', label: 'None — separate rings for each feature' },
      ],
    },
    outputNameParameter('Multiple ring buffer'),
  ],
  execute: (context, parameters) => {
    const target = getLayer(context, parameters, 'target')
    const values = parseList(getText(parameters, 'distances', 'at least one distance')).map((text) => {
      const value = Number(text)
      if (!Number.isFinite(value) || value <= 0) throw new Error(`"${text}" is not a valid positive distance.`)
      return value
    })
    const distances = [...new Set(values)].sort((a, b) => a - b)
    if (distances.length > MAX_RINGS) throw new Error(`Use at most ${MAX_RINGS} distances.`)
    const factor = unitFactor(parameters)
    const units = unitLabel(parameters)
    const perFeature = getOptionalText(parameters, 'dissolve') === 'NONE'
    const features = usableFeatures(target)
    assertHasFeatures(features, 'The input layer has no usable geometries.')

    const rings: Feature<PolygonGeometry>[] = []
    const addRings = (discs: (PolygonGeometry | null)[], properties: Record<string, unknown>) => {
      let previous: PolygonGeometry | null = null
      discs.forEach((disc, position) => {
        if (!disc) return
        const ring = previous ? subtractPolygons(polygonFeature(disc), [polygonFeature(previous)]) : cleanPolygonGeometry(disc)
        if (ring) rings.push(polygonFeature(ring, { ...properties, distance: distances[position], UNITS: units }))
        previous = disc
      })
    }
    if (perFeature) {
      for (const feature of features) addRings(distances.map((distance) => bufferGeometry(feature, distance * factor)), { ...(feature.properties ?? {}) })
    } else {
      addRings(distances.map((distance) => {
        const discs = features.flatMap((feature) => {
          const disc = bufferGeometry(feature, distance * factor)
          return disc ? [polygonFeature(disc)] : []
        })
        return cleanPolygonGeometry(unionPolygons(discs))
      }), {})
    }
    assertHasFeatures(rings, 'No buffer rings could be created.')
    const output = outputLayer(outputName(parameters, `${target.name} MultiRingBuffer`), featureCollection(rings), target.sourceCrs)
    return { message: `${isolate(output.name)}: created ${rings.length.toLocaleString()} rings at ${distances.join(', ')} ${units.toLowerCase()}.`, layers: [output] }
  },
}
