// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import type { ComponentProps } from 'react'
import { renderComponent } from './helpers/renderComponent'
import type { UiSettings } from '../ui/uiSettings'

// The library section talks to IndexedDB; the Backstage tests only need its placement.
vi.mock('../storage/ProjectLibraryContent', () => ({
  default: (props: { sections?: string[] }) => createElement('div', { 'data-testid': 'library', 'data-sections': (props.sections ?? []).join(',') }),
}))

const { default: Backstage } = await import('../project/Backstage')

const settings: UiSettings = { theme: 'dark', measureUnits: 'metric', coordinateFormat: 'dd' }

function props(overrides: Partial<ComponentProps<typeof Backstage>> = {}): ComponentProps<typeof Backstage> {
  return {
    projectName: 'مشروع غزة',
    section: 'new',
    onSection: vi.fn(),
    onClose: vi.fn(),
    onNewBlank: vi.fn(),
    onOpenFile: vi.fn(),
    onSaveFile: vi.fn(),
    onSaveCopy: vi.fn(),
    library: {
      projectId: 'p1', capture: vi.fn(), onOpen: vi.fn(), onCreate: vi.fn(), onFlush: vi.fn(),
      onRecover: vi.fn(), onOffline: vi.fn(), getBounds: () => null,
    },
    settings,
    onSettings: vi.fn(),
    ...overrides,
  }
}

const press = (target: Element, key: string) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
/** A button by its visible label: its whole text, or the title of a card button. */
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((item) =>
    item.textContent?.trim() === label || item.querySelector('strong')?.textContent?.trim() === label) as HTMLButtonElement | undefined

describe('Project backstage', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens on the requested section and lists the left navigation in Pro order', () => {
    renderComponent(createElement(Backstage, props({ section: 'save-as' })))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const nav = [...dialog.querySelectorAll('nav [role="tab"]')]
    expect(nav.map((item) => item.textContent?.trim())).toEqual(['New', 'Open', 'Save As', 'Projects & offline', 'Options', 'About'])
    expect(nav[2].getAttribute('aria-selected')).toBe('true')
    expect(button('Download project file')).toBeDefined()
  })

  it('switches section through onSection', () => {
    const onSection = vi.fn()
    renderComponent(createElement(Backstage, props({ onSection })))
    act(() => button('Options')!.click())
    expect(onSection).toHaveBeenCalledWith('options')
  })

  it('Escape closes Backstage without reaching the window', () => {
    const onClose = vi.fn()
    const spy = vi.fn()
    window.addEventListener('keydown', spy)
    renderComponent(createElement(Backstage, props({ onClose })))
    press(document.querySelector('[role="dialog"] button')!, 'Escape')
    window.removeEventListener('keydown', spy)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns focus to the Project tab when closed', () => {
    function Shell() {
      const [open, setOpen] = useState(false)
      return createElement('div', null,
        createElement('button', { id: 'project-tab', onClick: () => setOpen(true) }, 'Project'),
        open && createElement(Backstage, props({ onClose: () => setOpen(false) })))
    }
    renderComponent(createElement(Shell))
    const tab = document.getElementById('project-tab') as HTMLButtonElement
    act(() => { tab.focus(); tab.click() })
    expect(document.activeElement).not.toBe(tab)
    press(document.activeElement!, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(tab)
  })

  it('renders the project name inside bdi', () => {
    renderComponent(createElement(Backstage, props()))
    expect(document.querySelector('[role="dialog"] bdi')?.textContent).toBe('مشروع غزة')
  })

  it('New › Blank map starts a new workspace and closes', () => {
    const onNewBlank = vi.fn()
    const onClose = vi.fn()
    renderComponent(createElement(Backstage, props({ onNewBlank, onClose })))
    act(() => button('Blank map')!.click())
    expect(onNewBlank).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Open shows the project list and a file browser', () => {
    const onOpenFile = vi.fn()
    renderComponent(createElement(Backstage, props({ section: 'open', onOpenFile })))
    expect(document.querySelector('[data-testid="library"]')?.getAttribute('data-sections')).toBe('projects')
    act(() => button('Browse for a project file…')!.click())
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('Save As downloads a file or saves a copy in Projects', () => {
    const onSaveFile = vi.fn()
    const onSaveCopy = vi.fn()
    renderComponent(createElement(Backstage, props({ section: 'save-as', onSaveFile, onSaveCopy })))
    act(() => button('Download project file')!.click())
    act(() => button('Save a copy in Projects')!.click())
    expect(onSaveFile).toHaveBeenCalledTimes(1)
    expect(onSaveCopy).toHaveBeenCalledTimes(1)
  })

  it('Projects & offline shows every library section', () => {
    renderComponent(createElement(Backstage, props({ section: 'library' })))
    expect(document.querySelector('[data-testid="library"]')?.getAttribute('data-sections')).toBe('projects,recovery,backup,offline')
  })

  it('Options changes theme through onSettings', () => {
    const onSettings = vi.fn()
    renderComponent(createElement(Backstage, props({ section: 'options', onSettings })))
    act(() => (document.querySelector('input[type="radio"][value="light"]') as HTMLInputElement).click())
    expect(onSettings).toHaveBeenCalledWith({ ...settings, theme: 'light' })
  })

  it('Options changes measure units and coordinate format', () => {
    const onSettings = vi.fn()
    renderComponent(createElement(Backstage, props({ section: 'options', onSettings })))
    const units = document.querySelector('select[aria-label="Measure units"]') as HTMLSelectElement
    act(() => { units.value = 'imperial'; units.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, measureUnits: 'imperial' })
    const format = document.querySelector('select[aria-label="Coordinate format"]') as HTMLSelectElement
    act(() => { format.value = 'dms'; format.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onSettings).toHaveBeenLastCalledWith({ ...settings, coordinateFormat: 'dms' })
  })

  it('About shows the application version', () => {
    renderComponent(createElement(Backstage, props({ section: 'about' })))
    expect(document.querySelector('[role="dialog"]')?.textContent).toMatch(/Version \d+\.\d+\.\d+/)
  })
})
