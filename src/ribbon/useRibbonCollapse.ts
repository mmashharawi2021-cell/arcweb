import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { collapseGroups } from './ribbonLayout'

/**
 * Collapse state for the `.ribbon-group` children of a toolbar, recomputed when the toolbar
 * resizes. Expanded widths are remembered, because a collapsed group only measures its button.
 */
export function useRibbonCollapse(toolbarRef: RefObject<HTMLElement | null>, collapsedWidth = 56): boolean[] {
  const [collapsed, setCollapsed] = useState<boolean[]>([])
  const widthsRef = useRef<number[]>([])
  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const groups = [...toolbar.querySelectorAll<HTMLElement>(':scope > .ribbon-group')]
      if (groups.length !== widthsRef.current.length) widthsRef.current = groups.map(() => 0)
      groups.forEach((group, index) => {
        if (group.dataset.collapsed !== 'true') widthsRef.current[index] = group.getBoundingClientRect().width
      })
      const next = collapseGroups(widthsRef.current, toolbar.clientWidth, collapsedWidth)
      setCollapsed((previous) => previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next)
    }
    const observer = new ResizeObserver(() => window.requestAnimationFrame(measure))
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [toolbarRef, collapsedWidth])
  return collapsed
}
