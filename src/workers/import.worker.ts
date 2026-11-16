import { handleImportRequest } from './importHandler'
import type { ImportRequest, ImportResult } from './importProtocol'
import type { WorkerReply } from './runInWorker'

// The project tsconfig uses the DOM lib, so type the worker global structurally instead of via the WebWorker lib.
const scope = self as unknown as {
  onmessage: ((event: { data: ImportRequest }) => void) | null
  postMessage(message: WorkerReply<ImportResult>): void
}

/** Posting can throw (e.g. a value that cannot be structured-cloned); report that instead of hanging the caller. */
const post = (message: WorkerReply<ImportResult>) => {
  try {
    scope.postMessage(message)
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The import result could not be sent.' })
  }
}

scope.onmessage = (event) => {
  handleImportRequest(event.data).then(
    (value) => post({ kind: 'result', value }),
    (error: unknown) => post({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown file error' }),
  )
}
