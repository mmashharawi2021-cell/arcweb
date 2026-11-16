import { handleToolRequest } from './toolHandler'
import type { ToolRequest } from './toolProtocol'
import type { WorkerReply } from './runInWorker'
import type { ToolExecutionResult } from '../toolboxes/types'

// The project tsconfig uses the DOM lib, so type the worker global structurally instead of via the WebWorker lib.
const scope = self as unknown as {
  onmessage: ((event: { data: ToolRequest }) => void) | null
  postMessage(message: WorkerReply<ToolExecutionResult>): void
}

/** Posting can throw (e.g. a value that cannot be structured-cloned); report that instead of hanging the caller. */
const post = (message: WorkerReply<ToolExecutionResult>) => {
  try {
    scope.postMessage(message)
  } catch (error) {
    scope.postMessage({ kind: 'error', message: error instanceof Error ? error.message : 'The tool result could not be sent.' })
  }
}

scope.onmessage = (event) => {
  handleToolRequest(event.data, (progress) => post({ kind: 'progress', ...progress })).then(
    (value) => post({ kind: 'result', value }),
    (error: unknown) => post({ kind: 'error', message: error instanceof Error ? error.message : 'Tool execution error.' }),
  )
}
