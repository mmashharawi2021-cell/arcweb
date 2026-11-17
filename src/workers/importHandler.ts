import { createMapLayer, readGeospatialFile } from '../geo'
import { readGeoTiff } from '../rasterEngine'
import type { ImportRequest, ImportResult } from './importProtocol'
import { renderCollection } from '../mapSourceData'
import { getFeatureFields, getNumericFields } from '../symbology'

/** KML parsing needs DOMParser, which workers do not have. */
export function needsMainThread(fileName: string): boolean {
  return /\.kml$/i.test(fileName)
}

export async function handleImportRequest({ file }: ImportRequest): Promise<ImportResult> {
  if (/\.(?:tif|tiff)$/i.test(file.name)) {
    const grid = await readGeoTiff(file)
    return { kind: 'raster', name: file.name.replace(/\.(?:tif|tiff)$/i, ''), grid }
  }
  const imported = await readGeospatialFile(file)
  return { kind: 'vector', layers: imported.map((item) => {
    const preparedLayer = createMapLayer(item.name, item.data, item.sourceCrs)
    return { ...item, preparedLayer,
      renderBlob: new Blob([JSON.stringify(renderCollection(item.data))], { type: 'application/geo+json' }),
      fieldCatalog: { fields: getFeatureFields(preparedLayer), numericFields: getNumericFields(preparedLayer) },
    }
  }) }
}
