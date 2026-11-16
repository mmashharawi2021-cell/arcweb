import { toolboxTools } from '../toolboxes/registry'
import type { ToolExecutionResult } from '../toolboxes/types'
import type { ToolRequest } from './toolProtocol'

export async function handleToolRequest(
  request: ToolRequest,
  onProgress: (progress: { current: number; total: number; message: string }) => void,
): Promise<ToolExecutionResult> {
  const tool = toolboxTools.find((candidate) => candidate.id === request.toolId)
  if (!tool) throw new Error(`Unknown tool: ${request.toolId}.`)
  if (tool.runsOnMainThread) throw new Error(`${tool.name} must run on the main thread.`)
  return tool.execute({ layers: request.layers, selectedLayerId: request.selectedLayerId, onProgress }, request.parameters)
}
