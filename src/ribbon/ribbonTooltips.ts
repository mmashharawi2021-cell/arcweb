import { Children, cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

function ribbonText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement(child)) return ribbonText((child.props as { children?: ReactNode }).children)
    return ''
  }).join(' ').replace(/\s+/g, ' ').trim()
}

export function addRibbonTooltips(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) return child
    const props = child.props as { title?: string; 'aria-label'?: string; children?: ReactNode }
    const children = addRibbonTooltips(props.children)
    if (child.type === 'button') {
      const label = props.title?.trim() || props['aria-label']?.trim() || ribbonText(props.children)
      if (!label) return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, children)
      return cloneElement(child as ReactElement<Record<string, unknown>>, {
        title: undefined,
        'data-ribbon-tooltip': label,
        'aria-label': props['aria-label'] ?? label,
      }, children)
    }
    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, children)
  })
}
