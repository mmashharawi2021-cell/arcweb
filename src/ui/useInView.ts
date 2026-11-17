import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseInViewOptions extends IntersectionObserverInit {
  /** Remove `will-change` from the element once the reveal transition ends. */
  cleanupWillChange?: boolean
}

/**
 * Reveals an element when it scrolls into view using IntersectionObserver.
 *
 * Animations must stay compositor-only (transform/opacity) — pair the returned
 * `visible` flag with a CSS transition on those properties only. After the
 * reveal the observer disconnects, so there is no ongoing scroll-listener cost.
 *
 * Returns a tuple `[ref, visible]` so consumers can spread the ref onto an
 * element and gate a reveal class on the flag without the React Compiler lint
 * complaining about ref access during render.
 */
export function useInView<E extends HTMLElement = HTMLElement>({
  threshold = 0.12,
  rootMargin = '0px 0px -8% 0px',
  root = null,
  cleanupWillChange = true,
}: UseInViewOptions = {}): [React.Ref<E>, boolean] {
  const [el, setElement] = useState<E | null>(null)
  const ref = useCallback((element: E | null) => { setElement(element) }, [])
  // When IntersectionObserver is unavailable (SSR, jsdom, node test env), treat
  // the element as already visible so content never stays hidden.
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const revealed = useRef(false)

  useEffect(() => {
    if (!el || revealed.current || typeof IntersectionObserver === 'undefined') return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    const previousWillChange = el.style.willChange
    const clearHint = () => {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
      if (cleanupWillChange) el.style.setProperty('will-change', previousWillChange)
    }

    const onTransitionEnd = (event: TransitionEvent) => {
      if (
        cleanupWillChange &&
        event.target === el &&
        (event.propertyName === 'transform' || event.propertyName === 'opacity')
      ) {
        clearHint()
      }
    }

    if (cleanupWillChange) el.addEventListener('transitionend', onTransitionEnd)

    const reveal = () => {
      revealed.current = true
      if (cleanupWillChange && !preference.matches) {
        el.style.setProperty('will-change', 'transform, opacity')
        // transitionend may not fire after cancellation or a motion preference change.
        cleanupTimer = setTimeout(clearHint, 600)
      }
      setVisible(true)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal()
            observer.unobserve(el)
            break
          }
        }
      },
      { threshold, rootMargin, root }
    )

    const onPreferenceChange = () => {
      if (preference.matches) { observer.disconnect(); clearHint(); revealed.current = true; setVisible(true) }
    }
    preference.addEventListener('change', onPreferenceChange)
    if (preference.matches) reveal()
    else observer.observe(el)
    return () => {
      clearHint()
      preference.removeEventListener('change', onPreferenceChange)
      el.removeEventListener('transitionend', onTransitionEnd)
      observer.disconnect()
    }
  }, [el, root, threshold, rootMargin, cleanupWillChange])

  return [ref, visible]
}
