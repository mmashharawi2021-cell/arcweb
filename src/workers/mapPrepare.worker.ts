import { loadStoredMapRenders } from '../storage/mapRenderCache'
import type { CollectionRef } from '../storage/projectRepository'
import type { WorkerReply } from './runInWorker'
import type { CachedMapRender } from '../storage/mapRenderCache'

const scope = self as unknown as {
  onmessage: ((event: { data: { database: string; refs: CollectionRef[]; mode?: 'warm' } }) => void) | null
  postMessage(reply: WorkerReply<CachedMapRender[] | null>): void
}
scope.onmessage = ({ data }) => {
  void loadStoredMapRenders(data.database, data.refs)
    .then(value => scope.postMessage({ kind: 'result', value: data.mode === 'warm' ? null : value }))
    .catch((error: unknown) => scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Map preparation failed.' }))
}
