import { isolate } from '../../bidi'
import { isNoData } from '../../rasterEngine'
import { assertAlignedGrids, getBandGrids, getPositiveNumber, gridOutput, outputName, IMAGE_ANALYST_CATEGORY } from './_shared'
import type { ToolboxTool } from '../types'

function squaredDistance(values: Float32Array, offset: number, center: Float64Array): number {
  let distance = 0
  for (let band = 0; band < center.length; band += 1) {
    const delta = values[offset + band] - center[band]
    distance += delta * delta
  }
  return distance
}

export const isoClusterTool: ToolboxTool = {
  id: 'isoClusterUnsupervisedClassification',
  name: 'Iso Cluster Unsupervised Classification',
  category: IMAGE_ANALYST_CATEGORY,
  subcategory: 'Classification',
  description: 'Classify aligned raster bands with deterministic, standardized K-means clustering and farthest-first initialization.',
  keywords: ['classification', 'unsupervised', 'K-means', 'iso cluster', 'clusters'],
  parameters: [
    { id: 'file', label: 'Multi-band GeoTIFF (optional)', kind: 'file', accept: '.tif,.tiff,image/tiff' },
    { id: 'bandRasters', label: 'Separate aligned raster bands (select in band order)', kind: 'layers' },
    { id: 'valueField', label: 'Raster value field', kind: 'text', defaultValue: 'value' },
    { id: 'classes', label: 'Number of classes', kind: 'number', defaultValue: 5, min: 2, max: 20, step: 1 },
    { id: 'iterations', label: 'Maximum iterations', kind: 'number', defaultValue: 20, min: 1, max: 100, step: 1 },
    { id: 'outputName', label: 'Output name', kind: 'text', defaultValue: 'Iso Cluster classes' },
  ],
  execute: async (context, parameters) => {
    const { grids, name } = await getBandGrids(context, parameters, { maxLayers: 10, maxGeoTiffBands: 10 })
    assertAlignedGrids(grids)
    if (grids.length > 10) throw new Error('Use no more than 10 input bands.')
    const classes = getPositiveNumber(parameters, 'classes', 'Number of classes', 5)
    const iterations = getPositiveNumber(parameters, 'iterations', 'Maximum iterations', 20)
    if (!Number.isInteger(classes) || classes < 2 || classes > 20) throw new Error('Number of classes must be an integer from 2 to 20.')
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('Maximum iterations must be an integer from 1 to 100.')
    const first = grids[0]
    if (first.values.length * classes * iterations > 50_000_000) {
      throw new Error('Classification exceeds the 50 million cell/class/iteration work limit. Reduce classes or iterations.')
    }

    const validIndices: number[] = []
    for (let index = 0; index < first.values.length; index += 1) {
      if (grids.every((grid) => !isNoData(grid.values[index], grid.noData))) validIndices.push(index)
    }
    if (validIndices.length < classes) throw new Error('The raster bands have fewer valid cells than requested classes.')

    const bandCount = grids.length
    const samples = new Float32Array(validIndices.length * bandCount)
    const means = new Float64Array(bandCount)
    const variances = new Float64Array(bandCount)
    for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
      for (let band = 0; band < bandCount; band += 1) {
        const value = grids[band].values[validIndices[sampleIndex]]
        samples[sampleIndex * bandCount + band] = value
        means[band] += value
      }
    }
    for (let band = 0; band < bandCount; band += 1) means[band] /= validIndices.length
    for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
      for (let band = 0; band < bandCount; band += 1) {
        const delta = samples[sampleIndex * bandCount + band] - means[band]
        variances[band] += delta * delta
      }
    }
    const scales = new Float64Array(bandCount)
    for (let band = 0; band < bandCount; band += 1) {
      scales[band] = Math.sqrt(variances[band] / validIndices.length) || 1
    }
    for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
      for (let band = 0; band < bandCount; band += 1) {
        const offset = sampleIndex * bandCount + band
        samples[offset] = (samples[offset] - means[band]) / scales[band]
      }
    }

    const centers: Float64Array[] = [Float64Array.from(samples.slice(0, bandCount))]
    const nearestDistances = new Float64Array(validIndices.length).fill(Infinity)
    while (centers.length < classes) {
      const lastCenter = centers[centers.length - 1]
      let nextIndex = 0
      let farthestDistance = -1
      for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
        const distance = squaredDistance(samples, sampleIndex * bandCount, lastCenter)
        if (distance < nearestDistances[sampleIndex]) nearestDistances[sampleIndex] = distance
        if (nearestDistances[sampleIndex] > farthestDistance) {
          farthestDistance = nearestDistances[sampleIndex]
          nextIndex = sampleIndex
        }
      }
      centers.push(Float64Array.from(samples.slice(nextIndex * bandCount, (nextIndex + 1) * bandCount)))
    }

    const assignments = new Int32Array(validIndices.length).fill(-1)
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const sums = Array.from({ length: classes }, () => new Float64Array(bandCount))
      const counts = new Uint32Array(classes)
      let changed = false
      for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
        const offset = sampleIndex * bandCount
        let closest = 0
        let distance = squaredDistance(samples, offset, centers[0])
        for (let classIndex = 1; classIndex < classes; classIndex += 1) {
          const candidateDistance = squaredDistance(samples, offset, centers[classIndex])
          if (candidateDistance < distance) {
            distance = candidateDistance
            closest = classIndex
          }
        }
        if (assignments[sampleIndex] !== closest) changed = true
        assignments[sampleIndex] = closest
        counts[closest] += 1
        for (let band = 0; band < bandCount; band += 1) sums[closest][band] += samples[offset + band]
      }
      for (let classIndex = 0; classIndex < classes; classIndex += 1) {
        if (!counts[classIndex]) continue
        for (let band = 0; band < bandCount; band += 1) centers[classIndex][band] = sums[classIndex][band] / counts[classIndex]
      }
      if (!changed) break
    }

    const values = new Float32Array(first.values.length).fill(Number.NaN)
    for (let sampleIndex = 0; sampleIndex < validIndices.length; sampleIndex += 1) {
      values[validIndices[sampleIndex]] = assignments[sampleIndex] + 1
    }
    const output = gridOutput(outputName(parameters, `${name} Iso Cluster`), { ...first, values, noData: Number.NaN })
    return {
      message: `${isolate(output.name)}: assigned ${validIndices.length.toLocaleString()} valid cells to ${classes} deterministic K-means classes using ${grids.length} band(s).`,
      layers: [output],
    }
  },
}
