import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Calculator, Check, Eraser, Filter, FilterX, GripHorizontal, ListFilter, Move, Pencil, Plus, Redo2, ScanSearch, Search, SquareStack, Trash2, Undo2, X } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Feature } from 'geojson'
import type { FeatureId, MapLayer, TableView } from './store'
import { coerceCellInput, parseColumnFilter, queryTableRows } from './table/tableQuery'

const rowHeight = 34

interface AttributeTableProps {
  layer: MapLayer
  selectedFeatureId: string | number | null
  /** The layer's selection set (Select By Attributes / Location, Ctrl+click). */
  selectedIds: ReadonlySet<FeatureId>
  height: number
  floating: boolean
  onToggleFloat: () => void
  onToggleSelection: (feature: Feature) => void
  onSelectByAttributes: () => void
  onZoomToSelected: () => void
  onClearSelection: () => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onClose: () => void
  onSelectFeature: (feature: Feature) => void
  onDeleteFeature: (featureId: string | number) => void
  onAddField: (name: string) => void
  onRemoveField: (name: string) => void
  onCalculate: (name: string, expression: string) => void
  /** Sort and column filters, kept in the store so they survive closing the table and saving the project. */
  view: TableView
  onViewChange: (view: Partial<TableView>) => void
  /** Whether cells can be edited in place (vector layers; raster cells are read-only). */
  editable: boolean
  onEditCell: (featureId: FeatureId, field: string, value: unknown) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

function fieldKeys(layer: MapLayer) {
  const keys = new Set<string>(layer.customFields ?? [])
  for (const feature of layer.data.features) {
    Object.keys(feature.properties ?? {}).forEach((key) => keys.add(key))
  }
  return [...keys]
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function AttributeTable({
  layer, selectedFeatureId, selectedIds, height, floating, onToggleFloat, onResizePointerDown, onClose, onSelectFeature,
  onDeleteFeature, onAddField, onRemoveField, onCalculate, onToggleSelection, onSelectByAttributes,
  onZoomToSelected, onClearSelection, view, onViewChange, editable, onEditCell, canUndo, canRedo, onUndo, onRedo,
}: AttributeTableProps) {
  const [selectedOnly, setSelectedOnly] = useState(false)
  // "Show selected records" only makes sense while something is selected.
  const showSelectedOnly = selectedOnly && selectedIds.size > 0
  const hasSelection = selectedIds.size > 0 || selectedFeatureId !== null
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [search, setSearch] = useState('')
  const sort = view.sort
  const activeFilterCount = Object.values(view.filters).filter((text) => text.trim()).length
  const [filtersOpen, setFiltersOpen] = useState(activeFilterCount > 0)
  const [editing, setEditing] = useState<{ featureId: FeatureId; field: string; draft: string; error: string | null } | null>(null)
  const [fieldName, setFieldName] = useState('')
  const [showAddField, setShowAddField] = useState(false)
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calculationName, setCalculationName] = useState('')
  const [expression, setExpression] = useState('')
  const deferredSearch = useDeferredValue(search)
  const fields = useMemo(() => fieldKeys(layer), [layer])
  const deferredView = useDeferredValue(view)
  const filtered = useMemo(() => queryTableRows(layer.data.features, {
    view: deferredView, search: deferredSearch, fields, onlyIds: showSelectedOnly ? selectedIds : null,
  }), [deferredSearch, deferredView, fields, layer.data.features, showSelectedOnly, selectedIds])
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 6)
  const count = Math.ceil(Math.max(100, height - 122) / rowHeight) + 13
  const visibleRows = filtered.slice(start, start + count)
  const gridTemplateColumns = `56px ${fields.map(() => 'minmax(120px, 1fr)').join(' ')} 94px`

  useEffect(() => {
    if (selectedFeatureId === null) return
    const index = filtered.findIndex(({ feature }) => feature.id === selectedFeatureId)
    if (index >= 0 && listRef.current) {
      const target = index * rowHeight
      listRef.current.scrollTo({ top: target, behavior: 'smooth' })
      setScrollTop(target)
    }
  }, [selectedFeatureId, filtered])

  const submitField = () => {
    const name = fieldName.trim()
    if (!name) return
    onAddField(name)
    setFieldName('')
    setShowAddField(false)
  }

  const submitCalculation = () => {
    onCalculate(calculationName, expression)
    setCalculatorOpen(false)
  }

  // Click cycles ascending → descending → unsorted, like ArcGIS Pro's column header.
  const toggleSort = (field: string) => {
    onViewChange({ sort: sort?.field !== field ? { field, direction: 1 } : sort.direction === 1 ? { field, direction: -1 } : null })
  }

  const setFilter = (field: string, text: string) => {
    const filters = { ...view.filters }
    if (text) filters[field] = text
    else delete filters[field]
    onViewChange({ filters })
  }

  const startEditing = (featureId: FeatureId, field: string, value: unknown) => {
    if (!editable) return
    setEditing({ featureId, field, draft: value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value), error: null })
  }

  const commitEditing = () => {
    if (!editing) return
    const feature = layer.data.features.find((item) => item.id === editing.featureId)
    const previous = feature?.properties?.[editing.field]
    const unchanged = editing.draft === (previous === null || previous === undefined ? '' : String(previous))
    if (!feature || unchanged) {
      setEditing(null)
      return
    }
    const result = coerceCellInput(editing.draft, layer.data.features.map((item) => item.properties?.[editing.field]))
    if ('error' in result) {
      setEditing({ ...editing, error: result.error })
      return
    }
    onEditCell(editing.featureId, editing.field, result.value)
    setEditing(null)
  }

  return (
    <section className={`attribute-table ${floating ? 'table-floating' : ''}`} style={{ height: floating ? '100%' : height }} aria-label={`Attribute table for ${layer.name}`}>
      <div className="table-resize-handle" onPointerDown={onResizePointerDown} title="Drag to resize"><GripHorizontal size={17} /></div>
      <header className="attribute-table-header">
        <div className="table-title"><span className="table-icon">ƒx</span><strong dir="auto">{layer.name}</strong><span>Attribute table</span><span className="table-record-count">{filtered.length.toLocaleString()} / {layer.data.features.length.toLocaleString()} records</span>{selectedIds.size > 0 && <span className="table-selected-count">{selectedIds.size.toLocaleString()} selected</span>}</div>
        <div className="table-header-actions">
          <div className="table-selection-tools" role="group" aria-label="Selection">
            <button className="table-action" title="Select By Attributes" onClick={onSelectByAttributes}><ListFilter size={14} />Select</button>
            <button className={`table-action icon-only ${showSelectedOnly ? 'active' : ''}`} title={showSelectedOnly ? 'Show all records' : 'Show selected records only'} disabled={!selectedIds.size} onClick={() => setSelectedOnly((value) => !value)}><SquareStack size={14} /></button>
            <button className="table-action icon-only" title="Zoom to selected" disabled={!hasSelection} onClick={onZoomToSelected}><ScanSearch size={14} /></button>
            <button className="table-action icon-only" title="Clear selection" disabled={!hasSelection} onClick={onClearSelection}><Eraser size={14} /></button>
          </div>
          <div className="table-selection-tools" role="group" aria-label="Edit history">
            <button className="table-action icon-only" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Undo2 size={14} /></button>
            <button className="table-action icon-only" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}><Redo2 size={14} /></button>
          </div>
          <button className={`table-action ${filtersOpen ? 'active' : ''}`} title="Filter individual columns (text, =, !=, >, <, a..b, null)" onClick={() => setFiltersOpen((open) => !open)}><Filter size={14} />Columns{activeFilterCount > 0 && <span className="table-filter-count">{activeFilterCount}</span>}</button>
          <label className="table-search"><Search size={13} /><input dir="auto" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter records" aria-label="Filter records" /><kbd>⌕</kbd></label>
          <button className={`table-action ${calculatorOpen ? 'active' : ''}`} onClick={() => { setCalculatorOpen((open) => !open); setShowAddField(false) }}><Calculator size={14} />Field calculator</button>
          <button className={`table-action ${showAddField ? 'active' : ''}`} onClick={() => { setShowAddField((show) => !show); setCalculatorOpen(false) }}><Plus size={14} />Add field</button>
          <button className="table-action icon-only" title={floating ? 'Dock Attribute Table' : 'Float Attribute Table'} aria-label={floating ? 'Dock Attribute Table' : 'Float Attribute Table'} onClick={onToggleFloat}><Move size={14} /></button>
          <button className="table-close" title="Close attribute table" onClick={onClose}><X size={15} /></button>
        </div>
      </header>
      {(showAddField || calculatorOpen) && (
        <div className="table-form">
          {showAddField ? (
            <>
              <span className="table-form-label">New field</span>
              <input value={fieldName} onChange={(event) => setFieldName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitField() }} placeholder="Field name" aria-label="New field name" />
              <span className="table-form-hint">Blank text values are added to each feature.</span>
              <button className="table-form-submit" onClick={submitField}><Check size={13} />Create field</button>
            </>
          ) : (
            <>
              <span className="table-form-label">Calculate field</span>
              <input value={calculationName} onChange={(event) => setCalculationName(event.target.value)} placeholder="Output field" aria-label="Calculated field name" />
              <input className="calculator-expression" value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitCalculation() }} placeholder={'Expression: [population] / [area] or [first] + " " + [last]'} aria-label="Field calculation expression" />
              <button className="table-form-submit" onClick={submitCalculation}><Check size={13} />Calculate</button>
            </>
          )}
        </div>
      )}
      <div className="attribute-table-column-head" style={{ gridTemplateColumns }}>
        <span className="row-index-head">FID</span>
        {fields.map((field) => (
          <div className="table-column" key={field}>
              <button onClick={() => toggleSort(field)} title={`Sort by ${layer.fieldAliases?.[field] ? `${layer.fieldAliases[field]} (${field})` : field} (click again to reverse, a third time to clear)`}>
                <span>{layer.fieldAliases?.[field] || field}</span>
              {sort?.field === field && (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
            </button>
            {layer.customFields?.includes(field) && <span className="custom-field-tools"><button title={`Delete ${field} field`} onClick={() => onRemoveField(field)}><X size={11} /></button></span>}
          </div>
        ))}
        <span className="row-action-head">Actions</span>
      </div>
      {filtersOpen && (
        <div className="attribute-table-filter-row" style={{ gridTemplateColumns }}>
          <span className="row-index-head"><Filter size={11} /></span>
          {fields.map((field) => {
            const text = view.filters[field] ?? ''
            const parsed = parseColumnFilter(text)
            const invalid = text.trim() !== '' && !parsed
            return (
              <input
                key={field}
                dir="auto"
                className={`table-filter-input ${text.trim() ? 'active' : ''} ${invalid ? 'invalid' : ''}`}
                value={text}
                placeholder="Filter…"
                aria-label={`Filter ${field}`}
                title={invalid ? 'Comparisons like > and < need a number' : parsed ? `${field} ${parsed.description}` : 'text · =value · !=value · >10 · <=5 · 10..20 · null · !null'}
                onChange={(event) => setFilter(field, event.target.value)}
              />
            )
          })}
          <span className="row-actions">
            <button title="Clear column filters" disabled={!activeFilterCount} onClick={() => onViewChange({ filters: {} })}><FilterX size={12} /></button>
          </span>
        </div>
      )}
      <div className="attribute-table-scroll" ref={listRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="attribute-table-spacer" style={{ height: filtered.length * rowHeight, minWidth: '100%' }}>
          {visibleRows.map(({ feature, index }, rowIndex) => {
            const featureId = feature.id ?? `${layer.id}:${index}`
            const selected = featureId === selectedFeatureId
            return (
              <div
                className={`attribute-table-row ${selected ? 'selected' : ''} ${selectedIds.has(featureId) ? 'in-selection' : ''}`}
                style={{ gridTemplateColumns, top: (start + rowIndex) * rowHeight }}
                key={`${String(featureId)}-${index}`}
                role="row"
                aria-selected={selected || selectedIds.has(featureId)}
                onClick={(event) => event.ctrlKey || event.metaKey || event.shiftKey ? onToggleSelection(feature) : onSelectFeature(feature)}
                title="Click to zoom to the feature · Ctrl+click to add or remove it from the selection"
              >
                <span className="row-index">{index + 1}</span>
                {fields.map((field) => editing && editing.featureId === featureId && editing.field === field ? (
                  <span className="table-cell editing" key={field} onClick={(event) => event.stopPropagation()}>
                    <input
                      autoFocus
                      dir="auto"
                      className={editing.error ? 'invalid' : ''}
                      value={editing.draft}
                      title={editing.error ?? 'Enter to save · Esc to cancel'}
                      aria-label={`Edit ${field}`}
                      aria-invalid={Boolean(editing.error)}
                      onChange={(event) => setEditing({ ...editing, draft: event.target.value, error: null })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitEditing()
                        else if (event.key === 'Escape') setEditing(null)
                      }}
                      onBlur={commitEditing}
                    />
                    {editing.error && <span className="table-cell-error" role="alert">{editing.error}</span>}
                  </span>
                ) : (
                  <span
                    dir="auto"
                    className={`table-cell ${editable ? 'editable' : ''}`}
                    key={field}
                    title={editable ? `${cellValue(feature.properties?.[field])}\n(double-click to edit)` : cellValue(feature.properties?.[field])}
                    onDoubleClick={(event) => { event.stopPropagation(); startEditing(featureId, field, feature.properties?.[field]) }}
                  >{cellValue(feature.properties?.[field])}</span>
                ))}
                <span className="row-actions">
                  <button title="Delete feature" onClick={(event) => { event.stopPropagation(); onDeleteFeature(featureId) }}><Trash2 size={12} /></button>
                </span>
              </div>
            )
          })}
        </div>
        {filtered.length === 0 && <div className="table-no-records">{layer.data.features.length ? showSelectedOnly ? 'No selected records match this filter.' : 'No records match this filter.' : 'This layer has no features yet.'}</div>}
      </div>
      <footer className="attribute-table-footer">
        <span>{fields.length} fields</span><span>{filtered.length.toLocaleString()} matching records</span>
        {sort && <span className="table-footer-sort">Sorted by {layer.fieldAliases?.[sort.field] || sort.field} {sort.direction === 1 ? '↑' : '↓'}</span>}
        {editable && <span className="table-footer-edit"><Pencil size={10} />Double-click a cell to edit</span>}
        <span className="table-footer-spacer" />
        <button onClick={() => { setSearch(''); onViewChange({ filters: {} }) }} disabled={!search && !activeFilterCount}>Clear filters</button>
      </footer>
    </section>
  )
}
