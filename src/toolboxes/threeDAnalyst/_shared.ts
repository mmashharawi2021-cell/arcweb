import { isolate } from '../../bidi'
import proj4 from 'proj4'
import type { Geometry, Position } from 'geojson'
import { Delaunay } from 'd3-delaunay'
import { getCrs } from '../../crs'
import { isNoData, rasterCoordinateToWgs84, rasterValue, type RasterGrid } from '../../rasterEngine'
import type { MapLayer } from '../../store'
import { fieldNames, getLayer } from '../shared'
import type { ToolboxContext, ToolboxParameters } from '../types'

export const THREE_D_CATEGORY = '3D Analyst' as const
export const outputNameParameter = (name: string) => ({ id: 'outputName', label: 'Output name', kind: 'text' as const, defaultValue: name })

export function readNumericValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export interface ElevationSample {
  x: number
  y: number
  z: number
}

export function getElevationSamples(layer: MapLayer, field: string): ElevationSample[] {
  const samples = new Map<string, ElevationSample>()
  for (const feature of layer.data.features) {
    if (feature.geometry?.type !== 'Point') continue
    const [x, y] = feature.geometry.coordinates
    const z = readNumericValue(feature.properties?.[field])
    if (!Number.isFinite(x) || !Number.isFinite(y) || z === null) continue
    samples.set(`${x},${y}`, { x, y, z })
  }
  if (samples.size < 3) throw new Error(`At least three unique point features with numeric values in "${isolate(field)}" are required.`)
  if (samples.size > 20_000) throw new Error('TIN creation is limited to 20,000 unique input points. Reduce or sample the input layer.')
  return [...samples.values()]
}

export function getLayerField(
  context: ToolboxContext,
  parameters: ToolboxParameters,
  layerId: string,
  fieldId: string,
): { layer: MapLayer; field: string } {
  const layer = getLayer(context, parameters, layerId)
  const field = parameters[fieldId]
  if (typeof field !== 'string' || !field.trim() || !fieldNames(layer).includes(field)) {
    throw new Error(`Choose a valid field from "${isolate(layer.name)}".`)
  }
  return { layer, field }
}

export function fieldParameter(id: string, label: string, layerParameter: string) {
  return { id, label, kind: 'field' as const, layerParameter, required: true }
}

export function rasterNativeCoordinate(grid: RasterGrid, x: number, y: number): [number, number] {
  if (grid.crs === 'EPSG:4326' || grid.crs === 'OGC:CRS84') return [x, y]
  try {
    return proj4('EPSG:4326', getCrs(grid.crs)?.proj4 ?? grid.crs, [x, y]) as [number, number]
  } catch (error) {
    throw new Error(`Cannot sample raster coordinates in ${grid.crs}: ${error instanceof Error ? error.message : 'unknown CRS'}`)
  }
}

export function sampleRasterNative(grid: RasterGrid, nativeX: number, nativeY: number): number | null {
  const column = (nativeX - grid.origin[0]) / grid.resolution[0] - 0.5
  const row = (nativeY - grid.origin[1]) / grid.resolution[1] - 0.5
  if (column < -0.5 || row < -0.5 || column > grid.width - 0.5 || row > grid.height - 0.5) return null
  const x0 = Math.floor(column)
  const y0 = Math.floor(row)
  const tx = column - x0
  const ty = row - y0
  const cells = [
    { row: y0, column: x0, weight: (1 - tx) * (1 - ty) },
    { row: y0, column: x0 + 1, weight: tx * (1 - ty) },
    { row: y0 + 1, column: x0, weight: (1 - tx) * ty },
    { row: y0 + 1, column: x0 + 1, weight: tx * ty },
  ]
  let weighted = 0
  let totalWeight = 0
  for (const cell of cells) {
    if (cell.weight <= 0) continue
    const value = rasterValue(grid, cell.row, cell.column)
    if (isNoData(value, grid.noData)) continue
    weighted += value * cell.weight
    totalWeight += cell.weight
  }
  if (totalWeight > 0) return weighted / totalWeight
  const nearest = rasterValue(grid, Math.round(row), Math.round(column))
  return isNoData(nearest, grid.noData) ? null : nearest
}

/** Bilinear sampling with nearest-cell fallback around NoData edges. */
export function sampleRaster(grid: RasterGrid, x: number, y: number): number | null {
  const [nativeX, nativeY] = rasterNativeCoordinate(grid, x, y)
  return sampleRasterNative(grid, nativeX, nativeY)
}

export function addZToGeometry(geometry: Geometry, zAt: (position: Position) => number | null): Geometry {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((child) => addZToGeometry(child, zAt)) }
  }
  const visit = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const position = value as Position
      const z = zAt(position)
      return z === null ? [...position] : [position[0], position[1], z]
    }
    return value.map(visit)
  }
  return { ...geometry, coordinates: visit(geometry.coordinates) } as Geometry
}

export function localMeters(a: [number, number], b: [number, number], geographic: boolean): [number, number] {
  const latitude = (a[1] + b[1]) / 2
  const scaleX = geographic ? 111_319.49079327358 * Math.cos(latitude * Math.PI / 180) : 1
  const scaleY = geographic ? 111_132.92 : 1
  let deltaX = b[0] - a[0]
  if (geographic) deltaX = ((deltaX + 540) % 360) - 180
  return [deltaX * scaleX, (b[1] - a[1]) * scaleY]
}

export function createTinTriangles(samples: ElevationSample[]) {
  const meanLatitude = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length
  const longitudeSin = samples.reduce((sum, sample) => sum + Math.sin(sample.x * Math.PI / 180), 0)
  const longitudeCos = samples.reduce((sum, sample) => sum + Math.cos(sample.x * Math.PI / 180), 0)
  const meanLongitude = Math.atan2(longitudeSin, longitudeCos) * 180 / Math.PI
  const cosLatitude = Math.max(0.01, Math.abs(Math.cos(meanLatitude * Math.PI / 180)))
  const projected = samples.map((sample) => {
    let deltaLongitude = sample.x - meanLongitude
    deltaLongitude = ((deltaLongitude + 540) % 360) - 180
    return [deltaLongitude * cosLatitude, sample.y - meanLatitude] as [number, number]
  })
  const triangulation = Delaunay.from(projected)
  const triangles: { vertices: [ElevationSample, ElevationSample, ElevationSample]; slope: number; aspect: number }[] = []
  for (let index = 0; index < triangulation.triangles.length; index += 3) {
    const indices = [
      triangulation.triangles[index],
      triangulation.triangles[index + 1],
      triangulation.triangles[index + 2],
    ] as [number, number, number]
    const vertices = [
      samples[indices[0]],
      samples[indices[1]],
      samples[indices[2]],
    ] as [ElevationSample, ElevationSample, ElevationSample]
    const [pa, pb, pc] = indices.map((pointIndex) => projected[pointIndex])
    if ((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0) {
      ;[vertices[1], vertices[2]] = [vertices[2], vertices[1]]
    }
    const [a, b, c] = vertices
    const [bx, by] = localMeters([a.x, a.y], [b.x, b.y], true)
    const [cx, cy] = localMeters([a.x, a.y], [c.x, c.y], true)
    const determinant = bx * cy - cx * by
    if (Math.abs(determinant) < 1e-8) continue
    const dzb = b.z - a.z
    const dzc = c.z - a.z
    const dzdx = (dzb * cy - dzc * by) / determinant
    const dzdy = (dzc * bx - dzb * cx) / determinant
    const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI
    let aspect = Math.atan2(-dzdx, -dzdy) * 180 / Math.PI
    if (aspect < 0) aspect += 360
    triangles.push({ vertices, slope, aspect: slope < 1e-10 ? Number.NaN : aspect })
  }
  if (!triangles.length) throw new Error('The input points do not form any valid triangles.')
  return triangles
}

export function terrainGridCenter(grid: RasterGrid, row: number, column: number): [number, number] {
  return rasterCoordinateToWgs84(
    grid.origin[0] + (column + 0.5) * grid.resolution[0],
    grid.origin[1] + (row + 0.5) * grid.resolution[1],
    grid.crs,
  )
}
