import { handleImportRequest } from './importHandler'
import type { ImportRequest, ImportWireResult } from './importProtocol'
import type { WorkerReply } from './runInWorker'
import { streamImportResult } from './importTransport'

// The project tsconfig uses the DOM lib, so type the worker global structurally instead of via the WebWorker lib.
const scope = self as unknown as {
  onmessage: ((event: { data: ImportRequest | { kind: 'ack' } }) => void) | null
  postMessage(message: WorkerReply<ImportWireResult>): void
}

/** Posting can throw (e.g. a value that cannot be structured-cloned); report that instead of hanging the caller. */
const post = (message: WorkerReply<ImportWireResult>) => {
  try {
    scope.postMessage(message)
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The import result could not be sent.' })
  }
}

let acknowledge: (() => void) | null = null
let started = false
scope.onmessage = (event) => {
  if ('kind' in event.data && event.data.kind === 'ack') { const pending = acknowledge; acknowledge = null; pending?.(); return }
  if (!('file' in event.data) || started) { post({ kind: 'error', message: 'Unexpected import worker request.' }); return }
  started = true
  void handleImportRequest(event.data).then(result => streamImportResult(result, chunk => new Promise<void>((resolve, reject) => {
    acknowledge = resolve
    try { scope.postMessage({ kind: 'chunk', value: chunk }) }
    catch (error) { acknowledge = null; reject(error) }
  }))).then(value => post({ kind: 'result', value })).catch((error: unknown) => post({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown file error' }))
}
