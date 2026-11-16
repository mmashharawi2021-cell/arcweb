import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SymbologyPanel } from '../SymbologyPanel'
import { buildProject, parseProject } from '../project'
import type { MapLayer } from '../store'
import { getUniqueValueClasses } from '../symbology'
import { testLayer } from '../toolboxes/testUtils'
import { defaultWorkspaceLayout } from '../workspaceLayout'

// This event-handler unit test needs no DOM. Only the two render-time hooks are
// stubbed; the actual panel JSX, mode-change handler and project parser run.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (calculate: () => unknown) => calculate(),
  useState: () => [null, vi.fn()],
}))

type NodeProps = { children?: ReactNode; 'aria-label'?: string; onChange?: (event: { target: { value: string } }) => void }
function findModeControl(node: ReactNode): ReactElement<NodeProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findModeControl(child)
      if (found) return found
    }
  } else if (isValidElement<NodeProps>(node)) {
    if (node.type === 'select' && node.props['aria-label'] === 'Symbology type') return node
    return findModeControl(node.props.children)
  }
  return undefined
}

describe('Unique Values mode selection', () => {
  it('initializes distinct colours through the panel handler and preserves them on save/reopen', () => {
    const layer = testLayer('Places', ['Park', 'Water', 'Road'].map((kind, index) => ({
      type: 'Feature', properties: { kind }, geometry: { type: 'Point', coordinates: [index, index] },
    })))
    const onUpdate = vi.fn<(updates: Partial<MapLayer>) => void>()
    const tree = SymbologyPanel({ selectedLayer: layer, floating: false,
      onToggleFloat: vi.fn(), onUpdate, onAddData: vi.fn() })
    const control = findModeControl(tree)
    expect(control).toBeDefined()
    control!.props.onChange!({ target: { value: 'unique' } })
    expect(onUpdate).toHaveBeenCalledOnce()
    const categorized = { ...layer, ...onUpdate.mock.calls[0][0] }
    const classes = getUniqueValueClasses(categorized, 'kind', categorized.renderer)
    expect(new Set(classes.map((item) => item.color)).size).toBe(3)
    const layout = { paper: 'A4' as const, orientation: 'landscape' as const, elements: [] }
    const project = buildProject({ name: 'Panel regression', basemap: 'osm', displayCrs: 'EPSG:4326',
      camera: null, bookmarks: [], layers: [categorized], layout, workspaceLayout: defaultWorkspaceLayout() })
    const restored = parseProject(JSON.stringify(project), layout).layers[0]
    expect(getUniqueValueClasses(restored, 'kind', restored.renderer)).toEqual(classes)
  })
})
