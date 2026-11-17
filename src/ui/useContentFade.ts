import { useLayoutEffect, useRef } from 'react'

/** Replay on navigation even when React reuses the same DOM nodes. Never remount content. */
export function useContentFade(navigation: string) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || typeof root.animate !== 'function') return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (preference.matches) return
    const animations = [...root.querySelectorAll<HTMLElement>('.ribbon-toolbar, .symbology-dock .phase-panel')]
      .map((element) => element.animate([
        { opacity: 0.3, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'none' },
      ], { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }))
    const cancel = () => { animations.forEach((animation) => animation.cancel()) }
    const onPreferenceChange = () => { if (preference.matches) cancel() }
    preference.addEventListener('change', onPreferenceChange)
    return () => { preference.removeEventListener('change', onPreferenceChange); cancel() }
  }, [navigation])
  return ref
}
