import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { MousePointer2 } from 'lucide-react'
import { coordinateReadout, crsLabel, requireCrs, scaleDenominator, utmCodeFor, WGS84 } from './crs'
import type { ViewMode } from './store'

interface StatusBarProps {
  map: MapLibreMap | null
  viewMode: ViewMode
  displayCrs: string
  layoutPaper: string
  layoutOrientation: string
  onOpenMapProperties: () => void
}

/**
 * Map scale readout and bottom status bar with live WGS 84 and projected coordinates.
 * It subscribes to pointer and zoom events itself, so moving the pointer re-renders only
 * this bar rather than the whole application shell.
 */
export default function StatusBar({ map, viewMode, displayCrs, layoutPaper, layoutOrientation, onOpenMapProperties }: StatusBarProps) {
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  // Null until the first zoom event; until then read the map's current zoom directly.
  const [zoomEvent, setZoom] = useState<number | null>(null)
  const zoom = zoomEvent ?? map?.getZoom() ?? 3.15

  useEffect(() => {
    if (!map) return
    const onMouseMove = (event: { lngLat: { lng: number; lat: number } }) => setCursor([event.lngLat.lng, event.lngLat.lat])
    const onZoom = () => setZoom(map.getZoom())
    map.on('mousemove', onMouseMove)
    map.on('zoom', onZoom)
    return () => {
      map.off('mousemove', onMouseMove)
      map.off('zoom', onZoom)
    }
  }, [map])

  const displayCrsDefinition = requireCrs(displayCrs)
  // With a geographic display system the secondary readout is the pointer's UTM zone.
  const wgsReadout = cursor ? coordinateReadout(WGS84, cursor[0], cursor[1]) : null
  const projectedReadout = cursor
    ? coordinateReadout(displayCrsDefinition.kind === 'geographic' ? utmCodeFor(cursor[0], cursor[1]) : displayCrs, cursor[0], cursor[1])
    : null
  const scale = cursor
    ? `1:${Math.round(scaleDenominator(cursor[1], zoom)).toLocaleString('en-US')}`
    : '—'

  return (
    <>
      {viewMode === 'map' && <div className="map-scale-readout">{scale}</div>}
      <div className="bottom-status">
        <div className="status-coordinate">{!wgsReadout || !projectedReadout ? <><MousePointer2 size={12} /><span>Move pointer over map</span></> : <>
          <span className="coordinate-label">WGS 84</span><span>{wgsReadout.text}</span>
          <span className="status-divider" />
          <span className="coordinate-label">{projectedReadout.label}</span>
          <span className={projectedReadout.inArea ? '' : 'out-of-area'} title={projectedReadout.inArea ? projectedReadout.code : `Outside the area of use of ${crsLabel(projectedReadout.code)}`}>{projectedReadout.text}{projectedReadout.inArea ? '' : ' (outside area of use)'}</span>
        </>}</div>
        <div className="status-right"><span>{viewMode === 'layout' ? `Layout · ${layoutPaper} ${layoutOrientation}` : scale}</span><span className="status-divider" /><button className="status-crs" title="Display coordinate system — open Map Properties" onClick={onOpenMapProperties}>{displayCrsDefinition.code}</button></div>
      </div>
    </>
  )
}
