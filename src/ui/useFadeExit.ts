import { useCallback, useRef, type RefObject } from 'react'

const exits = new Set<HTMLElement>()

/** Paint-only exit: React unmounts immediately, so actions and focus are never delayed. */
export function fadeOutElement(element: HTMLElement) {
  if (!element.isConnected || typeof element.animate !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const rect = element.getBoundingClientRect()
  const computed = getComputedStyle(element)
  const opacity = computed.opacity
  if (!rect.width || !rect.height || computed.visibility === 'hidden' || Number(computed.opacity) === 0) return
  const ghost = element.cloneNode(true) as HTMLElement
  ghost.classList.add('arcweb-exit-ghost')
  ghost.inert = true
  ghost.setAttribute('aria-hidden', 'true')
  // Decorative copies must never duplicate document IDs or live announcements.
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
    for (const attribute of ['id', 'role', 'autofocus', 'aria-live', 'aria-modal']) node.removeAttribute(attribute)
  }
  Object.assign(ghost.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    right: 'auto', bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', transform: 'none', opacity,
    zIndex: computed.zIndex === 'auto' ? '30' : computed.zIndex,
  })
  // A StrictMode ref detach/reattach is not a real removal. Decide after React commits.
  queueMicrotask(() => {
    if (element.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Bound transient DOM during rapid open/close sequences.
    if (exits.size >= 4) { const oldest = exits.values().next().value; oldest?.remove(); if (oldest) exits.delete(oldest) }
    document.body.append(ghost)
    exits.add(ghost)
    const remove = () => { ghost.remove(); exits.delete(ghost) }
    const timer = window.setTimeout(remove, 240)
    const animation = ghost.animate([{ opacity }, { opacity: 0 }], {
      duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards',
    })
    void animation.finished.then(() => { window.clearTimeout(timer); remove() }, () => { window.clearTimeout(timer); remove() })
  })
}

/** Attach to an existing root, optionally preserving its existing object ref. */
export function useFadeExit<E extends HTMLElement>(existingRef?: RefObject<E | null>) {
  const current = useRef<E | null>(null)
  return useCallback((node: E | null) => {
    if (current.current && current.current !== node) fadeOutElement(current.current)
    current.current = node
    if (existingRef) existingRef.current = node
  }, [existingRef])
}
