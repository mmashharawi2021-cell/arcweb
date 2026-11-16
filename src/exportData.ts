import Papa from 'papaparse'
import type { FeatureCollection } from 'geojson'
import type { MapLayer } from './store'

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFileName(value: string) {
  return value.trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .split('')
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('') || 'arcweb-export'
}

export function exportLayer(layer: MapLayer, format: 'geojson' | 'csv') {
  const baseName = safeFileName(layer.name)
  if (format === 'geojson') {
    const data: FeatureCollection = { type: 'FeatureCollection', features: layer.data.features }
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json;charset=utf-8' }), `${baseName}.geojson`)
    return
  }
  const fields = [...new Set(layer.data.features.flatMap((feature) => Object.keys(feature.properties ?? {})))]
  let geometryField = '_geometry'
  while (fields.includes(geometryField)) geometryField = `_${geometryField}`
  const rows = layer.data.features.map((feature) => {
    const properties: Record<string, string | number | boolean> = {}
    for (const field of fields) {
      const value = feature.properties?.[field]
      properties[field] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value ?? ''
    }
    properties[geometryField] = feature.geometry ? JSON.stringify(feature.geometry) : ''
    return properties
  })
  const csv = Papa.unparse({ fields: [...fields, geometryField], data: rows })
  download(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`)
}

export function exportMapCanvas(canvas: HTMLCanvasElement, fileName = 'arcweb-map.png'): Promise<void> {
  const scale = 2
  const output = document.createElement('canvas')
  output.width = canvas.width * scale
  output.height = canvas.height * scale
  const context = output.getContext('2d')
  if (!context) throw new Error('The browser could not create an image export surface.')
  context.drawImage(canvas, 0, 0, output.width, output.height)
  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The browser could not encode the map image.'))
        return
      }
      try {
        download(blob, fileName)
        resolve()
      } catch (error) {
        reject(error)
      }
    }, 'image/png')
  })
}
