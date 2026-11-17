import { useEffect, useMemo, useState } from 'react'
import { ListFilter, Plus, SquareDashedMousePointer, Trash2, X } from 'lucide-react'
import type { FeatureId, MapLayer, SelectionMethod } from '../store'
import { trapTabKey, useRestoreFocus } from '../a11y/modalFocus'
import { useFadeExit } from '../ui/useFadeExit'
import { fieldNames } from '../toolboxes/shared'
import {
  evaluateQuery, isNumericField, newClause, operatorNeedsValue, queryOperators, queryToSql, uniqueValues, usableClauses,
  type QueryClause, type QueryOperator,
} from './attributeQuery'
import { selectByLocation, spatialRelationships, type SpatialRelationship } from './locationQuery'

const selectionMethods: { id: SelectionMethod; label: string }[] = [
  { id: 'new', label: 'New selection' },
  { id: 'add', label: 'Add to the current selection' },
  { id: 'remove', label: 'Remove from the current selection' },
  { id: 'subset', label: 'Select subset from the current selection' },
]

interface DialogProps {
  layers: MapLayer[]
  initialLayerId: string | null
  selections: Record<string, FeatureId[]>
  /** Applies the matches and returns the size of the layer's resulting selection. */
  onApply: (layerId: string, featureIds: FeatureId[], method: SelectionMethod) => number
  onClose: () => void
}

type Outcome = { kind: 'success' | 'warning' | 'error'; text: string } | null

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}

function LayerSelect({ id, label, layers, value, onChange, autoFocus }: { id: string; label: string; layers: MapLayer[]; value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  return (
    <label className="dialog-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)}>
        {!layers.length && <option value="">No layers in the map</option>}
        {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name} ({layer.data.features.length.toLocaleString('en-US')})</option>)}
      </select>
    </label>
  )
}

function MethodSelect({ value, onChange }: { value: SelectionMethod; onChange: (method: SelectionMethod) => void }) {
  return (
    <label className="dialog-field" htmlFor="selection-method">
      <span>Selection type</span>
      <select id="selection-method" value={value} onChange={(event) => onChange(event.target.value as SelectionMethod)}>
        {selectionMethods.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}
      </select>
    </label>
  )
}

function describe(matched: number, total: number, method: SelectionMethod, layerName: string): Outcome {
  const count = `${matched.toLocaleString('en-US')} feature${matched === 1 ? '' : 's'}`
  const text = method === 'new'
    ? `${count} selected in ${layerName}.`
    : `${count} matched; ${layerName} now has ${total.toLocaleString('en-US')} selected.`
  return { kind: (method === 'new' ? matched : total) ? 'success' : 'warning', text }
}

export function SelectByAttributesDialog({ layers, initialLayerId, selections, onApply, onClose }: DialogProps) {
  const fadeRef = useFadeExit<HTMLDivElement>()
  useEscape(onClose)
  useRestoreFocus()
  const [layerId, setLayerId] = useState(initialLayerId && layers.some((layer) => layer.id === initialLayerId) ? initialLayerId : layers[0]?.id ?? '')
  const layer = layers.find((item) => item.id === layerId)
  const fields = useMemo(() => layer ? fieldNames(layer) : [], [layer])
  const [clauses, setClauses] = useState<QueryClause[]>(() => [newClause(fields[0] ?? '')])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [method, setMethod] = useState<SelectionMethod>('new')
  const [outcome, setOutcome] = useState<Outcome>(null)

  const active = clauses.find((clause) => clause.id === activeId) ?? clauses[clauses.length - 1]
  const activeField = active?.field ?? ''
  const sampler = useMemo(() => layer && activeField ? uniqueValues(layer, activeField) : { values: [], truncated: false }, [layer, activeField])
  const sql = queryToSql(layer, clauses)

  const update = (id: string, updates: Partial<QueryClause>) => {
    setClauses((current) => current.map((clause) => clause.id === id ? { ...clause, ...updates } : clause))
    setOutcome(null)
  }
  const changeLayer = (id: string) => {
    const next = layers.find((item) => item.id === id)
    setLayerId(id)
    setClauses([newClause(next ? fieldNames(next)[0] ?? '' : '')])
    setActiveId(null)
    setOutcome(null)
  }
  const apply = () => {
    if (!layer) return false
    try {
      const ids = evaluateQuery(layer, clauses)
      setOutcome(describe(ids.length, onApply(layer.id, ids, method), method, layer.name))
      return true
    } catch (error) {
      setOutcome({ kind: 'error', text: error instanceof Error ? error.message : 'The query could not be evaluated.' })
      return false
    }
  }

  return (
    <div ref={fadeRef} className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal selection-dialog attribute-dialog" role="dialog" aria-modal="true" aria-label="Select By Attributes" onKeyDown={trapTabKey}>
        <header className="modal-header">
          <div><ListFilter size={15} /><strong>Select By Attributes</strong><span>Build a WHERE clause</span></div>
          <button className="subtle-icon" title="Close" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="dialog-body">
          <div className="dialog-main">
            <div className="dialog-grid">
              <LayerSelect id="sba-layer" autoFocus label="Input layer" layers={layers} value={layerId} onChange={changeLayer} />
              <MethodSelect value={method} onChange={setMethod} />
            </div>
            <div className="dialog-section-title">Where</div>
            <div className="query-clauses">
              {clauses.map((clause, index) => (
                <div key={clause.id} className={`query-clause ${clause.id === active?.id ? 'active' : ''}`} onFocusCapture={() => setActiveId(clause.id)}>
                  {index === 0 ? <span className="query-where">WHERE</span> : (
                    <select aria-label="Connector" className="query-connector" value={clause.connector} onChange={(event) => update(clause.id, { connector: event.target.value as 'AND' | 'OR' })}>
                      <option value="AND">AND</option><option value="OR">OR</option>
                    </select>
                  )}
                  <select aria-label="Field" value={clause.field} onChange={(event) => update(clause.id, { field: event.target.value, value: '' })}>
                    {!fields.length && <option value="">No fields</option>}
                    {fields.map((field) => <option key={field} value={field}>{field}</option>)}
                  </select>
                  <select aria-label="Operator" className="query-operator" value={clause.operator} onChange={(event) => update(clause.id, { operator: event.target.value as QueryOperator })}>
                    {queryOperators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                  </select>
                  <input
                    aria-label="Value"
                    value={operatorNeedsValue(clause.operator) ? clause.value : ''}
                    disabled={!operatorNeedsValue(clause.operator)}
                    placeholder={clause.operator.includes('LIKE') ? 'Pattern, e.g. Al%' : operatorNeedsValue(clause.operator) ? 'Value' : '—'}
                    onChange={(event) => update(clause.id, { value: event.target.value })}
                    onKeyDown={(event) => { if (event.key === 'Enter') apply() }}
                  />
                  <button title="Remove condition" disabled={clauses.length === 1} onClick={() => { setClauses((current) => current.filter((item) => item.id !== clause.id)); setOutcome(null) }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
            <div className="query-add">
              <button onClick={() => { const clause = newClause(active?.field ?? fields[0] ?? '', 'AND'); setClauses((current) => [...current, clause]); setActiveId(clause.id) }}><Plus size={12} />AND condition</button>
              <button onClick={() => { const clause = newClause(active?.field ?? fields[0] ?? '', 'OR'); setClauses((current) => [...current, clause]); setActiveId(clause.id) }}><Plus size={12} />OR condition</button>
              <span>LIKE uses % for any text and _ for one character · AND is evaluated before OR</span>
            </div>
            <div className="dialog-section-title">Expression</div>
            <pre className="query-sql">{layer ? `SELECT * FROM "${layer.name}"\nWHERE ${sql ? sql.replace(/\n/g, '\n  ') : '…'}` : 'Add a layer to build a query.'}</pre>
          </div>
          <aside className="value-sampler">
            <div className="dialog-section-title">Unique values{active?.field ? ` · ${active.field}` : ''}</div>
            <div className="value-list">
              {sampler.values.map((value) => (
                <button key={value} title={`Use ${value}`} onClick={() => active && update(active.id, { value })}>{value}</button>
              ))}
              {!sampler.values.length && <span>{layer ? 'This field has no values.' : 'No layer selected.'}</span>}
            </div>
            <small>{sampler.values.length ? `${sampler.values.length}${sampler.truncated ? '+' : ''} values · ${layer && active && isNumericField(layer, active.field) ? 'numeric field' : 'text field'} · click to use` : ''}</small>
          </aside>
        </div>
        <footer className="modal-footer">
          <span className={`dialog-outcome ${outcome?.kind ?? ''}`}>{outcome?.text ?? `${usableClauses(clauses).length} condition${usableClauses(clauses).length === 1 ? '' : 's'} · ${(selections[layerId]?.length ?? 0).toLocaleString('en-US')} currently selected`}</span>
          <div className="dialog-buttons">
            <button className="phase-secondary-button" disabled={!layer} onClick={apply}>Apply</button>
            <button className="phase-primary-button" disabled={!layer} onClick={() => { if (apply()) onClose() }}>OK</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export function SelectByLocationDialog({ layers, initialLayerId, selections, onApply, onClose }: DialogProps) {
  const fadeRef = useFadeExit<HTMLDivElement>()
  useEscape(onClose)
  useRestoreFocus()
  const [targetId, setTargetId] = useState(initialLayerId && layers.some((layer) => layer.id === initialLayerId) ? initialLayerId : layers[0]?.id ?? '')
  const [sourceId, setSourceId] = useState(layers.find((layer) => layer.id !== targetId)?.id ?? layers[0]?.id ?? '')
  const [relationship, setRelationship] = useState<SpatialRelationship>('intersect')
  const [distance, setDistance] = useState('500')
  const [unit, setUnit] = useState<'m' | 'km'>('m')
  const [selectedSourceOnly, setSelectedSourceOnly] = useState(false)
  const [method, setMethod] = useState<SelectionMethod>('new')
  const [outcome, setOutcome] = useState<Outcome>(null)

  const target = layers.find((layer) => layer.id === targetId)
  const source = layers.find((layer) => layer.id === sourceId)
  const sourceSelection = selections[sourceId] ?? []
  const useSourceSelection = selectedSourceOnly && sourceSelection.length > 0
  const relation = spatialRelationships.find((item) => item.id === relationship)

  const apply = () => {
    if (!target || !source) return false
    try {
      const ids = selectByLocation({
        target,
        source,
        relationship,
        sourceIds: useSourceSelection ? sourceSelection : undefined,
        distance: Number(distance) * (unit === 'km' ? 1000 : 1),
      })
      setOutcome(describe(ids.length, onApply(target.id, ids, method), method, target.name))
      return true
    } catch (error) {
      setOutcome({ kind: 'error', text: error instanceof Error ? error.message : 'The spatial query failed.' })
      return false
    }
  }

  return (
    <div ref={fadeRef} className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal selection-dialog location-dialog" role="dialog" aria-modal="true" aria-label="Select By Location" onKeyDown={trapTabKey}>
        <header className="modal-header">
          <div><SquareDashedMousePointer size={15} /><strong>Select By Location</strong><span>Select by spatial relationship</span></div>
          <button className="subtle-icon" title="Close" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="dialog-body">
          <div className="dialog-main">
            <LayerSelect id="sbl-target" autoFocus label="Select features from (target layer)" layers={layers} value={targetId} onChange={(id) => { setTargetId(id); setOutcome(null) }} />
            <label className="dialog-field" htmlFor="sbl-relationship">
              <span>That</span>
              <select id="sbl-relationship" value={relationship} onChange={(event) => { setRelationship(event.target.value as SpatialRelationship); setOutcome(null) }}>
                {spatialRelationships.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <LayerSelect id="sbl-source" label="Source layer" layers={layers} value={sourceId} onChange={(id) => { setSourceId(id); setOutcome(null) }} />
            {relationship === 'within-distance' && (
              <div className="dialog-grid distance">
                <label className="dialog-field" htmlFor="sbl-distance"><span>Search distance</span>
                  <input id="sbl-distance" type="number" min="0" step="any" value={distance} onChange={(event) => { setDistance(event.target.value); setOutcome(null) }} />
                </label>
                <label className="dialog-field" htmlFor="sbl-unit"><span>Unit</span>
                  <select id="sbl-unit" value={unit} onChange={(event) => setUnit(event.target.value as 'm' | 'km')}><option value="m">Meters</option><option value="km">Kilometers</option></select>
                </label>
              </div>
            )}
            <label className={`layout-check ${sourceSelection.length ? '' : 'disabled'}`}>
              <input type="checkbox" checked={useSourceSelection} disabled={!sourceSelection.length} onChange={(event) => setSelectedSourceOnly(event.target.checked)} />
              <span>Use only the {sourceSelection.length.toLocaleString('en-US')} selected feature{sourceSelection.length === 1 ? '' : 's'} of the source layer</span>
            </label>
            <MethodSelect value={method} onChange={setMethod} />
            <p className="modal-note">{relation?.hint}{targetId === sourceId ? ' The target and source are the same layer, so a feature is never compared with itself.' : ''}</p>
          </div>
        </div>
        <footer className="modal-footer">
          <span className={`dialog-outcome ${outcome?.kind ?? ''}`}>{outcome?.text ?? `${(selections[targetId]?.length ?? 0).toLocaleString('en-US')} currently selected in the target layer`}</span>
          <div className="dialog-buttons">
            <button className="phase-secondary-button" disabled={!target || !source} onClick={apply}>Apply</button>
            <button className="phase-primary-button" disabled={!target || !source} onClick={() => { if (apply()) onClose() }}>OK</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
