// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { ComponentProps } from 'react'
import ToolboxPanel from '../ToolboxPanel'
import { renderComponent } from '../../__tests__/helpers/renderComponent'

function props(overrides: Partial<ComponentProps<typeof ToolboxPanel>> = {}): ComponentProps<typeof ToolboxPanel> {
  return {
    layers: [], selectedLayerId: null, selectionCount: 0, running: null, history: [], floating: false,
    onToggleFloat: vi.fn(), onExecute: vi.fn(), onCancel: vi.fn(), onClose: vi.fn(), ...overrides,
  }
}

describe('ToolboxPanel initial request', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens the requested tool form', () => {
    renderComponent(createElement(ToolboxPanel, props({ initialToolId: 'clip' })))
    expect(document.querySelector('.toolbox-tool-title strong')?.textContent).toBe('Clip')
  })

  it('opens on the history view when asked', () => {
    renderComponent(createElement(ToolboxPanel, props({ initialView: 'history' })))
    expect(document.querySelector('[aria-label="Geoprocessing history"]')).not.toBeNull()
  })

  it('ignores an unknown tool id and shows the toolbox list', () => {
    renderComponent(createElement(ToolboxPanel, props({ initialToolId: 'no-such-tool' })))
    expect(document.querySelector('.toolbox-tool-form')).toBeNull()
  })
})
