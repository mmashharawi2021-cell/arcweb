/** Runs inside the map worker, avoiding the custom-scheme main-thread fallback. */
export async function loadMapBlob(request: { url: string; type?: string }, controller: AbortController): Promise<{ data: unknown }> {
  const response = await fetch(request.url, { signal: controller.signal })
  if (!response.ok) throw new Error(`Could not load local map data: HTTP ${response.status}`)
  return { data: request.type === 'json' ? await response.json() : await response.arrayBuffer() }
}
