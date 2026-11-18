import { useState } from 'react'
import {
  ArrowDownToLine, ArrowUpToLine, Braces, Download, FileImage, LayoutTemplate, ListTree, Map as MapIcon, Plus, RotateCcw, Trash2, Undo2, X,
} from 'lucide-react'
import type { ViewMode } from '../store'
import { DYNAMIC_TOKENS } from './dynamicText'
import { effectiveExportDpi, type LayoutExportFormat } from './exportLayout'
import { insertableElements, layoutDpiOptions, northArrowStyles } from './catalog'
import { NorthArrow } from './LayoutElements'
import {
  elementLabels, pageSize, useLayoutStore, type LayoutElement, type LayoutElementType, type Orientation, type PaperSize,
} from './layoutStore'
import { PAPER_SIZES } from './paper'
import { LAYOUT_TEMPLATES, type LayoutTemplateId } from './templates'
import { useInView } from '../ui/useInView'

/** Clickable list of dynamic-text tokens; clicking one appends it to the field being edited. */
function TokenHelp({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="layout-token-help">
      <span><Braces size={11} />Dynamic text</span>
      <div>
        {DYNAMIC_TOKENS.map((item) => (
          <button key={item.token} type="button" title={item.description} onClick={() => onInsert(item.token)}>{item.token}</button>
        ))}
      </div>
    </div>
  )
}

interface LayoutPanelProps {
  viewMode: ViewMode
  exporting: boolean
  onSetViewMode: (mode: ViewMode) => void
  onInsert: (type: LayoutElementType) => void
  onExport: (format: LayoutExportFormat, dpi: number) => void
}

function NumberField({ label, value, onChange, step = 1, min }: { label: string; value: number; onChange: (value: number) => void; step?: number; min?: number }) {
  return (
    <label className="layout-number-field">
      <span>{label}</span>
      <input type="number" value={Number(value.toFixed(1))} step={step} min={min} onChange={(event) => {
        const next = Number(event.target.value)
        if (event.target.value !== '' && Number.isFinite(next)) onChange(next)
      }} />
    </label>
  )
}

function ElementProperties({ element }: { element: LayoutElement }) {
  const update = (updates: Partial<LayoutElement>) => useLayoutStore.getState().updateElement(element.id, updates)
  const store = useLayoutStore.getState()
  return (
    <>
      <div className="phase-section-title">{elementLabels[element.type]} properties</div>
      {element.type === 'picture' && <>
        <label className="phase-field-label" htmlFor="picture-alt">Description</label>
        <input id="picture-alt" className="phase-text-input" value={element.alt} onChange={e => update({ alt: e.target.value })} />
        <label className="phase-field-label" htmlFor="picture-fit">Fit</label>
        <select id="picture-fit" className="phase-text-input" value={element.fit} onChange={e => update({ fit: e.target.value as 'contain' | 'cover' })}><option value="contain">Fit whole picture</option><option value="cover">Fill frame (crop)</option></select>
      </>}
      {(element.type === 'title' || element.type === 'text') && (
        <>
          <label className="phase-field-label" htmlFor="layout-text">Text</label>
          <textarea id="layout-text" className="phase-text-input layout-textarea" value={element.text} rows={element.type === 'title' ? 2 : 4} onChange={(event) => update({ text: event.target.value })} />
          <TokenHelp onInsert={(token) => update({ text: `${element.text}${element.text && !element.text.endsWith(' ') ? ' ' : ''}${token}` })} />
          <div className="layout-field-grid">
            <NumberField label="Size (pt)" value={element.fontSize} min={4} onChange={(fontSize) => update({ fontSize: Math.max(4, fontSize) })} />
            <label className="layout-number-field"><span>Color</span><input type="color" value={element.color} onChange={(event) => update({ color: event.target.value })} /></label>
          </div>
          <div className="layout-toggle-row">
            <button className={element.bold ? 'active' : ''} onClick={() => update({ bold: !element.bold })}><b>B</b></button>
            <button className={element.italic ? 'active' : ''} onClick={() => update({ italic: !element.italic })}><i>I</i></button>
            <span />
            {(['left', 'center', 'right'] as const).map((align) => (
              <button key={align} className={element.align === align ? 'active' : ''} onClick={() => update({ align })}>{align[0].toUpperCase() + align.slice(1)}</button>
            ))}
          </div>
        </>
      )}
      {element.type === 'legend' && (
        <>
          <label className="phase-field-label" htmlFor="layout-legend-title">Legend title</label>
          <input id="layout-legend-title" className="phase-text-input" value={element.title} onChange={(event) => update({ title: event.target.value })} />
          <div className="layout-field-grid">
            <NumberField label="Text size (pt)" value={element.fontSize} min={4} onChange={(fontSize) => update({ fontSize: Math.max(4, fontSize) })} />
            <label className="layout-check"><input type="checkbox" checked={element.frame} onChange={(event) => update({ frame: event.target.checked })} /><span>Frame</span></label>
          </div>
          <div className="tool-hint"><ListTree size={13} /><span>The legend lists every visible layer with its current symbology and updates automatically.</span></div>
        </>
      )}
      {element.type === 'north' && (
        <div className="layout-north-styles">
          {northArrowStyles.map((style) => (
            <button key={style.id} className={element.style === style.id ? 'active' : ''} onClick={() => update({ style: style.id })} title={style.label}>
              <span><NorthArrow style={style.id} /></span>{style.label}
            </button>
          ))}
        </div>
      )}
      {element.type === 'scalebar' && (
        <>
          <label className="phase-field-label" htmlFor="layout-scale-style">Style</label>
          <div className="phase-select-wrap">
            <select id="layout-scale-style" value={element.style} onChange={(event) => update({ style: event.target.value as 'alternating' | 'line' })}>
              <option value="alternating">Alternating bar</option>
              <option value="line">Line with ticks</option>
            </select>
          </div>
          <label className="phase-field-label" htmlFor="layout-scale-units">Units</label>
          <div className="phase-select-wrap">
            <select id="layout-scale-units" value={element.units ?? 'metric'} onChange={(event) => update({ units: event.target.value as 'metric' | 'imperial' })}>
              <option value="metric">Metric (m / km)</option>
              <option value="imperial">Imperial (ft / mi)</option>
            </select>
          </div>
          <div className="layout-field-grid">
            <NumberField label="Text size (pt)" value={element.fontSize} min={4} onChange={(fontSize) => update({ fontSize: Math.max(4, fontSize) })} />
            <label className="layout-check"><input type="checkbox" checked={element.showRatio} onChange={(event) => update({ showRatio: event.target.checked })} /><span>Show 1:n</span></label>
          </div>
        </>
      )}
      {element.type === 'titleblock' && (
        <>
          <label className="phase-field-label" htmlFor="layout-tb-title">Title</label>
          <input id="layout-tb-title" className="phase-text-input" value={element.title} onChange={(event) => update({ title: event.target.value })} />
          <label className="phase-field-label" htmlFor="layout-tb-subtitle">Subtitle</label>
          <input id="layout-tb-subtitle" className="phase-text-input" value={element.subtitle} onChange={(event) => update({ subtitle: event.target.value })} />
          <div className="phase-field-label">Metadata fields <span>(values accept dynamic text)</span></div>
          <div className="layout-tb-fields">
            {element.fields.map((field, index) => (
              <div className="layout-tb-field" key={index}>
                <input aria-label={`Field ${index + 1} label`} value={field.label} placeholder="Label" onChange={(event) => update({ fields: element.fields.map((item, i) => i === index ? { ...item, label: event.target.value } : item) })} />
                <input aria-label={`Field ${index + 1} value`} value={field.value} placeholder="Value or {token}" onChange={(event) => update({ fields: element.fields.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} />
                <button title="Remove field" onClick={() => update({ fields: element.fields.filter((_, i) => i !== index) })}><X size={11} /></button>
              </div>
            ))}
            <button className="layout-tb-add" disabled={element.fields.length >= 10} onClick={() => update({ fields: [...element.fields, { label: 'Field', value: '' }] })}><Plus size={11} />Add field</button>
          </div>
          <TokenHelp onInsert={(token) => {
            const last = element.fields.length - 1
            if (last >= 0) update({ fields: element.fields.map((item, i) => i === last ? { ...item, value: `${item.value}${item.value ? ' ' : ''}${token}` } : item) })
          }} />
          <div className="layout-field-grid">
            <NumberField label="Text size (pt)" value={element.fontSize} min={4} onChange={(fontSize) => update({ fontSize: Math.max(4, fontSize) })} />
            <label className="layout-number-field"><span>Accent</span><input type="color" value={element.accent} onChange={(event) => update({ accent: event.target.value })} /></label>
          </div>
          <label className="layout-check"><input type="checkbox" checked={element.frame} onChange={(event) => update({ frame: event.target.checked })} /><span>Frame</span></label>
        </>
      )}
      {element.type === 'map' && (
        <>
          <label className="layout-check"><input type="checkbox" checked={element.border} onChange={(event) => update({ border: event.target.checked })} /><span>Draw frame border</span></label>
          <div className="tool-hint"><MapIcon size={13} /><span>The frame shows the live map: pan and zoom inside it to set the extent. Move the frame with its “Map frame” grip.</span></div>
        </>
      )}
      <div className="phase-field-label">Position and size <span>(mm)</span></div>
      <div className="layout-field-grid four">
        <NumberField label="X" value={element.x} onChange={(x) => update({ x })} />
        <NumberField label="Y" value={element.y} onChange={(y) => update({ y })} />
        <NumberField label="W" value={element.w} min={6} onChange={(w) => update({ w: Math.max(6, w) })} />
        <NumberField label="H" value={element.h} min={6} onChange={(h) => update({ h: Math.max(6, h) })} />
      </div>
      <div className="layout-toggle-row">
        <button onClick={() => store.reorderElement(element.id, 'front')}><ArrowUpToLine size={12} />Front</button>
        <button onClick={() => store.reorderElement(element.id, 'back')}><ArrowDownToLine size={12} />Back</button>
        <span />
        <button className="danger" onClick={() => store.removeElement(element.id)}><Trash2 size={12} />Delete</button>
      </div>
    </>
  )
}

export default function LayoutPanel({ viewMode, exporting, onSetViewMode, onInsert, onExport }: LayoutPanelProps) {
  const paper = useLayoutStore((state) => state.paper)
  const orientation = useLayoutStore((state) => state.orientation)
  const elements = useLayoutStore((state) => state.elements)
  const selectedId = useLayoutStore((state) => state.selectedId)
  const selected = elements.find((element) => element.id === selectedId) ?? null
  const hasMapFrame = elements.some((element) => element.type === 'map')
  const [dpi, setDpi] = useState<number>(200)
  const [template, setTemplate] = useState<LayoutTemplateId>('side-panel')
  const canUndoTemplate = useLayoutStore((state) => state.previousElements !== null)
  const sheet = pageSize(paper, orientation)
  const exportPlan = effectiveExportDpi(sheet.width, sheet.height, dpi)
  // Scroll-in reveal for layout panel sections (compositor-only transform/opacity).
  const [viewSwitchRef, viewSwitchVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })
  const [pageSetupRef, pageSetupVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })
  const [templateListRef, templateListVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })
  const [templateActionsRef, templateActionsVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })
  const [drawToolsRef, drawToolsVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })
  const [toolHintRef, toolHintVisible] = useInView<HTMLDivElement>({ threshold: 0.2 })

  return (
    <div className="phase-panel layout-panel">
      <header className="phase-panel-heading">
        <div className="phase-panel-icon"><LayoutTemplate size={17} /></div>
        <div><strong>Print layout</strong><span>Compose a map sheet for export</span></div>
      </header>
      <div className="phase-panel-body">
        <div
          className={`layout-view-switch arcweb-reveal ${viewSwitchVisible ? 'is-visible' : ''}`}
          ref={viewSwitchRef}
        >
          <button className={viewMode === 'map' ? 'active' : ''} onClick={() => onSetViewMode('map')}><MapIcon size={13} />Map view</button>
          <button className={viewMode === 'layout' ? 'active' : ''} onClick={() => onSetViewMode('layout')}><LayoutTemplate size={13} />Layout view</button>
        </div>

        <div className="phase-section-title layout-section">Page setup</div>
        <div
          className={`layout-field-grid arcweb-reveal ${pageSetupVisible ? 'is-visible' : ''}`}
          ref={pageSetupRef}
        >
          <label className="layout-number-field"><span>Paper</span>
            <select value={paper} onChange={(event) => useLayoutStore.getState().setPage(event.target.value as PaperSize, orientation)}>
              {PAPER_SIZES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="layout-number-field"><span>Orientation</span>
            <select value={orientation} onChange={(event) => useLayoutStore.getState().setPage(paper, event.target.value as Orientation)}>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </label>
        </div>

        <div className="phase-section-title layout-section">Template</div>
        <div
          className={`layout-template-list arcweb-reveal ${templateListVisible ? 'is-visible' : ''}`}
          ref={templateListRef}
          role="radiogroup"
          aria-label="Layout templates"
        >
          {LAYOUT_TEMPLATES.map((item) => (
            <button key={item.id} role="radio" aria-checked={template === item.id} className={template === item.id ? 'active' : ''} title={item.description} onClick={() => setTemplate(item.id)}>
              <span className={`layout-template-thumb thumb-${item.id}`} aria-hidden="true"><i /><i /><i /></span>
              {item.name}
            </button>
          ))}
        </div>
        <div
          className={`layout-template-actions arcweb-reveal ${templateActionsVisible ? 'is-visible' : ''}`}
          ref={templateActionsRef}
        >
          <button className="phase-secondary-button" title="Replace the sheet with this template (you can undo once)" onClick={() => useLayoutStore.getState().applyTemplate(template)}><LayoutTemplate size={13} />Apply template</button>
          {canUndoTemplate && <button className="phase-secondary-button" title="Bring back the elements from before the last template" onClick={() => useLayoutStore.getState().undoTemplate()}><Undo2 size={13} />Undo</button>}
        </div>

        <div className="phase-section-title layout-section">Insert map elements</div>
        <div
          className={`draw-tool-grid arcweb-reveal ${drawToolsVisible ? 'is-visible' : ''}`}
          ref={drawToolsRef}
        >
          {insertableElements.map(({ type, icon: Icon }) => (
            <button key={type} onClick={() => onInsert(type)} title={type === 'map' && hasMapFrame ? 'Select the existing map frame' : `Insert ${elementLabels[type].toLowerCase()}`}>
              <Icon size={15} />{elementLabels[type]}
            </button>
          ))}
        </div>

        <div className="phase-panel-separator" />
        {selected && viewMode === 'layout'
          ? <ElementProperties key={selected.id} element={selected} />
          : <div
            className={`tool-hint arcweb-reveal ${toolHintVisible ? 'is-visible' : ''}`}
            ref={toolHintRef}
          ><LayoutTemplate size={13} /><span>{viewMode === 'layout' ? 'Click an element on the sheet to edit it. Drag to move, use the handles to resize, arrow keys to nudge, Delete to remove. Hold Alt to disable 1 mm snapping.' : 'Switch to Layout view to arrange the map frame, title, legend, north arrow and scale bar on the page.'}</span></div>}

        <div className="phase-panel-separator" />
        <div className="phase-section-title">Export layout</div>
        <label className="phase-field-label" htmlFor="layout-dpi">Resolution</label>
        <div className="phase-select-wrap">
          <select id="layout-dpi" value={dpi} onChange={(event) => setDpi(Number(event.target.value))}>
            {layoutDpiOptions.map((value) => <option key={value} value={value}>{value} dpi{value === 600 ? ' — fine print' : value === 300 ? ' — print quality' : value === 150 ? ' — draft' : ''}</option>)}
          </select>
        </div>
        <p className={`layout-export-size ${exportPlan.capped ? 'capped' : ''}`}>
          {Math.round(sheet.width / 25.4 * exportPlan.dpi).toLocaleString()} × {Math.round(sheet.height / 25.4 * exportPlan.dpi).toLocaleString()} px
          {exportPlan.capped && ` — reduced to ${exportPlan.dpi} dpi; ${dpi} dpi on ${paper} is beyond what the browser can render.`}
        </p>
        <div className="export-choice-list">
          <button disabled={exporting} onClick={() => onExport('png', dpi)}><FileImage size={17} /><span><strong>PNG image</strong><small>High-resolution raster of the sheet</small></span><Download size={13} /></button>
          <button disabled={exporting} onClick={() => onExport('pdf', dpi)}><span className="csv-file-icon">PDF</span><span><strong>PDF document</strong><small>Single page at true {paper} size</small></span><Download size={13} /></button>
        </div>
        <button className="phase-secondary-button" title="Replace the sheet with the Classic template (you can undo once)" onClick={() => useLayoutStore.getState().resetTemplate()}><RotateCcw size={13} />Reset to default template</button>
      </div>
      <footer className="phase-panel-footer"><span>{elements.length} elements · {paper} {orientation}</span><span className="panel-status-dot" />{exporting ? 'Exporting…' : 'Rendered locally'}</footer>
    </div>
  )
}
