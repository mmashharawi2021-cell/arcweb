import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Renders a component into a container attached to document.body (needs a DOM test environment). */
export function renderComponent(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    rerender(next: ReactElement) {
      act(() => root.render(next))
    },
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
