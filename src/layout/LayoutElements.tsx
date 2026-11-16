import type { ReactNode } from 'react'
import type { MapLayer } from '../store'
import { getGraduatedClasses, getUniqueValueClasses } from '../symbology'
import { pointsToPx } from './catalog'
import type { LegendElement, NorthArrowStyle, ScaleBarElement, TextElement, TitleBlockElement } from './layoutStore'
import { formatRatio, scaleBarSpec } from './scaleBar'

/** Presentational map elements drawn on the layout sheet. Sizes follow `scale` (screen px per mm). */

const ink = '#1b2127'

function northArrowShape(style: NorthArrowStyle): ReactNode {
  switch (style) {
    case 'arrow':
      return (
        <>
          <path d="M50 30 L66 96 L50 84 L34 96 Z" fill={ink} />
          <path d="M50 30 L50 84 L34 96 Z" fill="#ffffff" stroke={ink} strokeWidth="1.5" strokeLinejoin="round" />
        </>
      )
    case 'compass':
      return (
        <>
          <circle cx="50" cy="64" r="30" fill="#ffffff" stroke={ink} strokeWidth="1.6" />
          <circle cx="50" cy="64" r="24" fill="none" stroke={ink} strokeWidth=".6" />
          <path d="M50 64 L42 56 L50 30 L58 56 Z M50 64 L58 72 L50 98 L42 72 Z" fill={ink} />
          <path d="M50 64 L58 56 L84 64 L58 72 Z M50 64 L42 72 L16 64 L42 56 Z" fill="#ffffff" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M50 30 L50 64 L42 56 Z" fill="#ffffff" stroke={ink} strokeWidth=".8" />
          <circle cx="50" cy="64" r="2.4" fill={ink} />
        </>
      )
    case 'star':
      return (
        <>
          <path d="M50 28 L57 57 L84 64 L57 71 L50 100 L43 71 L16 64 L43 57 Z" fill="#ffffff" stroke={ink} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M50 28 L57 57 L50 64 Z M84 64 L57 71 L50 64 Z M50 100 L43 71 L50 64 Z M16 64 L43 57 L50 64 Z" fill={ink} />
        </>
      )
    default:
      return (
        <>
          <circle cx="50" cy="64" r="29" fill="#ffffff" stroke={ink} strokeWidth="1.8" />
          <path d="M50 32 L62 86 L50 78 L38 86 Z" fill={ink} />
          <path d="M50 32 L50 78 L38 86 Z" fill="#ffffff" stroke={ink} strokeWidth="1.2" strokeLinejoin="round" />
        </>
      )
  }
}

/** North arrow; `bearing` is the map rotation in degrees so the arrow keeps pointing to true north. */
export function NorthArrow({ style, bearing = 0 }: { style: NorthArrowStyle; bearing?: number }) {
  return (
    <svg className="layout-north" viewBox="0 0 100 104" preserveAspectRatio="xMidYMid meet" role="img" aria-label="North arrow">
      <g transform={`rotate(${-bearing} 50 64)`}>
        {northArrowShape(style)}
        <text x="50" y="22" textAnchor="middle" fontSize="24" fontWeight="700" fontFamily="Georgia, 'Times New Roman', serif" fill={ink}>N</text>
      </g>
    </svg>
  )
}

/** `resolve` expands dynamic-text tokens such as {date} or {scale}. */
export function TextBox({ element, scale, resolve }: { element: TextElement; scale: number; resolve: (text: string) => string }) {
  return (
    <div
      className="layout-text"
      style={{
        fontSize: pointsToPx(element.fontSize, scale),
        fontWeight: element.bold ? 700 : 400,
        fontStyle: element.italic ? 'italic' : 'normal',
        textAlign: element.align,
        color: element.color,
        justifyContent: element.type === 'title' ? 'center' : 'flex-start',
      }}
    >
      <span dir="auto">{resolve(element.text)}</span>
    </div>
  )
}

function Swatch({ layer, color }: { layer: MapLayer; color?: string }) {
  // Mirrors mapRendering.ts: class colours drive fills and line colours; point outlines keep the stroke colour.
  const fill = color ?? layer.fillColor
  const stroke = color && layer.geometry !== 'Point' ? color : layer.strokeColor
  const width = Math.max(1, Math.min(4, layer.strokeWidth))
  const fillOpacity = layer.opacity * layer.fillOpacity
  const dashArray = layer.strokeDash === 'dashed' ? '5 3' : layer.strokeDash === 'dotted' ? '1 3' : undefined
  return (
    <svg className="layout-legend-swatch" viewBox="0 0 28 16" aria-hidden="true">
      {layer.geometry === 'Point' ? (
        layer.pointShape === 'square' ? (
          <rect x="9" y="3" width="10" height="10" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.min(2.5, width)} />
        ) : layer.pointShape === 'triangle' ? (
          <path d="M14 2 L21 14 L7 14 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.min(2.5, width)} />
        ) : layer.pointShape === 'diamond' ? (
          <path d="M14 2 L21 8 L14 14 L7 8 Z" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.min(2.5, width)} />
        ) : (
          <circle cx="14" cy="8" r="5" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.min(2.5, width)} />
        )
      ) : layer.geometry === 'Line' ? (
        <path d="M2 12 L10 5 L18 11 L26 4" fill="none" stroke={color ?? layer.strokeColor} strokeOpacity={layer.opacity} strokeWidth={width} strokeDasharray={dashArray} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <rect x="2" y="2" width="24" height="12" rx="1" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={Math.min(2.5, width)} strokeDasharray={dashArray} />
      )}
    </svg>
  )
}

function legendClasses(layer: MapLayer) {
  const renderer = layer.renderer
  if (renderer.type === 'unique') {
    return getUniqueValueClasses(layer, renderer.field, renderer)
  }
  if (renderer.type === 'graduated') {
    return getGraduatedClasses(renderer)
  }
  return []
}

/** Legend generated from the visible layers, in drawing order, using their current symbology. */
export function Legend({ element, layers, scale }: { element: LegendElement; layers: MapLayer[]; scale: number }) {
  const visible = layers.filter((layer) => layer.visible && layer.geometry !== 'Unknown')
  return (
    <div className={`layout-legend ${element.frame ? 'framed' : ''}`} style={{ fontSize: pointsToPx(element.fontSize, scale) }}>
      {element.title && <div className="layout-legend-title">{element.title}</div>}
      {visible.length === 0 && <div className="layout-legend-empty">No visible layers</div>}
      {visible.map((layer) => {
        const classes = legendClasses(layer)
        if (!classes.length) {
          return <div className="layout-legend-row" key={layer.id}><Swatch layer={layer} /><span dir="auto">{layer.name}</span></div>
        }
        return (
          <div className="layout-legend-group" key={layer.id}>
            <div className="layout-legend-layer" dir="auto">{layer.name}</div>
            {layer.renderer.type !== 'single' && <div className="layout-legend-field">{layer.renderer.field}</div>}
            {classes.map((item) => (
              <div className="layout-legend-row" key={item.label}><Swatch layer={layer} color={item.color} /><span dir="auto">{item.label}</span></div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Scale bar tied to the map frame. `groundMetersPerMm` is how many metres on the ground
 * one millimetre of paper represents at the centre of the map frame.
 */
export function ScaleBar({ element, scale, groundMetersPerMm }: { element: ScaleBarElement; scale: number; groundMetersPerMm: number | null }) {
  const fontPx = pointsToPx(element.fontSize, scale)
  if (!groundMetersPerMm || !Number.isFinite(groundMetersPerMm)) {
    return <div className="layout-scalebar" style={{ fontSize: fontPx }}><span className="layout-legend-empty">Add a map frame to show the scale</span></div>
  }
  // Leave room on both sides for the end labels.
  const availableMm = Math.max(10, element.w - 10)
  const { barMm, divisions, labels, unitLabel } = scaleBarSpec(availableMm, groundMetersPerMm, element.units ?? 'metric')
  const barHeight = Math.max(2, fontPx * 0.55)
  return (
    <div className="layout-scalebar" style={{ fontSize: fontPx }}>
      {element.showRatio && <div className="layout-scale-ratio">Scale {formatRatio(groundMetersPerMm * 1000)}</div>}
      <div className="layout-scale-track" style={{ width: barMm * scale }}>
        <div className="layout-scale-labels">
          {Array.from({ length: divisions + 1 }, (_, index) => (
            <span key={index} style={{ left: `${index / divisions * 100}%` }}>{labels[index]}{index === divisions ? ` ${unitLabel}` : ''}</span>
          ))}
        </div>
        {element.style === 'alternating' ? (
          <div className="layout-scale-bar" style={{ height: barHeight }}>
            {Array.from({ length: divisions }, (_, index) => <i key={index} className={index % 2 === 0 ? 'dark' : ''} />)}
          </div>
        ) : (
          <div className="layout-scale-line" style={{ height: barHeight }}>
            {Array.from({ length: divisions + 1 }, (_, index) => <i key={index} style={{ left: `${index / divisions * 100}%` }} />)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Title block: accent rule, title and subtitle, then metadata rows whose values may use {tokens}. */
export function TitleBlock({ element, scale, resolve }: { element: TitleBlockElement; scale: number; resolve: (text: string) => string }) {
  const base = pointsToPx(element.fontSize, scale)
  return (
    <div className={`layout-titleblock ${element.frame ? 'framed' : ''}`} style={{ fontSize: base }}>
      <div className="layout-titleblock-head" style={{ borderLeftColor: element.accent }}>
        <strong dir="auto" style={{ fontSize: base * 1.9 }}>{resolve(element.title)}</strong>
        {element.subtitle && <span style={{ fontSize: base * 1.1 }}>{resolve(element.subtitle)}</span>}
      </div>
      {element.fields.length > 0 && (
        <dl className="layout-titleblock-fields">
          {element.fields.map((field, index) => (
            <div key={index}><dt>{field.label}</dt><dd dir="auto">{resolve(field.value)}</dd></div>
          ))}
        </dl>
      )}
    </div>
  )
}
