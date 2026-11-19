import { useState } from 'react'
import type { LabelStyle, MapLayer } from '../store'

const ANCHORS: { value: LabelStyle['anchor']; label: string }[] = [
  { value: 'center', label: 'Centered' },
  { value: 'top', label: 'Above center' },
  { value: 'bottom', label: 'Below center' },
  { value: 'left', label: 'Left center' },
  { value: 'right', label: 'Right center' },
  { value: 'top-left', label: 'Above left' },
  { value: 'top-right', label: 'Above right' },
  { value: 'bottom-left', label: 'Below left' },
  { value: 'bottom-right', label: 'Below right' },
]

type Tab = 'symbol' | 'position' | 'conflict'

export function LabelClassPane({ layer, onUpdate }: { layer: MapLayer | null; onUpdate: (updates: Partial<MapLayer>) => void }) {
  const [tab, setTab] = useState<Tab>('symbol')

  if (!layer) {
    return <div className="pro-pane-content label-class-empty"><p>Select a feature layer to edit its label class.</p></div>
  }

  const style = layer.labelStyle
  const update = (patch: Partial<LabelStyle>) => onUpdate({ labelStyle: { ...style, ...patch } })

  return (
    <div className="pro-pane-content label-class-pane">
      <div className="lc-layer-name"><bdi>{layer.name}</bdi></div>
      <div className="lc-tabs" role="tablist">
        {(['symbol', 'position', 'conflict'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'symbol' ? 'Symbol' : t === 'position' ? 'Position' : 'Conflict'}
          </button>
        ))}
      </div>

      {tab === 'symbol' && (
        <div className="lc-section">
          <label className="lc-field">
            <span>Font size (pt)</span>
            <input type="number" min={6} max={48} step={1} value={style?.fontSize ?? 11}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 6 && v <= 48) update({ fontSize: v }) }} />
          </label>
          <label className="lc-field">
            <span>Text color</span>
            <input type="color" value={style?.color ?? '#000000'}
              onChange={(e) => update({ color: e.target.value })} />
          </label>
          <label className="lc-field">
            <span>Halo color</span>
            <input type="color" value={toHexColor(style?.haloColor ?? 'rgba(18,22,30,0.88)')}
              onChange={(e) => update({ haloColor: e.target.value })} />
          </label>
          <label className="lc-field">
            <span>Halo width (px)</span>
            <input type="number" min={0} max={8} step={0.5} value={style?.haloWidth ?? 1.4}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 8) update({ haloWidth: v }) }} />
          </label>
        </div>
      )}

      {tab === 'position' && (
        <div className="lc-section">
          <label className="lc-field">
            <span>Anchor point</span>
            <select value={style?.anchor ?? 'top'} onChange={(e) => update({ anchor: e.target.value as LabelStyle['anchor'] })}>
              {ANCHORS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="lc-field">
            <span>Offset X (em)</span>
            <input type="number" min={-10} max={10} step={0.25} value={style?.offsetX ?? 0}
              onChange={(e) => update({ offsetX: Number(e.target.value) })} />
          </label>
          <label className="lc-field">
            <span>Offset Y (em)</span>
            <input type="number" min={-10} max={10} step={0.25} value={style?.offsetY ?? (style?.offset ?? 1.15)}
              onChange={(e) => update({ offsetY: Number(e.target.value) })} />
          </label>
          <label className="lc-field">
            <span>Symbol placement</span>
            <select value={style?.placement ?? 'point'} onChange={(e) => update({ placement: e.target.value as 'point' | 'line' })}>
              <option value="point">Point (centered on feature)</option>
              <option value="line">Along line</option>
            </select>
          </label>
        </div>
      )}

      {tab === 'conflict' && (
        <div className="lc-section">
          <label className="lc-field lc-field-check">
            <input type="checkbox" checked={style?.neverRemove ?? false}
              onChange={(e) => update({ neverRemove: e.target.checked })} />
            <span>Never remove (always draw label)</span>
          </label>
          <p className="lc-hint">When checked, this label is drawn even if it overlaps other features or labels.</p>
          <label className="lc-field">
            <span>Priority (1 = highest)</span>
            <input type="range" min={1} max={5} step={1} value={style?.priority ?? 3}
              onChange={(e) => update({ priority: Number(e.target.value) })} />
            <span className="lc-range-value">{style?.priority ?? 3}</span>
          </label>
          <p className="lc-hint">When labels compete for space, higher-priority labels are drawn first.</p>
        </div>
      )}
    </div>
  )
}

function toHexColor(color: string): string {
  if (color.startsWith('#')) return color
  const canvas = document.createElement('canvas')
  canvas.width = 1; canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return '#000000'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
