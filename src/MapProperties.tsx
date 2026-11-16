import { useEffect, useMemo, useState } from 'react'
import { Check, Compass, Globe2, Layers3, LocateFixed, Search, Settings2, X } from 'lucide-react'
import {
  coordinateReadout, coordinateSystems, crsGroups, crsLabel, getCrs, isInsideAreaOfUse, projectPosition, requireCrs,
  scaleDenominator, utmCodeFor, WGS84,
} from './crs'
import { trapTabKey, useRestoreFocus } from './a11y/modalFocus'
import { getCollectionBounds } from './geo'
import type { MapLayer } from './store'

export interface MapViewInfo {
  center: [number, number]
  zoom: number
  bearing: number
  basemap: string
}

interface MapPropertiesProps {
  name: string
  layers: MapLayer[]
  displayCrs: string
  view: MapViewInfo | null
  onChangeDisplayCrs: (code: string) => void
  onClose: () => void
}

type Tab = 'general' | 'crs' | 'layers'

const formatNumber = (value: number, digits: number) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Layer extent expressed in the display coordinate system, or null when it cannot be projected. */
function projectedExtent(layer: MapLayer, code: string): string {
  const bounds = getCollectionBounds([layer.data])
  if (!bounds) return 'No features'
  const crs = requireCrs(code)
  const low = projectPosition(WGS84, code, [bounds[0], bounds[1]])
  const high = projectPosition(WGS84, code, [bounds[2], bounds[3]])
  if (!low || !high) return 'Outside this coordinate system'
  const digits = crs.unit === 'degree' ? 5 : 0
  return `${formatNumber(low[0], digits)}, ${formatNumber(low[1], digits)} → ${formatNumber(high[0], digits)}, ${formatNumber(high[1], digits)}`
}

export default function MapProperties({ name, layers, displayCrs, view, onChangeDisplayCrs, onClose }: MapPropertiesProps) {
  const [tab, setTab] = useState<Tab>('crs')
  const [query, setQuery] = useState('')
  useRestoreFocus()
  const current = requireCrs(displayCrs)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return coordinateSystems.filter((crs) => terms.every((term) =>
      `${crs.name} ${crs.code} ${crs.code.replace('EPSG:', '')} ${crs.projection} ${crs.areaOfUse} ${crs.datum}`.toLowerCase().includes(term)))
  }, [query])

  const centerReadout = view ? coordinateReadout(displayCrs, view.center[0], view.center[1]) : null
  const suggestedUtm = view ? utmCodeFor(view.center[0], view.center[1]) : null
  const centerOutside = view ? !isInsideAreaOfUse(current, view.center[0], view.center[1]) : false

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal map-properties" role="dialog" aria-modal="true" aria-label="Map Properties" onKeyDown={trapTabKey}>
        <header className="modal-header">
          <div><Settings2 size={15} /><strong>Map Properties</strong><span>{name}</span></div>
          <button className="subtle-icon" title="Close" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="modal-body">
          <nav className="modal-tabs">
            <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}><Globe2 size={13} />General</button>
            <button className={tab === 'crs' ? 'active' : ''} onClick={() => setTab('crs')}><Compass size={13} />Coordinate Systems</button>
            <button className={tab === 'layers' ? 'active' : ''} onClick={() => setTab('layers')}><Layers3 size={13} />Layer Spatial References</button>
          </nav>

          {tab === 'general' && (
            <div className="modal-pane">
              <dl className="property-list">
                <div><dt>Name</dt><dd>{name}</dd></div>
                <div><dt>Display coordinate system</dt><dd>{current.name} <code>{current.code}</code></dd></div>
                <div><dt>Display units</dt><dd>{current.unit === 'degree' ? 'Decimal degrees' : 'Meters'}</dd></div>
                <div><dt>Map center</dt><dd>{centerReadout ? centerReadout.text : '—'}</dd></div>
                <div><dt>Map center (WGS 84)</dt><dd>{view ? coordinateReadout(WGS84, view.center[0], view.center[1]).text : '—'}</dd></div>
                <div><dt>Reference scale</dt><dd>{view ? `1:${Math.round(scaleDenominator(view.center[1], view.zoom)).toLocaleString('en-US')}` : '—'}</dd></div>
                <div><dt>Zoom level</dt><dd>{view ? view.zoom.toFixed(2) : '—'}</dd></div>
                <div><dt>Rotation</dt><dd>{view ? `${view.bearing.toFixed(1)}°` : '—'}</dd></div>
                <div><dt>Basemap</dt><dd>{view?.basemap ?? '—'}</dd></div>
                <div><dt>Layers</dt><dd>{layers.length} ({layers.filter((layer) => layer.visible).length} visible)</dd></div>
              </dl>
              <p className="modal-note">ArcWeb stores every layer in WGS 84 and draws the map in Web Mercator, like the basemap tiles. The display coordinate system controls the coordinate readout; use the Project tool to export data in another system.</p>
            </div>
          )}

          {tab === 'crs' && (
            <div className="modal-pane crs-pane">
              <div className="crs-picker">
                <label className="toolbox-search crs-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or EPSG code, e.g. 2039, UTM 36, Palestine" /></label>
                <div className="crs-list">
                  {crsGroups.map((group) => {
                    const items = matches.filter((crs) => crs.group === group)
                    if (!items.length) return null
                    return (
                      <div key={group} className="crs-group">
                        <div className="crs-group-title">{group}</div>
                        {items.map((crs) => (
                          <button key={crs.code} className={crs.code === current.code ? 'active' : ''} onClick={() => onChangeDisplayCrs(crs.code)}>
                            <span>{crs.name}</span><code>{crs.code}</code>{crs.code === current.code && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                  {!matches.length && <div className="toolbox-no-results">No coordinate system matches this search.</div>}
                </div>
              </div>
              <div className="crs-details">
                <div className="crs-current-label">Current display coordinate system</div>
                <strong>{current.name}</strong>
                <code>{current.code}</code>
                <dl className="property-list compact">
                  <div><dt>Type</dt><dd>{current.kind === 'projected' ? 'Projected' : 'Geographic'}</dd></div>
                  <div><dt>Projection</dt><dd>{current.projection}</dd></div>
                  <div><dt>Datum</dt><dd>{current.datum}</dd></div>
                  <div><dt>Linear unit</dt><dd>{current.unit === 'degree' ? 'Degree' : 'Meter'}</dd></div>
                  <div><dt>Area of use</dt><dd>{current.areaOfUse}</dd></div>
                  <div><dt>Map center</dt><dd>{centerReadout?.text ?? '—'}</dd></div>
                </dl>
                <div className="crs-definition" title="PROJ definition">{current.proj4}</div>
                {centerOutside && <div className="modal-warning">The map center is outside this system's area of use; coordinates shown there are distorted.</div>}
                {suggestedUtm && suggestedUtm !== current.code && (
                  <button className="phase-secondary-button" onClick={() => onChangeDisplayCrs(suggestedUtm)}><LocateFixed size={13} />Use the map's UTM zone · {getCrs(suggestedUtm)?.name.replace('WGS 84 / ', '')}</button>
                )}
              </div>
            </div>
          )}

          {tab === 'layers' && (
            <div className="modal-pane">
              {layers.length ? (
                <div className="spatial-reference-table">
                  <div className="head"><span>Layer</span><span>Geometry</span><span>Features</span><span>Source spatial reference</span><span>Extent in {current.code}</span></div>
                  {layers.map((layer) => (
                    <div key={layer.id}>
                      <span title={layer.name}>{layer.name}</span>
                      <span>{layer.geometry}</span>
                      <span>{layer.data.features.length.toLocaleString()}</span>
                      <span title={crsLabel(layer.sourceCrs)}>{crsLabel(layer.sourceCrs)}</span>
                      <span title={projectedExtent(layer, displayCrs)}>{projectedExtent(layer, displayCrs)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="toolbox-no-results">Add a layer to inspect its spatial reference.</div>}
              <p className="modal-note">“Source spatial reference” is the system the dataset was imported in or projected to. Geometry is reprojected to WGS 84 on import so that all layers align on the map.</p>
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <span><Compass size={12} />{current.name} · {current.code}</span>
          <button className="phase-primary-button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  )
}
