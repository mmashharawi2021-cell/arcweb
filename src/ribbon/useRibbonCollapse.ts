import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { collapseGroups, DEFAULT_COLLAPSED_GROUP_WIDTH } from './ribbonLayout'

/**
 * Collapse state for the `.ribbon-group` children of a toolbar, keyed by each group's
 * `aria-label`. Recomputed when the toolbar or any group resizes, and when the groups
 * themselves change (a different ribbon tab at the same window width).
 *
 * Widths are remembered per label: a collapsed group only measures its button, so its
 * expanded width comes from when it was last expanded, and its collapsed width from when
 * it was last collapsed. Unknown groups render expanded first, so they are measured.
 */
export function useRibbonCollapse(toolbarRef: RefObject<HTMLElement | null>): Record<string, boolean> {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return
    const expandedWidths = new Map<string, number>()
    const collapsedWidths = new Map<string, number>()
    let frame: number | null = null
    // Separate from `frame`: a callback that runs synchronously must not leave a stale handle that blocks later measures.
    let pending = false

    const measure = () => {
      pending = false
      frame = null
      const groups = [...toolbar.querySelectorAll<HTMLElement>(':scope > .ribbon-group')]
      const labels = groups.map((group) => group.getAttribute('aria-label') ?? '')
      groups.forEach((group, index) => {
        const width = group.getBoundingClientRect().width
        if (group.dataset.collapsed === 'true') collapsedWidths.set(labels[index], width)
        else expandedWidths.set(labels[index], width)
      })
      const decision = collapseGroups(
        labels.map((label) => expandedWidths.get(label) ?? 0),
        toolbar.clientWidth,
        labels.map((label) => collapsedWidths.get(label) ?? DEFAULT_COLLAPSED_GROUP_WIDTH),
      )
      const next = Object.fromEntries(labels.map((label, index) => [label, decision[index]]))
      setCollapsed((previous) => {
        const keys = Object.keys(next)
        const same = keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key])
        return same ? previous : next
      })
    }
    const schedule = () => {
      if (pending) return
      pending = true
      frame = window.requestAnimationFrame(measure)
    }

    const resizeObserver = new ResizeObserver(schedule)
    const observeGroups = () => {
      resizeObserver.disconnect()
      resizeObserver.observe(toolbar)
      toolbar.querySelectorAll(':scope > .ribbon-group').forEach((group) => resizeObserver.observe(group))
    }
    observeGroups()
    // A tab switch replaces the groups without resizing the toolbar.
    const mutationObserver = new MutationObserver(() => {
      observeGroups()
      schedule()
    })
    mutationObserver.observe(toolbar, { childList: true })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      if (pending && frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [toolbarRef])

  return collapsed
}
