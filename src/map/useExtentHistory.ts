import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ExtentHistory, type Extent } from './extentHistory'

function currentExtent(map: MapLibreMap): Extent {
  const center = map.getCenter()
  return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

/** Previous / Next extent for the map: records every `moveend` and steps through them. */
export function useExtentHistory(map: MapLibreMap | null) {
  const historyRef = useRef(new ExtentHistory())
  const [state, setState] = useState({ canGoBack: false, canGoForward: false })
  const sync = useCallback(() => {
    const history = historyRef.current
    setState((previous) => previous.canGoBack === history.canBack && previous.canGoForward === history.canForward
      ? previous
      : { canGoBack: history.canBack, canGoForward: history.canForward })
  }, [])

  useEffect(() => {
    if (!map) return
    historyRef.current.record(currentExtent(map))
    const onMoveEnd = () => {
      historyRef.current.record(currentExtent(map))
      sync()
    }
    map.on('moveend', onMoveEnd)
    return () => { map.off('moveend', onMoveEnd) }
  }, [map, sync])

  const step = useCallback((direction: 'back' | 'forward') => {
    if (!map) return
    const extent = direction === 'back' ? historyRef.current.back() : historyRef.current.forward()
    if (extent) map.jumpTo(extent)
    sync()
  }, [map, sync])

  return {
    ...state,
    goBack: useCallback(() => step('back'), [step]),
    goForward: useCallback(() => step('forward'), [step]),
  }
}
