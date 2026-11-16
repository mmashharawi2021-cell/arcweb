import { useMemo, useState } from 'react'
import { ArrowLeft, BriefcaseBusiness, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, Folder, FolderOpen, Hammer, History, Loader2, Move, Play, RotateCcw, Search, Wrench, X, XCircle } from 'lucide-react'
import type { AnalysisRecord, MapLayer } from '../store'
import { restoreToolValues } from './history'
import { buildToolboxTree, searchTools, toolboxLabels, toolboxTools } from './registry'
import { fieldNames } from './shared'
import type { ToolboxParameters, ToolboxTool, ToolParameter } from './types'

interface ToolboxPanelProps {
  layers: MapLayer[]
  selectedLayerId: string | null
  /** Features selected across all layers; tools can be limited to them. */
  selectionCount: number
  /** Name of the tool currently running, if any. */
  running: string | null
  history: AnalysisRecord[]
  floating: boolean
  onToggleFloat: () => void
  onExecute: (tool: ToolboxTool, parameters: ToolboxParameters, options: { selectedOnly: boolean }) => void
  onClose: () => void
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function makeDefaultValues(tool: ToolboxTool, layers: MapLayer[], selectedLayerId: string | null): ToolboxParameters {
  const values: ToolboxParameters = {}
  for (const parameter of tool.parameters) {
    if (parameter.kind === 'layer') {
      values[parameter.id] = parameter.defaultValue ?? layers.find((layer) => layer.id === selectedLayerId)?.id ?? layers[0]?.id
    } else if (parameter.kind === 'number' || parameter.kind === 'text' || parameter.kind === 'select' || parameter.kind === 'color') {
      values[parameter.id] = parameter.defaultValue
    }
  }
  return values
}

export default function ToolboxPanel({ layers, selectedLayerId, selectionCount, running, history, floating, onToggleFloat, onExecute, onClose }: ToolboxPanelProps) {
  const [view, setView] = useState<'tools' | 'history'>('tools')
  // ArcGIS processes only the selected features when a selection exists; the box lets students opt out.
  const [useSelection, setUseSelection] = useState(true)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [activeToolId, setActiveToolId] = useState<string | null>(null)
  const searching = query.trim().length > 0
  const results = useMemo(() => (searching ? searchTools(query) : []), [query, searching])
  const tree = useMemo(() => buildToolboxTree(), [])
  const activeTool = toolboxTools.find((tool) => tool.id === activeToolId) ?? null
  const [values, setValues] = useState<ToolboxParameters>({})

  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const openTool = (tool: ToolboxTool) => {
    setValues(makeDefaultValues(tool, layers, selectedLayerId))
    setActiveToolId(tool.id)
  }

  const renderToolRow = (tool: ToolboxTool, depth: number, showPath = false) => (
    <button
      key={tool.id}
      role="treeitem"
      className="toolbox-tree-row toolbox-tree-tool"
      style={{ paddingLeft: 8 + depth * 14 }}
      title={tool.description}
      onClick={() => openTool(tool)}
    >
      <Hammer size={12} className="toolbox-tree-icon tool" />
      <span>
        <strong>{tool.name}</strong>
        {showPath && <small>{toolboxLabels[tool.category]}{tool.subcategory ? ` › ${tool.subcategory}` : ''}</small>}
      </span>
    </button>
  )

  const updateValue = (id: string, value: ToolboxParameters[string]) => {
    setValues((current) => ({ ...current, [id]: value }))
  }

  const selectedLayerFor = (parameter: Extract<ToolParameter, { kind: 'field' }>) => {
    const id = values[parameter.layerParameter]
    return layers.find((layer) => layer.id === id)
  }

  const renderParameter = (parameter: ToolParameter) => {
    if (parameter.kind === 'layer') {
      const current = values[parameter.id]
      return (
        <select value={typeof current === 'string' ? current : ''} onChange={(event) => updateValue(parameter.id, event.target.value)}>
          <option value="">Select a layer</option>
          {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
        </select>
      )
    }
    if (parameter.kind === 'layers') {
      const current = values[parameter.id]
      const chosen = typeof current === 'string' ? current.split(',').filter(Boolean) : []
      if (!layers.length) return <div className="toolbox-layer-checklist empty">Add layers to the map first.</div>
      return (
        <div className="toolbox-layer-checklist" role="group" aria-label={parameter.label}>
          {layers.map((layer) => (
            <label key={layer.id}>
              <input
                type="checkbox"
                checked={chosen.includes(layer.id)}
                onChange={(event) => updateValue(parameter.id, (event.target.checked
                  ? [...chosen, layer.id]
                  : chosen.filter((id) => id !== layer.id)).join(','))}
              />
              <span title={layer.name}>{layer.name}</span>
              <small>{layer.geometry}</small>
            </label>
          ))}
        </div>
      )
    }
    if (parameter.kind === 'field') {
      const fieldLayer = selectedLayerFor(parameter)
      const fieldOptions = fieldLayer ? fieldNames(fieldLayer) : []
      const current = values[parameter.id]
      return (
        <select value={typeof current === 'string' ? current : ''} onChange={(event) => updateValue(parameter.id, event.target.value)}>
          {parameter.allowEmpty && <option value="">None</option>}
          {!parameter.allowEmpty && <option value="">Select a field</option>}
          {fieldOptions.map((field) => <option key={field} value={field}>{field}</option>)}
        </select>
      )
    }
    if (parameter.kind === 'select') {
      const current = values[parameter.id]
      return (
        <select value={typeof current === 'string' ? current : parameter.defaultValue ?? ''} onChange={(event) => updateValue(parameter.id, event.target.value)}>
          {parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )
    }
    if (parameter.kind === 'file') {
      return <input type="file" accept={parameter.accept} onChange={(event) => updateValue(parameter.id, event.currentTarget.files?.[0])} />
    }
    if (parameter.kind === 'number') {
      const current = values[parameter.id]
      return (
        <input
          type="number"
          value={typeof current === 'number' ? current : current === undefined ? '' : String(current)}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          onChange={(event) => updateValue(parameter.id, event.target.value === '' ? undefined : Number(event.target.value))}
        />
      )
    }
    if (parameter.kind === 'color') {
      const current = values[parameter.id]
      return <input type="color" value={typeof current === 'string' ? current : parameter.defaultValue ?? '#ffffff'} onChange={(event) => updateValue(parameter.id, event.target.value)} />
    }
    const current = values[parameter.id]
    return (
      <input
        type="text"
        value={typeof current === 'string' ? current : ''}
        placeholder={parameter.placeholder}
        onChange={(event) => updateValue(parameter.id, event.target.value)}
      />
    )
  }

  return (
    <div className="toolbox-panel">
      <div className="dock-heading">
        <div><Wrench size={16} /><strong>Geoprocessing</strong></div>
        <div className="dock-heading-actions">
          <button className="panel-float-toggle" title={floating ? 'Dock Geoprocessing panel' : 'Float Geoprocessing panel'} aria-label={floating ? 'Dock Geoprocessing panel' : 'Float Geoprocessing panel'} onClick={onToggleFloat}><Move size={13} /><span>{floating ? 'Dock' : 'Float'}</span></button>
          <button className="subtle-icon" title="Collapse Geoprocessing pane" aria-label="Collapse Geoprocessing pane" onClick={onClose}><ArrowLeft size={15} /></button>
        </div>
      </div>
      <div className="toolbox-view-tabs" role="tablist" aria-label="Geoprocessing views">
        <button role="tab" aria-selected={view === 'tools'} className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}><BriefcaseBusiness size={12} />Toolboxes</button>
        <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={12} />History{history.length ? <em>{history.length}</em> : null}</button>
      </div>
      {view === 'history' ? (
        <div className="toolbox-history" aria-label="Geoprocessing history">
          {history.length === 0 && <div className="toolbox-no-results">Tools you run appear here with their parameters, timing and result.</div>}
          {history.map((entry) => {
            const tool = toolboxTools.find((item) => item.id === entry.toolId)
            return (
              <div key={entry.id} className={`toolbox-history-entry ${entry.status}`}>
                <div className="toolbox-history-title">
                  {entry.status === 'succeeded' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  <strong>{entry.toolName}</strong>
                  <span>{new Date(entry.startedAt).toLocaleTimeString()} · {formatDuration(entry.durationMs)}</span>
                </div>
                <p className="toolbox-history-message">{entry.message}</p>
                {entry.summary && <p className="toolbox-history-summary" title={entry.summary}>{entry.summary}</p>}
                <div className="toolbox-history-meta">
                  {entry.selectedOnly && <span className="toolbox-chip">Selected features</span>}
                  {entry.outputLayerNames.map((name) => <span key={name} className="toolbox-chip output">→ {name}</span>)}
                  {tool && (
                    <button className="toolbox-history-reopen" title="Open this tool with the same parameters" onClick={() => {
                      setValues({ ...makeDefaultValues(tool, layers, selectedLayerId), ...restoreToolValues(tool, entry.parameters, layers) })
                      setActiveToolId(tool.id)
                      setView('tools')
                    }}><RotateCcw size={11} />Open</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
      <>
      <label className="toolbox-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find tools" aria-label="Find tools" />
        {searching && <button className="subtle-icon" title="Clear search" onClick={() => setQuery('')}><X size={12} /></button>}
      </label>
      <div className="toolbox-tree-header">
        <span>{searching ? `${results.length} result${results.length === 1 ? '' : 's'}` : `Toolboxes · ${toolboxTools.length} tools`}</span>
        {!searching && expanded.size > 0 && <button className="subtle-icon" title="Collapse all" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={13} /></button>}
      </div>
      {activeTool ? (
        <div className="toolbox-tool-form">
          <button className="toolbox-back" onClick={() => setActiveToolId(null)}><ArrowLeft size={13} />All tools</button>
          <div className="toolbox-tool-title"><small>{toolboxLabels[activeTool.category]}{activeTool.subcategory ? ` › ${activeTool.subcategory}` : ''}</small><strong>{activeTool.name}</strong><span>{activeTool.description}</span></div>
          <div className="toolbox-parameters">
            {activeTool.parameters.map((parameter) => parameter.kind === 'layers' ? (
              <div className="toolbox-parameter" key={parameter.id}>
                <span>{parameter.label}{parameter.required && <b> *</b>}</span>
                {renderParameter(parameter)}
              </div>
            ) : (
              <label className="toolbox-parameter" key={parameter.id}>
                <span>{parameter.label}{parameter.required && <b> *</b>}</span>
                {renderParameter(parameter)}
              </label>
            ))}
          </div>
          {selectionCount > 0 && (
            <label className="toolbox-selection-option">
              <input type="checkbox" checked={useSelection} onChange={(event) => setUseSelection(event.target.checked)} />
              <span>Use selected features only <small>({selectionCount.toLocaleString()} selected; layers without a selection are used in full)</small></span>
            </label>
          )}
          <button
            className="phase-primary-button"
            disabled={running !== null || (!layers.length && activeTool.parameters.some((parameter) => parameter.kind === 'layer' || parameter.kind === 'layers'))}
            onClick={() => onExecute(activeTool, values, { selectedOnly: selectionCount > 0 && useSelection })}
          >
            {running ? <><Loader2 size={13} className="spin" /> Running {running}…</> : <><Play size={13} /> Run</>}
          </button>
        </div>
      ) : (
        <div className="toolbox-tool-list" role="tree" aria-label="Toolboxes">
          {searching ? (
            results.length ? results.map((tool) => renderToolRow(tool, 0, true)) : <div className="toolbox-no-results">No tools match this search.</div>
          ) : tree.map((toolbox) => {
            const boxKey = toolbox.category
            const boxOpen = expanded.has(boxKey)
            return (
              <div key={boxKey} role="group">
                <button role="treeitem" aria-expanded={boxOpen} className="toolbox-tree-row toolbox-tree-box" onClick={() => toggle(boxKey)}>
                  {boxOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <BriefcaseBusiness size={13} className="toolbox-tree-icon box" />
                  <span><strong>{toolbox.label}</strong></span>
                  <em>{toolbox.count}</em>
                </button>
                {boxOpen && toolbox.toolsets.map((toolset) => {
                  const setKey = `${boxKey}/${toolset.name}`
                  const setOpen = expanded.has(setKey)
                  return (
                    <div key={setKey} role="group">
                      <button role="treeitem" aria-expanded={setOpen} className="toolbox-tree-row toolbox-tree-set" style={{ paddingLeft: 22 }} onClick={() => toggle(setKey)}>
                        {setOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {setOpen ? <FolderOpen size={13} className="toolbox-tree-icon set" /> : <Folder size={13} className="toolbox-tree-icon set" />}
                        <span>{toolset.name}</span>
                        <em>{toolset.tools.length}</em>
                      </button>
                      {setOpen && toolset.tools.map((tool) => renderToolRow(tool, 3))}
                    </div>
                  )
                })}
                {boxOpen && toolbox.tools.map((tool) => renderToolRow(tool, 2))}
              </div>
            )
          })}
        </div>
      )}
      </>
      )}
      <div className="phase-panel-footer"><span>{running ? `Running ${running}…` : 'Tools run locally in your browser'}</span><span className={`panel-status-dot ${running ? 'busy' : ''}`} /></div>
    </div>
  )
}
