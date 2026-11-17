import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Crosshair, X } from 'lucide-react'
import { parseAngle } from './coordinateInput'

export type GoToAction = 'pan' | 'flash' | 'marker'

interface GoToXYProps {
  onGo: (lngLat: [number, number], action: GoToAction) => void
  onClose: () => void
}

/** ArcGIS Pro–style Go To XY: type a longitude and latitude (DD, DDM or DMS) and go there. */
export default function GoToXY({ onGo, onClose }: GoToXYProps) {
  const [longitude, setLongitude] = useState('')
  const [latitude, setLatitude] = useState('')
  const [error, setError] = useState<{ field: 'lon' | 'lat'; message: string } | null>(null)
  const longitudeRef = useRef<HTMLInputElement>(null)
  useEffect(() => { longitudeRef.current?.focus() }, [])

  const go = (action: GoToAction) => {
    const lon = parseAngle(longitude, 'lon')
    const lat = parseAngle(latitude, 'lat')
    if (lon === null) {
      setError({ field: 'lon', message: 'Longitude must be between -180 and 180, e.g. 34.45, 34 27 0 E or 34°27\'00"E.' })
      return
    }
    if (lat === null) {
      setError({ field: 'lat', message: 'Latitude must be between -90 and 90, e.g. 31.5, 31 30 0 N or 31°30\'00"N.' })
      return
    }
    setError(null)
    onGo([lon, lat], action)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    go('pan')
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <section className="go-to-xy" role="dialog" aria-label="Go To XY" onKeyDown={onKeyDown}>
      <header><Crosshair size={14} aria-hidden="true" /><strong>Go To XY</strong>
        <button type="button" className="subtle-icon" aria-label="Close Go To XY" onClick={onClose}><X size={14} aria-hidden="true" /></button>
      </header>
      <form onSubmit={onSubmit}>
        <label>Longitude (X)
          <input ref={longitudeRef} aria-label="Longitude" value={longitude} placeholder="34 27 0 E" spellCheck={false} dir="ltr"
            aria-invalid={error?.field === 'lon'} onChange={(event) => setLongitude(event.target.value)} />
        </label>
        <label>Latitude (Y)
          <input aria-label="Latitude" value={latitude} placeholder="31 30 0 N" spellCheck={false} dir="ltr"
            aria-invalid={error?.field === 'lat'} onChange={(event) => setLatitude(event.target.value)} />
        </label>
        {error && <p role="alert" className="go-to-xy-error">{error.message}</p>}
        <div className="go-to-xy-actions">
          <button type="submit" className="phase-primary-button">Pan To</button>
          <button type="button" className="phase-secondary-button" onClick={() => go('flash')}>Flash</button>
          <button type="button" className="phase-secondary-button" onClick={() => go('marker')}>Add Marker</button>
        </div>
      </form>
    </section>
  )
}
