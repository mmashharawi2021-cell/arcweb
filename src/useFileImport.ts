import { useCallback, useRef, useState } from 'react'
import { isolate } from './bidi'
import { createMapLayer, readGeospatialFile } from './geo'
import { seedMapSourceBlob } from './mapSourceData'
import { isProjectFile } from './project'
import { rasterToFeatureCollection } from './rasterEngine'
import { styleRasterCells } from './rasterStyle'
import { useArcWebStore } from './store'
import { putAsset } from './storage/assets'
import { seedFieldCatalog } from './symbology'
import { needsMainThread } from './workers/importHandler'
import type { ImportResult } from './workers/importProtocol'
import { importInWorker } from './workers/importTransport'
import type { WorkerLike } from './workers/runInWorker'

type Notify = (message: string, kind?: 'success' | 'error' | 'warning') => void

export interface ImportingFile { name: string; index: number; total: number }

interface FileImportOptions {
  notify: Notify
  /** Handles .arcweb.json files dropped or picked alongside data. */
  loadProjectFile: (file: File) => Promise<void>
  /** Keeps the stored original of each imported file with the project. */
  addSourceAsset: (assetId: string) => void
}

/**
 * Imports local data files one at a time (in the import worker where possible), stores the
 * original file as a project asset and adds the resulting layers. Cancelling aborts the
 * current file and skips the rest.
 */
export function useFileImport({ notify, loadProjectFile, addSourceAsset }: FileImportOptions) {
  const [importingFile, setImportingFile] = useState<ImportingFile | null>(null)
  const importAbortRef = useRef<AbortController | null>(null)
  const cancelImport = useCallback(() => importAbortRef.current?.abort(), [])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files)
    for (const [index, file] of selectedFiles.entries()) {
      const controller = new AbortController()
      importAbortRef.current = controller
      setImportingFile({ name: file.name, index: index + 1, total: selectedFiles.length })
      try {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        if (isProjectFile(file)) {
          await loadProjectFile(file)
          continue
        }
        const loaded: ImportResult = needsMainThread(file.name)
          ? { kind: 'vector', layers: await readGeospatialFile(file) }
          : await importInWorker(
            // Worker's handlers take a full MessageEvent; WorkerLike only needs the fields the helper reads.
            () => new Worker(new URL('./workers/import.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike,
            { file },
            controller.signal,
          )
        // Separate result deserialization from the React/store commit so input can run between them.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        if (controller.signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError')
        const sourceId = await putAsset(file, file.name)
        if (controller.signal.aborted) throw new DOMException('Cancelled by user.', 'AbortError')
        addSourceAsset(sourceId)
        if (loaded.kind === 'raster') {
          const raster = loaded.grid
          const data = rasterToFeatureCollection(raster)
          if (!data.features.length) throw new Error('The raster has no valid cells to display.')
          const layer = styleRasterCells(createMapLayer(loaded.name, data, raster.crs))
          useArcWebStore.getState().addLayer(layer)
          notify(`Added raster ${isolate(loaded.name)} (${raster.width.toLocaleString()} × ${raster.height.toLocaleString()} cells).`)
          continue
        }
        const imported = loaded.layers
        const warnings = imported.flatMap((item) => item.warnings.map((warning) => `${isolate(item.name)}: ${warning}`))
        const added = imported.map(({ name, data, sourceCrs, preparedLayer }) => preparedLayer ?? createMapLayer(name, data, sourceCrs))
        imported.forEach((item, index) => {
          if (item.renderBlob) seedMapSourceBlob(added[index].data, item.renderBlob)
          if (item.fieldCatalog) seedFieldCatalog(added[index].data, item.fieldCatalog)
        })
        added.forEach((layer) => useArcWebStore.getState().addLayer(layer))
        const result = `Added ${added.length} layer${added.length === 1 ? '' : 's'} from ${isolate(file.name)}`
        notify(warnings.length ? `${result}. ${warnings.join(' ')}` : result, warnings.length ? 'warning' : 'success')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          notify(`Import of ${isolate(file.name)} cancelled.`, 'warning')
          break
        }
        notify(`Could not import ${isolate(file.name)}: ${error instanceof Error ? error.message : 'Unknown file error'}`, 'error')
      } finally {
        if (importAbortRef.current === controller) importAbortRef.current = null
        setImportingFile(null)
      }
    }
  }, [loadProjectFile, notify, addSourceAsset])

  return { importingFile, addFiles, cancelImport }
}
