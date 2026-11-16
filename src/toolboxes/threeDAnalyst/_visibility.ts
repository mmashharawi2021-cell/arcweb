import type { Position } from 'geojson'
import { isNoData, rasterCoordinateToWgs84, rasterValue, type RasterGrid } from '../../rasterEngine'
import { localMeters, rasterNativeCoordinate, sampleRasterNative } from './_shared'

export function getPointCoordinates(layerData: { features: { geometry?: { type: string; coordinates?: unknown } | null }[] }, index: number, label: string): [number, number] {
  if (!Number.isInteger(index) || index < 0) throw new Error(`${label} feature number must be a nonnegative integer.`)
  const points = layerData.features.flatMap((feature) =>
    feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
      ? [feature.geometry.coordinates as [number, number]]
      : [])
  if (!points[index]) throw new Error(`The point layer does not contain ${label.toLowerCase()} feature ${index + 1}.`)
  return points[index]
}

export function gridNativeCoordinate(grid: RasterGrid, row: number, column: number): [number, number] {
  return [
    grid.origin[0] + (column + 0.5) * grid.resolution[0],
    grid.origin[1] + (row + 0.5) * grid.resolution[1],
  ]
}

export function metersBetweenGridCoordinates(grid: RasterGrid, a: [number, number], b: [number, number]): number {
  const wgsA = rasterCoordinateToWgs84(a[0], a[1], grid.crs)
  const wgsB = rasterCoordinateToWgs84(b[0], b[1], grid.crs)
  return Math.hypot(...localMeters(wgsA, wgsB, true))
}

export function calculateLineOfSight(
  grid: RasterGrid,
  start: [number, number],
  end: [number, number],
  observerHeight: number,
  targetHeight: number,
  maxSamples = 2_000,
) {
  const startElevation = sampleRasterNative(grid, ...rasterNativeCoordinate(grid, ...start))
  const endElevation = sampleRasterNative(grid, ...rasterNativeCoordinate(grid, ...end))
  if (startElevation === null || endElevation === null) {
    throw new Error('Observer and target must both lie over valid, non-NoData elevation cells.')
  }
  const nativeStart = rasterNativeCoordinate(grid, ...start)
  const nativeEnd = rasterNativeCoordinate(grid, ...end)
  const startColumn = (nativeStart[0] - grid.origin[0]) / grid.resolution[0] - 0.5
  const startRow = (nativeStart[1] - grid.origin[1]) / grid.resolution[1] - 0.5
  const endColumn = (nativeEnd[0] - grid.origin[0]) / grid.resolution[0] - 0.5
  const endRow = (nativeEnd[1] - grid.origin[1]) / grid.resolution[1] - 0.5
  const requiredSteps = Math.max(1, Math.ceil(Math.max(Math.abs(endColumn - startColumn), Math.abs(endRow - startRow)) * 2))
  if (requiredSteps > maxSamples) throw new Error(`Line Of Sight is limited to ${maxSamples.toLocaleString()} terrain intervals. Use a shorter line or a coarser raster.`)
  const steps = requiredSteps
  const eye = startElevation + observerHeight
  const target = endElevation + targetHeight
  const line: (Position & { 0: number; 1: number })[] = []
  let visible = true
  let firstObstructionDistance: number | null = null
  let obstructionElevation: number | null = null
  let noDataSamples = 0
  const distance = metersBetweenGridCoordinates(grid, nativeStart, nativeEnd)
  const wgsStart = rasterCoordinateToWgs84(...nativeStart, grid.crs)
  const wgsEnd = rasterCoordinateToWgs84(...nativeEnd, grid.crs)
  for (let step = 0; step <= steps; step += 1) {
    const fraction = step / steps
    const x = wgsStart[0] + (wgsEnd[0] - wgsStart[0]) * fraction
    const y = wgsStart[1] + (wgsEnd[1] - wgsStart[1]) * fraction
    const lineZ = eye + (target - eye) * fraction
    line.push([x, y, lineZ])
    if (step === 0 || step === steps) continue
    const nativeX = nativeStart[0] + (nativeEnd[0] - nativeStart[0]) * fraction
    const nativeY = nativeStart[1] + (nativeEnd[1] - nativeStart[1]) * fraction
    const terrain = sampleRasterNative(grid, nativeX, nativeY)
    if (terrain === null) { noDataSamples += 1; continue }
    if (terrain > lineZ + 1e-6) {
      visible = false
      if (firstObstructionDistance === null) {
        firstObstructionDistance = distance * fraction
        obstructionElevation = terrain
      }
    }
  }
  return { visible, line, distance, startElevation, endElevation, firstObstructionDistance, obstructionElevation, noDataSamples, nativeStart, nativeEnd, steps }
}

export function lineCoordinateToRasterNative(grid: RasterGrid, coordinate: [number, number]): [number, number] {
  return rasterNativeCoordinate(grid, coordinate[0], coordinate[1])
}

export function terrainElevation(grid: RasterGrid, row: number, column: number): number | null {
  const value = rasterValue(grid, row, column)
  return isNoData(value, grid.noData) ? null : value
}

