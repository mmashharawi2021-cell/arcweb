import { contentsSections, type ContentsMode } from './contentsModes'
import { SymbolPatch } from './SymbolPatch'
import { useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  ChevronDown, Database, Eye, EyeOff, Globe2, Layers3, Magnet, Move, MousePointer2, Pencil, Plus, Search,
  Settings2, Table2,
} from 'lucide-react'
import { useArcWebStore, type MapLayer } from '../store'
import { ContentsRendererLegend } from './ContentsLegend'

interface ContentsPanelProps {
  layers: MapLayer[]
  selectedLayerId: string | null
  /** Layer whose right-click menu is open, highlighted in the list. */
  menuLayerId: string | null
  crsCode: string
  minimized: boolean
  floating: boolean
  onToggleFloat: () => void
  onAddData: () => void
  onOpenMapProperties: () => void
  onMapRootMenu: (x: number, y: number) => void
  onLayerMenu: (event: ReactMouseEvent<HTMLElement>, layerId: string) => void
  onZoomToLayer: (layer: MapLayer) => void
  onRemoveLayer: (layerId: string) => void
}

/** The Contents pane: drawing-order layer list with visibility, ordering and quick actions. */
export default function ContentsPanel({
  layers, selectedLayerId, menuLayerId, crsCode, minimized, floating,
  onToggleFloat, onAddData, onOpenMapProperties, onMapRootMenu, onLayerMenu,
}: ContentsPanelProps) {
  const [mode,setMode]=useState<ContentsMode>('drawing')
  const selections=useArcWebStore(state=>state.selections),snapshots=useArcWebStore(state=>state.editSnapshots)
  const [layerSearch, setLayerSearch] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const filteredLayers = useMemo(() => layers.filter((layer) => layer.name.toLowerCase().includes(layerSearch.toLowerCase())), [layers, layerSearch])
  const spatialLayers = useMemo(() => filteredLayers.filter((l) => l.geometry !== 'Unknown'), [filteredLayers])
  const standaloneTables = useMemo(() => filteredLayers.filter((l) => l.geometry === 'Unknown'), [filteredLayers])
  const sections=contentsSections(mode,spatialLayers,selections,snapshots)
  const listedLayers=sections.flatMap(section=>section.layers)

  const startRename = (layer: MapLayer) => {
    setRenamingId(layer.id)
    setRenameValue(layer.name)
    setTimeout(() => renameInputRef.current?.select(), 0)
  }
  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      useArcWebStore.getState().updateLayer(renamingId, { name: renameValue.trim() })
    }
    setRenamingId(null)
  }
  return (
    <aside className={`dock contents-dock ${minimized ? 'contents-minimized' : ''}`}>
      <div className="dock-heading">
        <div><Layers3 size={16} /><strong>Contents</strong><span className="layer-count">{layers.length}</span></div>
        <div className="dock-heading-actions">
          <button className="panel-float-toggle" title={floating ? 'Dock Contents panel' : 'Float Contents panel'} aria-label={floating ? 'Dock Contents panel' : 'Float Contents panel'} onClick={onToggleFloat}><Move size={13} /><span>{floating ? 'Dock' : 'Float'}</span></button>
          <button className="subtle-icon contents-collapse-toggle" title={minimized ? 'Expand Contents panel' : 'Minimize Contents panel'} aria-label={minimized ? 'Expand Contents panel' : 'Minimize Contents panel'} onClick={() => {
            const state = useArcWebStore.getState()
            state.setWorkspaceLayout({ ...state.workspaceLayout, contentsMinimized: !state.workspaceLayout.contentsMinimized })
          }}><ChevronDown size={14} /></button>
          <button className="subtle-icon" title="Add data" aria-label="Add data" onClick={onAddData}><Plus size={16} /></button>
        </div>
      </div>
      <div className="contents-modes" role="toolbar" aria-label="List By">
        {([
          ['drawing','List By Drawing Order',Layers3],
          ['source','List By Data Source',Database],
          ['visibility','List By Visibility',Eye],
          ['selection','List By Selection',MousePointer2],
          ['editing','List By Editing',Pencil],
          ['snapping','List By Snapping',Magnet],
        ] as const).map(([value,title,Icon])=>
          <button key={value} aria-pressed={mode===value} title={title} onClick={()=>setMode(value)}><Icon size={14}/></button>
        )}
      </div>
      <div className="pane-subtitle">Drawing order <span>Top layers draw first</span></div>
      {layers.length > 0 && <label className="layer-search"><Search size={14} /><input placeholder="Find a layer" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} /><span>⌘F</span></label>}
      <div className="layer-list">
        <div className={`map-root-row ${selectedLayerId ? '' : 'selected'}`} title="Click to select the map (clears the layer selection); right-click for map options" onClick={() => useArcWebStore.getState().setSelectedLayer(null)} onDoubleClick={onOpenMapProperties} onContextMenu={(event) => {
          event.preventDefault()
          onMapRootMenu(event.clientX, event.clientY)
        }}>
          <Globe2 size={14} /><strong>Map</strong><span>{crsCode}</span>
          <button title="Map properties" onClick={onOpenMapProperties}><Settings2 size={12} /></button>
        </div>
        {listedLayers.map((layer) => {
          const layerIndex = layers.findIndex((item) => item.id === layer.id)
          const selected = selectedLayerId === layer.id
          return (
            <div key={layer.id} data-layer-id={layer.id} tabIndex={0} draggable={mode==='drawing'} onDragStart={e=>e.dataTransfer.setData('text/arcweb-layer',layer.id)} onDragOver={e=>{if(mode==='drawing')e.preventDefault()}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/arcweb-layer');if(id&&mode==='drawing')useArcWebStore.getState().moveLayerTo(id,layerIndex)}} onKeyDown={e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();useArcWebStore.getState().moveLayer(layer.id,e.key==='ArrowUp'?-1:1)}if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();e.currentTarget.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:rect.left+20,clientY:rect.top+20}))}}} className={`layer-row ${selected ? 'selected' : ''} ${menuLayerId === layer.id ? 'menu-open' : ''}`} onClick={() => useArcWebStore.getState().setSelectedLayer(layer.id)} onContextMenu={(event) => onLayerMenu(event, layer.id)}>
              {mode!=='drawing'&&sections.some(section=>section.layers[0]?.id===layer.id)&&<div className="contents-section-label">{sections.find(section=>section.layers.includes(layer))?.label}</div>}
              <div className="layer-main">
                <button className={`visibility-button ${layer.visible ? '' : 'hidden-layer'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={(event) => {
                  event.stopPropagation()
                  useArcWebStore.getState().updateLayer(layer.id, { visible: !layer.visible })
                }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <span className={`geometry-icon geometry-${layer.geometry.toLowerCase()}`} title={layer.geometry === 'Unknown' ? 'Standalone table' : `${layer.geometry} geometry`}><SymbolPatch layer={layer} /></span>
                {renamingId === layer.id ? (
                  <input
                    ref={renameInputRef}
                    className="layer-name-input"
                    value={renameValue}
                    dir="auto"
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button className="layer-name-button" dir="auto" title={`${layer.name} (double-click to rename)`}
                    onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().setSelectedLayer(layer.id) }}
                    onDoubleClick={(event) => { event.stopPropagation(); startRename(layer) }}>
                    <bdi>{layer.name}</bdi>
                  </button>
                )}
              </div>
              {selected && (
                <div className="layer-opacity" onClick={(event) => event.stopPropagation()}>
                  <span>Opacity</span><input aria-label={`${layer.name} opacity`} type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={(event) => useArcWebStore.getState().updateLayer(layer.id, { opacity: Number(event.target.value) })} /><span>{Math.round(layer.opacity * 100)}%</span>
                </div>
              )}
              {selected && <ContentsRendererLegend layer={layer} />}
            </div>
          )
        })}
        {standaloneTables.length > 0 && (
          <div className="standalone-tables-section">
            <div className="standalone-tables-heading"><Table2 size={13} /><span>Standalone Tables</span></div>
            {standaloneTables.map((layer) => {
              const selected = selectedLayerId === layer.id
              return (
                <div key={layer.id} className={`layer-row standalone-table-row ${selected ? 'selected' : ''} ${menuLayerId === layer.id ? 'menu-open' : ''}`}
                  tabIndex={0} onClick={() => useArcWebStore.getState().setSelectedLayer(layer.id)} onContextMenu={(event) => onLayerMenu(event, layer.id)}>
                  <div className="layer-main">
                    <Table2 size={14} className="standalone-table-icon" />
                    {renamingId === layer.id ? (
                      <input ref={renameInputRef} className="layer-name-input" value={renameValue} dir="auto"
                        onChange={(e) => setRenameValue(e.target.value)} onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                        onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <button className="layer-name-button" dir="auto" title={`${layer.name} (double-click to rename)`}
                        onClick={(e) => { e.stopPropagation(); useArcWebStore.getState().setSelectedLayer(layer.id) }}
                        onDoubleClick={(e) => { e.stopPropagation(); startRename(layer) }}>
                        <bdi>{layer.name}</bdi>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {layers.length === 0 && (
          <button className="empty-layers" onClick={onAddData}>
            <div className="empty-glyph"><Database size={20} /></div>
            <strong>Your map is ready</strong>
            <span>Add a dataset to start exploring spatial data.</span>
            <em><Plus size={13} /> Add data</em>
          </button>
        )}
        {layers.length > 0 && filteredLayers.length === 0 && <div className="no-results">No matching layers found.</div>}
      </div>
      <div className="contents-footer"><span><span className="status-dot" />{layers.length ? `${layers.length} layer${layers.length === 1 ? '' : 's'} in map` : 'No layers yet'}</span><button title="Map properties" onClick={onOpenMapProperties}><Settings2 size={14} /></button></div>
    </aside>
  )
}
