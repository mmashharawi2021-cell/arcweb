import { handleImportRequest } from './importHandler'
import type { ImportRequest, ImportResult } from './importProtocol'
import type { WorkerReply } from './runInWorker'

// The project tsconfig uses the DOM lib, so type the worker global structurally instead of via the WebWorker lib.
const scope = self as unknown as {
  onmessage: ((event: { data: ImportRequest }) => void) | null
  postMessage(message: WorkerReply<ImportResult>): void
}

scope.onmessage = (event) => {
  handleImportRequest(event.data).then(
    (value) => scope.postMessage({ kind: 'result', value }),
    (error: unknown) => scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown file error' }),
  )
}
