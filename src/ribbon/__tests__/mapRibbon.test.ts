// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ComponentProps } from 'react'
import { MapRibbon } from '../CoreRibbons'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

type Props = ComponentProps<typeof MapRibbon>

function props(overrides: Partial<Props> = {}): Props {
  return {
    basemap: 'osm',
    offlineBasemapActive: false,
    tool: 'pan',
    hasLayers: true,
    hasSelection: true,
    selectedCount: 1234,
    bookmarks: [{ id: 'b1', name: 'غزة' }, { id: 'b2', name: 'Campus' }],
    canGoBack: false,
    canGoForward: true,
    onSelectBasemap: vi.fn(),
    onExplore: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFullExtent: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onGoToBookmark: vi.fn(),
    onManageBookmarks: vi.fn(),
    onAddData: vi.fn(),
    onOpenProjectFile: vi.fn(),
    onSelectByAttributes: vi.fn(),
    onSelectByLocation: vi.fn(),
    onZoomToSelected: vi.fn(),
    onClearSelection: vi.fn(),
    onToggleMeasure: vi.fn(),
    onOpenMapProperties: vi.fn(),
    ...overrides,
  }
}

const command = (id: string) => document.querySelector(`[data-command="${id}"]`) as HTMLButtonElement
const arrowOf = (id: string) => command(id).parentElement!.querySelector('.ribbon-split-arrow') as HTMLButtonElement
const menuLabels = () => [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())

describe('Map ribbon', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('renders the five groups in order', () => {
    renderComponent(createElement(MapRibbon, props()))
    const groups = [...document.querySelectorAll('.ribbon-group[role="group"]')].map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(['Navigate', 'Layer', 'Selection', 'Inquiry', 'View'])
  })

  it('Basemap gallery marks the active basemap and selects another', () => {
    const onSelectBasemap = vi.fn()
    renderComponent(createElement(MapRibbon, props({ basemap: 'dark', onSelectBasemap })))
    act(() => command('basemap').click())
    const options = [...document.querySelectorAll('[role="option"]')]
    expect(options.filter((option) => option.getAttribute('aria-selected') === 'true').map((option) => option.textContent)).toEqual(['Dark Matter'])
    act(() => (options.find((option) => option.textContent === 'World Imagery') as HTMLElement).click())
    expect(onSelectBasemap).toHaveBeenCalledWith('satellite')
  })

  it('marks no basemap while an offline basemap is active', () => {
    renderComponent(createElement(MapRibbon, props({ offlineBasemapActive: true })))
    act(() => command('basemap').click())
    expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(0)
  })

  it('Measure split runs Distance by default and lists Area and Feature', () => {
    const onToggleMeasure = vi.fn()
    renderComponent(createElement(MapRibbon, props({ onToggleMeasure })))
    act(() => command('measure').click())
    expect(onToggleMeasure).toHaveBeenCalledWith('distance')
    act(() => arrowOf('measure').click())
    expect(menuLabels()).toEqual(['Distance', 'Area', 'Feature'])
    act(() => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click())
    expect(onToggleMeasure).toHaveBeenLastCalledWith('area')
  })

  it('disables Measure › Feature until a handler is provided', () => {
    const onMeasureFeature = vi.fn()
    const { rerender } = renderComponent(createElement(MapRibbon, props()))
    act(() => arrowOf('measure').click())
    expect((document.querySelectorAll('[role="menuitem"]')[2] as HTMLButtonElement).disabled).toBe(true)
    act(() => arrowOf('measure').click())
    rerender(createElement(MapRibbon, props({ onMeasureFeature })))
    act(() => arrowOf('measure').click())
    act(() => (document.querySelectorAll('[role="menuitem"]')[2] as HTMLElement).click())
    expect(onMeasureFeature).toHaveBeenCalledTimes(1)
  })

  it('shows the active measure tool as pressed', () => {
    renderComponent(createElement(MapRibbon, props({ tool: 'area' })))
    expect(command('measure').getAttribute('aria-pressed')).toBe('true')
    expect(command('explore').getAttribute('aria-pressed')).toBe('false')
  })

  it('Selection caption shows "1,234 selected"', () => {
    renderComponent(createElement(MapRibbon, props()))
    const selection = document.querySelector('.ribbon-group[aria-label="Selection"]')!
    expect(selection.querySelector('.ribbon-group-caption')?.textContent).toBe('Selection · 1,234 selected')
  })

  it('disables selection commands without layers or a selection', () => {
    renderComponent(createElement(MapRibbon, props({ hasLayers: false, hasSelection: false, selectedCount: 0 })))
    expect(command('select-by-attributes').disabled).toBe(true)
    expect(command('clear-selection').disabled).toBe(true)
    expect(command('zoom-to-selection').disabled).toBe(true)
    expect(document.querySelector('.ribbon-group[aria-label="Selection"] .ribbon-group-caption')?.textContent).toBe('Selection')
  })

  it('Previous and Next follow the extent history', () => {
    const onForward = vi.fn()
    renderComponent(createElement(MapRibbon, props({ onForward })))
    expect(command('previous-extent').disabled).toBe(true)
    act(() => command('next-extent').click())
    expect(onForward).toHaveBeenCalledTimes(1)
  })

  it('Bookmarks menu lists saved bookmarks, then New and Manage', () => {
    const onGoToBookmark = vi.fn()
    const onManageBookmarks = vi.fn()
    renderComponent(createElement(MapRibbon, props({ onGoToBookmark, onManageBookmarks })))
    act(() => command('bookmarks').click())
    expect(menuLabels()).toEqual(['غزة', 'Campus', 'New Bookmark…', 'Manage Bookmarks…'])
    act(() => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click())
    expect(onGoToBookmark).toHaveBeenCalledWith('b2')
    act(() => command('bookmarks').click())
    act(() => (document.querySelectorAll('[role="menuitem"]')[3] as HTMLElement).click())
    expect(onManageBookmarks).toHaveBeenCalledTimes(1)
  })

  it('Add Data runs the file picker and offers project files', () => {
    const onAddData = vi.fn()
    const onOpenProjectFile = vi.fn()
    renderComponent(createElement(MapRibbon, props({ onAddData, onOpenProjectFile })))
    act(() => command('add-data').click())
    expect(onAddData).toHaveBeenCalledTimes(1)
    act(() => arrowOf('add-data').click())
    expect(menuLabels()).toEqual(['Data…', 'Project file…'])
    act(() => (document.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click())
    expect(onOpenProjectFile).toHaveBeenCalledTimes(1)
  })

  it('Select toggles the rectangle tool and shows it as active', () => {
    const onSelectTool = vi.fn()
    renderComponent(createElement(MapRibbon, props({ onSelectTool, tool: 'select-box' })))
    expect(command('select').getAttribute('aria-pressed')).toBe('true')
    act(() => command('select').click())
    expect(onSelectTool).toHaveBeenCalledWith('select-box')
  })

  it('disables Go To XY and Select until their tools are wired', () => {
    renderComponent(createElement(MapRibbon, props()))
    expect(command('go-to-xy').disabled).toBe(true)
    expect(command('select').disabled).toBe(true)
  })
})
