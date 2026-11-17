import MapLibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs'
import { loadMapBlob } from './mapBlobProtocol'

// MapLibre exposes protocol registration on its worker global. Blob URLs otherwise
// fall back to main-thread JSON fetching and a second full structured-clone pass.
const scope = self as unknown as {
  worker?: unknown
  addProtocol(name: string, load: (request: { url: string; type?: string }, controller: AbortController) => Promise<{ data: unknown }>): void
}
// Keep the exported constructor live: the package marks modules side-effect-free.
if (!scope.worker) scope.worker = new MapLibreWorker(self)
// MapLibre keys protocols by the prefix before "://"; a Blob URL starts
// "blob:http://" or "blob:https://", not "blob://".
for (const protocol of ['blob', 'blob:http', 'blob:https']) scope.addProtocol(protocol, loadMapBlob)
