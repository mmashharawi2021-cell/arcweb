import { Children, cloneElement, isValidElement, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { RibbonGroupProps } from './RibbonParts'
import { useRibbonCollapse } from './useRibbonCollapse'

/**
 * Lays out a ribbon tab's RibbonGroup children and collapses them from the right when the
 * toolbar is too narrow. Each group is matched to its collapse state by its label.
 */
export function RibbonGroupBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const collapsed = useRibbonCollapse(ref)
  return (
    <div ref={ref} className="ribbon-groups">
      {Children.map(children, (child) => {
        if (!isValidElement<RibbonGroupProps>(child) || typeof child.props.label !== 'string') return child
        return cloneElement(child as ReactElement<RibbonGroupProps>, { collapsed: collapsed[child.props.label] ?? false })
      })}
    </div>
  )
}
