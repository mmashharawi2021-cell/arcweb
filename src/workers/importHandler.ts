import { readGeospatialFile } from '../geo'
import { readGeoTiff } from '../rasterEngine'
import type { ImportRequest, ImportResult } from './importProtocol'

/** KML parsing needs DOMParser, which workers do not have. */
export function needsMainThread(fileName: string): boolean {
  return /\.kml$/i.test(fileName)
}

export async function handleImportRequest({ file }: ImportRequest): Promise<ImportResult> {
  if (/\.(?:tif|tiff)$/i.test(file.name)) {
    const grid = await readGeoTiff(file)
    return { kind: 'raster', name: file.name.replace(/\.(?:tif|tiff)$/i, ''), grid }
  }
  return { kind: 'vector', layers: await readGeospatialFile(file) }
}
