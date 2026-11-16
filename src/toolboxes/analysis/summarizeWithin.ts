import { isolate } from '../../bidi'
import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson'
import { getLayer, getOptionalText, outputLayer } from '../shared'
import type { ToolboxTool } from '../types'
import { outputName, outputNameParameter, resolveField, toNumber } from './_utils'

type SummaryStatistic = 'SUM' | 'MEAN' | 'MIN' | 'MAX' | 'COUNT'

function parseStatistics(text: string, resolve: (field: string) => string) {
  if (!text.trim()) return []
  return text.split(',').map((item) => {
    const match = /^(.+?)\s+([A-Za-z]+)$/.exec(item.trim())
    const statistic = match?.[2].toUpperCase() as SummaryStatistic | undefined
    if (!match || !statistic || !['SUM', 'MEAN', 'MIN', 'MAX', 'COUNT'].includes(statistic)) {
      throw new Error('Write statistics as FIELD SUM, FIELD MEAN, FIELD MIN, FIELD MAX or FIELD COUNT.')
    }
    const field = resolve(match[1].trim())
    return { field, statistic, output: `${statistic}_${field}` }
  })
}

function within(summary: Feature, zone: Feature<Polygon | MultiPolygon>): boolean {
  if (!summary.geometry || !zone.geometry) return false
  try {
    if (summary.geometry.type === 'Point') return booleanPointInPolygon(point(summary.geometry.coordinates), zone)
    if (summary.geometry.type === 'MultiPoint') {
      return summary.geometry.coordinates.some((coordinate) => booleanPointInPolygon(point(coordinate), zone))
    }
    return booleanIntersects(summary, zone)
  } catch {
    return false
  }
}

function summarize(values: unknown[], statistic: SummaryStatistic): unknown {
  if (statistic === 'COUNT') return values.filter((value) => value !== null && value !== undefined && value !== '').length
  const numbers = values.map(toNumber).filter((value): value is number => value !== null)
  if (!numbers.length) return null
  if (statistic === 'SUM') return numbers.reduce((sum, value) => sum + value, 0)
  if (statistic === 'MEAN') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
  return statistic === 'MIN' ? Math.min(...numbers) : Math.max(...numbers)
}

/** Summarize Within: enrich each polygon zone with a feature count and optional attribute statistics. */
export const summarizeWithinTool: ToolboxTool = {
  id: 'summarize-within',
  name: 'Summarize Within',
  category: 'Analysis',
  subcategory: 'Statistics',
  description: 'Count and summarize features that fall within each polygon zone.',
  keywords: ['summarize', 'within', 'spatial statistics', 'count', 'aggregate', 'zones'],
  parameters: [
    { id: 'zones', label: 'Input polygon zones', kind: 'layer', required: true },
    { id: 'summary', label: 'Input summary features', kind: 'layer', required: true },
    { id: 'statistics', label: 'Statistics (optional; FIELD SUM/MEAN/MIN/MAX/COUNT)', kind: 'text', placeholder: 'POP SUM, VALUE MEAN' },
    outputNameParameter('Summarized zones'),
  ],
  execute: (context, parameters) => {
    const zones = getLayer(context, parameters, 'zones')
    const summaryLayer = getLayer(context, parameters, 'summary')
    const zoneFeatures = zones.data.features.filter((feature): feature is Feature<Polygon | MultiPolygon> =>
      feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    if (!zoneFeatures.length) throw new Error('The input zone layer must contain polygon features.')
    const summaries = summaryLayer.data.features.filter((feature) => feature.geometry)
    const requests = parseStatistics(getOptionalText(parameters, 'statistics'), (name) => resolveField(summaryLayer, name))
    const features: Feature<Geometry>[] = zoneFeatures.map((zone) => {
      const matched = summaries.filter((feature) => within(feature, zone))
      const properties: Record<string, unknown> = { ...(zone.properties ?? {}), FEATURE_COUNT: matched.length }
      for (const request of requests) properties[request.output] = summarize(matched.map((feature) => feature.properties?.[request.field]), request.statistic)
      return { ...zone, properties }
    })
    const result = outputLayer(outputName(parameters, `${zones.name} Summarized`), { ...zones.data, features })
    result.customFields = [...new Set([...(zones.customFields ?? []), 'FEATURE_COUNT', ...requests.map((request) => request.output)])]
    return { message: `${isolate(result.name)}: summarized ${summaries.length.toLocaleString()} features in ${features.length.toLocaleString()} zones.`, layers: [result] }
  },
}
