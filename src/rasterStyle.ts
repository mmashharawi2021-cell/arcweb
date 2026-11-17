import type { MapLayer } from './store'

/** Gives imported raster cells an 8-class quantile renderer on their `value` field. */
export function styleRasterCells(layer: MapLayer): MapLayer {
  const values = layer.data.features
    .map((feature) => feature.properties?.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right)
  if (!values.length) return layer
  const breaks: number[] = []
  for (let index = 1; index < 8; index += 1) {
    const value = values[Math.floor(index * values.length / 8)]
    if (value !== undefined && value > (breaks[breaks.length - 1] ?? -Infinity)) breaks.push(value)
  }
  const palette = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#a50026']
  const colors = Array.from({ length: breaks.length + 1 }, (_, index) =>
    palette[Math.round(index * (palette.length - 1) / Math.max(1, breaks.length))],
  )
  return {
    ...layer,
    opacity: 1,
    strokeWidth: 0,
    fillColor: colors[0] ?? layer.fillColor,
    strokeColor: colors[0] ?? layer.strokeColor,
    renderer: { type: 'graduated', field: 'value', method: 'quantile', breaks, colors },
  }
}
