import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

// Lets React flush effects and updates synchronously inside act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Minimal hook harness (needs a DOM test environment such as happy-dom). `result.current`
 * holds the latest return value; `rerender` renders again, optionally with new props.
 */
export function renderHook<Props, Result>(hook: (props: Props) => Result, initialProps: Props) {
  const result = { current: undefined as unknown as Result, renders: 0 }
  let props = initialProps
  function Probe() {
    result.current = hook(props)
    result.renders += 1
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return {
    result,
    rerender(nextProps?: Props) {
      if (nextProps !== undefined) props = nextProps
      act(() => root.render(createElement(Probe)))
    },
    unmount() {
      act(() => root.unmount())
    },
  }
}
