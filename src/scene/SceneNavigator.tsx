import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { Box, ChevronDown, ChevronUp, Compass, Mountain, Orbit, Plane, RotateCcw } from 'lucide-react'
import type { MapLayer, SceneSettings } from '../store'
import { isRasterLayer } from '../ribbon/contextualTabs'
import { getNumericFields } from '../symbology'
import { resolveExtrusion } from '../mapRendering'
import type { TerrainState } from './terrain'

interface SceneNavigatorProps {
  map: MapLibreMap
  settings: SceneSettings
  terrain: TerrainState
  layers: MapLayer[]
  selectedLayer: MapLayer | null
  onSettings: (settings: Partial<SceneSettings>) => void
  onUpdateLayer: (layerId: string, updates: Partial<MapLayer>) => void
  onFlyToLayer: (layer: MapLayer) => void
}

const CAMERA_PRESETS: { label: string; title: string; pitch: number; bearing?: number }[] = [
  { label: 'Top', title: 'Look straight down (pitch 0°)', pitch: 0 },
  { label: '45°', title: 'Oblique view (pitch 45°)', pitch: 45 },
  { label: '70°', title: 'Low horizon view (pitch 70°)', pitch: 70 },
]
const easing = (t: number) => 1 - (1 - t) ** 3

/** Floating 3D Scene controls: camera pitch/bearing, presets, orbit, terrain and extrusion. */
export default function SceneNavigator({ map, settings, terrain, layers, selectedLayer, onSettings, onUpdateLayer, onFlyToLayer }: SceneNavigatorProps) {
  const [open, setOpen] = useState(true)
  const [pitch, setPitch] = useState(() => Math.round(map.getPitch()))
  const [bearing, setBearing] = useState(() => Math.round(map.getBearing()))
  const [orbiting, setOrbiting] = useState(false)

  useEffect(() => {
    const sync = () => {
      setPitch(Math.round(map.getPitch()))
      setBearing(Math.round(map.getBearing()))
    }
    map.on('move', sync)
    return () => { map.off('move', sync) }
  }, [map])

  // Orbit turns the camera around the map centre at 6°/s until the user takes over the map.
  useEffect(() => {
    if (!orbiting) return
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      map.setBearing(map.getBearing() + (now - last) * 0.006)
      last = now
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    const stop = () => setOrbiting(false)
    const container = map.getCanvasContainer()
    container.addEventListener('pointerdown', stop)
    container.addEventListener('wheel', stop, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('pointerdown', stop)
      container.removeEventListener('wheel', stop)
    }
  }, [map, orbiting])

  const ease = (camera: { pitch?: number; bearing?: number }) => {
    setOrbiting(false)
    map.easeTo({ ...camera, duration: 900, easing })
  }

  const demLayers = layers.filter(isRasterLayer)
  const extrudable = selectedLayer && (selectedLayer.geometry === 'Polygon' || selectedLayer.geometry === 'Mixed') ? selectedLayer : null
  const numericFields = extrudable ? getNumericFields(extrudable) : []
  const detected = extrudable && extrudable.extrusion === undefined ? resolveExtrusion(extrudable) : null
  const extrusionValue = !extrudable ? '' : extrudable.extrusion === null ? '__off' : extrudable.extrusion?.field ?? '__auto'
  const maxPitch = Math.round(map.getMaxPitch())

  return (
    <section className={`scene-navigator ${open ? '' : 'collapsed'}`} aria-label="3D Scene controls">
      <button className="scene-navigator-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Box size={13} /><strong>Scene</strong><span>{pitch}° tilt · {((bearing % 360) + 360) % 360}°</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="scene-navigator-body">
          <div className="scene-section-title">Camera</div>
          <label className="scene-slider">
            <span>Pitch</span>
            <input type="range" min={0} max={maxPitch} value={pitch} aria-label="Camera pitch" onChange={(event) => { setOrbiting(false); map.setPitch(Number(event.target.value)) }} />
            <output>{pitch}°</output>
          </label>
          <label className="scene-slider">
            <span>Bearing</span>
            <input type="range" min={-180} max={180} value={bearing} aria-label="Camera bearing" onChange={(event) => { setOrbiting(false); map.setBearing(Number(event.target.value)) }} />
            <output>{bearing}°</output>
          </label>
          <div className="scene-buttons">
            {CAMERA_PRESETS.map((preset) => (
              <button key={preset.label} title={preset.title} className={pitch === preset.pitch ? 'active' : ''} onClick={() => ease({ pitch: preset.pitch })}>{preset.label}</button>
            ))}
            <button title="Reset north (bearing 0°)" onClick={() => ease({ bearing: 0 })}><Compass size={12} style={{ transform: `rotate(${-bearing}deg)` }} /></button>
            <button title={orbiting ? 'Stop orbiting' : 'Orbit around the map centre (click the map to stop)'} className={orbiting ? 'active' : ''} onClick={() => setOrbiting((value) => !value)}><Orbit size={12} /></button>
            <button title={selectedLayer ? `Fly to ${selectedLayer.name}` : 'Select a layer to fly to it'} disabled={!selectedLayer || selectedLayer.geometry === 'Unknown'} onClick={() => { setOrbiting(false); if (selectedLayer) onFlyToLayer(selectedLayer) }}><Plane size={12} /></button>
          </div>

          <div className="scene-section-title"><Mountain size={11} />Terrain</div>
          <select
            aria-label="Terrain source"
            value={settings.terrain === 'layer' ? `layer:${settings.terrainLayerId ?? ''}` : settings.terrain}
            onChange={(event) => {
              const value = event.target.value
              if (value.startsWith('layer:')) onSettings({ terrain: 'layer', terrainLayerId: value.slice(6) })
              else onSettings({ terrain: value as 'none' | 'world' })
            }}
          >
            <option value="none">No terrain (flat)</option>
            <option value="world">World elevation (online tiles)</option>
            {demLayers.map((layer) => <option key={layer.id} value={`layer:${layer.id}`}>DEM: {layer.name}</option>)}
            {settings.terrain === 'layer' && !demLayers.some((layer) => layer.id === settings.terrainLayerId) && <option value={`layer:${settings.terrainLayerId ?? ''}`}>DEM: (missing layer)</option>}
          </select>
          {settings.terrain !== 'none' && (
            <>
              <label className="scene-slider">
                <span>Exaggerate</span>
                <input type="range" min={0.5} max={5} step={0.1} value={settings.exaggeration} aria-label="Terrain exaggeration" onChange={(event) => onSettings({ exaggeration: Number(event.target.value) })} />
                <output>{settings.exaggeration.toFixed(1)}×</output>
              </label>
              <label className="scene-check"><input type="checkbox" checked={settings.hillshade} onChange={(event) => onSettings({ hillshade: event.target.checked })} />Hillshade relief</label>
            </>
          )}
          {terrain.warning && <p className="scene-note warning">{terrain.warning}</p>}
          {terrain.range && <p className="scene-note">Elevation {terrain.range[0].toFixed(1)} – {terrain.range[1].toFixed(1)} m</p>}
          {settings.terrain === 'world' && <p className="scene-note">Global elevation tiles load from the internet, like the basemaps.</p>}

          <div className="scene-section-title"><Box size={11} />Extrusion</div>
          {extrudable ? (
            <>
              <select
                aria-label={`Extrusion field for ${extrudable.name}`}
                value={extrusionValue}
                onChange={(event) => {
                  const value = event.target.value
                  const multiplier = extrudable.extrusion?.multiplier ?? 1
                  onUpdateLayer(extrudable.id, {
                    extrusion: value === '__auto' ? undefined : value === '__off' ? null : { field: value, multiplier },
                  })
                }}
              >
                <option value="__auto">Auto{detected ? ` (${detected.field})` : ' (no height field found)'}</option>
                <option value="__off">Off — keep flat</option>
                {numericFields.map((field) => <option key={field} value={field}>{field}</option>)}
              </select>
              {extrudable.extrusion && (
                <label className="scene-slider">
                  <span>× metres</span>
                  <input
                    type="number" min={0} step={0.1} value={extrudable.extrusion.multiplier}
                    aria-label="Extrusion multiplier"
                    onChange={(event) => {
                      const multiplier = Number(event.target.value)
                      if (Number.isFinite(multiplier) && multiplier >= 0 && extrudable.extrusion) onUpdateLayer(extrudable.id, { extrusion: { ...extrudable.extrusion, multiplier } })
                    }}
                  />
                </label>
              )}
              <p className="scene-note">{isRasterLayer(extrudable) ? 'Extruding a DEM/DSM by "value" raises each cell to its elevation.' : `Height = ${extrudable.extrusion?.field ?? detected?.field ?? 'field'} × multiplier (m).`}</p>
            </>
          ) : <p className="scene-note">Select a polygon or raster layer to extrude it by a numeric attribute.</p>}
          <button className="scene-reset" onClick={() => ease({ pitch: 60, bearing: 0 })}><RotateCcw size={11} />Reset 3D view</button>
        </div>
      )}
    </section>
  )
}
