import { get } from 'idb-keyval'
import type { FeatureCollection } from 'geojson'
import type { MapLayer } from '../store'
import { buildProject, parseProject, parseSceneSettings, parseAnalysisHistory, parseTableViews } from '../project'
import type { LayoutDocument } from '../layout/layoutStore'
import type { WorkspaceSnapshot } from './projectRepository'

/** Read-only migration. Keep old keys intact until the new atomic commit succeeds. */
export async function readLegacyWorkspace(fallback: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const [layers, edits, settings] = await Promise.all([
    get<MapLayer[]>('arcweb-session-v1'), get<Record<string, FeatureCollection>>('arcweb-edit-session-v1'),
    get<{ projectName?: string; displayCrs?: string; layout?: LayoutDocument; bookmarks?: typeof fallback.project.map.bookmarks; sceneSettings?: unknown; analysisHistory?: unknown; tableViews?: unknown }>('arcweb-settings-v1'),
  ])
  if (!layers && !settings && !edits) return fallback
  if (layers !== undefined && !Array.isArray(layers)) throw new Error('The old workspace is unreadable. Its stored data has not been modified.')
  if (edits !== undefined && (!edits || typeof edits !== 'object' || Array.isArray(edits))) throw new Error('The old edit recovery data is unreadable. Its stored data has not been modified.')
  const project = buildProject({
    ...fallback.project.map, layers: layers ?? fallback.project.layers,
    name: settings?.projectName ?? fallback.project.name,
    displayCrs: settings?.displayCrs ?? fallback.project.map.displayCrs,
    layout: settings?.layout ?? fallback.project.layout,
    bookmarks: settings?.bookmarks ?? fallback.project.map.bookmarks,
    workspaceLayout: fallback.project.workspaceLayout,
    scene: parseSceneSettings(settings?.sceneSettings), analysisHistory: parseAnalysisHistory(settings?.analysisHistory),
    tableViews: parseTableViews(settings?.tableViews, new Set((layers ?? []).map(layer => layer.id))),
  })
  const checked = parseProject(JSON.stringify(project), project.layout)
  const editSnapshots = Object.fromEntries(Object.entries(edits ?? {}).flatMap(([id, data]) => {
    const layer = checked.layers.find(layer => layer.id === id)
    if (!layer) return []
    const recovery = parseProject(JSON.stringify({ ...checked, layers: [{ ...layer, data }] }), checked.layout)
    return [[id, recovery.layers[0].data]]
  }))
  return { project: checked, editSnapshots }
}
