// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { AnalysisRibbon, InsertRibbon, ShareRibbon } from '../CoreRibbons'
import { galleryTools } from '../analysisGallery'
import { toolboxTools } from '../../toolboxes/registry'
import { LAYOUT_TEMPLATES } from '../../layout/templates'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

const command = (id: string) => document.querySelector(`[data-command="${id}"]`) as HTMLButtonElement
const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]
const groups = () => [...document.querySelectorAll('.ribbon-group[role="group"]')].map((group) => group.getAttribute('aria-label'))

describe('Insert tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('Insert New Layout lists every template', () => {
    const onNewLayout = vi.fn()
    renderComponent(createElement(InsertRibbon, { onNewLayout, onNewLayer: vi.fn(), onAddData: vi.fn() }))
    expect(groups()).toEqual(['Project', 'Layer'])
    act(() => command('new-layout').click())
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(LAYOUT_TEMPLATES.map((template) => template.name))
    act(() => menuItems()[1].click())
    expect(onNewLayout).toHaveBeenCalledWith(LAYOUT_TEMPLATES[1].id)
  })

  it('New Layer and Add Data run their actions', () => {
    const onNewLayer = vi.fn()
    const onAddData = vi.fn()
    renderComponent(createElement(InsertRibbon, { onNewLayout: vi.fn(), onNewLayer, onAddData }))
    act(() => command('new-layer').click())
    act(() => command('add-data').click())
    expect(onNewLayer).toHaveBeenCalledTimes(1)
    expect(onAddData).toHaveBeenCalledTimes(1)
  })
})

describe('Analysis tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('gallery skips tool ids missing from the registry', () => {
    expect(galleryTools(['buffer', 'no-such-tool', 'clip'], toolboxTools).map((tool) => tool.id)).toEqual(['buffer', 'clip'])
  })

  it('shows the Pro overlay and proximity tools', () => {
    renderComponent(createElement(AnalysisRibbon, { onOpenTools: vi.fn(), onOpenHistory: vi.fn(), onOpenTool: vi.fn() }))
    expect(groups()).toEqual(['Geoprocessing', 'Tools'])
    const tools = [...document.querySelectorAll('.ribbon-group[aria-label="Tools"] [data-command^="tool-"]')].map((button) => button.getAttribute('data-command'))
    expect(tools).toEqual(['tool-buffer', 'tool-clip', 'tool-intersect', 'tool-union', 'tool-dissolve', 'tool-spatial-join'])
  })

  it('Analysis gallery opens the geoprocessing pane on the chosen tool', () => {
    const onOpenTool = vi.fn()
    const onOpenTools = vi.fn()
    const onOpenHistory = vi.fn()
    renderComponent(createElement(AnalysisRibbon, { onOpenTools, onOpenHistory, onOpenTool }))
    act(() => command('tool-clip').click())
    expect(onOpenTool).toHaveBeenCalledWith('clip')
    act(() => command('geoprocessing-tools').click())
    act(() => command('geoprocessing-history').click())
    expect(onOpenTools).toHaveBeenCalledTimes(1)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })
})

describe('Share tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function share(overrides: Partial<Parameters<typeof ShareRibbon>[0]> = {}) {
    const props = {
      hasLayer: true, layoutExporting: false, onExportMap: vi.fn(), onExportLayout: vi.fn(), onExportLayer: vi.fn(),
      onDownloadProject: vi.fn(), onBackupProjects: vi.fn(), ...overrides,
    }
    renderComponent(createElement(ShareRibbon, props))
    return props
  }

  it('Share export menus call the right exporter', () => {
    const props = share()
    expect(groups()).toEqual(['Output', 'Project'])
    act(() => command('export-map').click())
    expect(props.onExportMap).toHaveBeenCalledTimes(1)
    act(() => command('export-layout').click())
    act(() => menuItems().find((item) => item.textContent?.trim() === 'PDF')!.click())
    expect(props.onExportLayout).toHaveBeenCalledWith('pdf')
    act(() => command('export-layer').click())
    act(() => menuItems().find((item) => item.textContent?.trim() === 'CSV')!.click())
    expect(props.onExportLayer).toHaveBeenCalledWith('csv')
    act(() => command('download-project').click())
    act(() => command('backup-projects').click())
    expect(props.onDownloadProject).toHaveBeenCalledTimes(1)
    expect(props.onBackupProjects).toHaveBeenCalledTimes(1)
  })

  it('disables layer export without a layer and layout export while exporting', () => {
    share({ hasLayer: false, layoutExporting: true })
    expect(command('export-layer').disabled).toBe(true)
    expect(command('export-layout').disabled).toBe(true)
  })
})

