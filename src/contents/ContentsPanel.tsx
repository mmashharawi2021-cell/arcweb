import { useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowDown, ArrowUp, ChevronDown, Database, Eye, EyeOff, Globe2, Layers3, LocateFixed, Move, Plus, Search,
  Settings2, Table2, X,
} from 'lucide-react'
import { useArcWebStore, type MapLayer } from '../store'
import { ContentsRendererLegend, LayerIcon } from './ContentsLegend'

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
  onToggleFloat, onAddData, onOpenMapProperties, onMapRootMenu, onLayerMenu, onZoomToLayer, onRemoveLayer,
}: ContentsPanelProps) {
  const [layerSearch, setLayerSearch] = useState('')
  const filteredLayers = useMemo(() => layers.filter((layer) => layer.name.toLowerCase().includes(layerSearch.toLowerCase())), [layers, layerSearch])
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
        {filteredLayers.map((layer) => {
          const layerIndex = layers.findIndex((item) => item.id === layer.id)
          const selected = selectedLayerId === layer.id
          return (
            <div key={layer.id} data-layer-id={layer.id} className={`layer-row ${selected ? 'selected' : ''} ${menuLayerId === layer.id ? 'menu-open' : ''}`} onClick={() => useArcWebStore.getState().setSelectedLayer(layer.id)} onContextMenu={(event) => onLayerMenu(event, layer.id)}>
              <div className="layer-main">
                <button className={`visibility-button ${layer.visible ? '' : 'hidden-layer'}`} title={layer.visible ? 'Hide layer' : 'Show layer'} onClick={(event) => {
                  event.stopPropagation()
                  useArcWebStore.getState().updateLayer(layer.id, { visible: !layer.visible })
                }}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                <span className={`geometry-icon geometry-${layer.geometry.toLowerCase()}`} title={layer.geometry === 'Unknown' ? 'Standalone table' : `${layer.geometry} geometry`}><LayerIcon geometry={layer.geometry} /></span>
                <button className="layer-name-button" dir="auto" title={layer.name} onClick={(event) => {
                  event.stopPropagation()
                  useArcWebStore.getState().setSelectedLayer(layer.id)
                }}>{layer.name}</button>
                <div className="layer-actions">
                  <button title="Move layer up" disabled={layerIndex === 0} onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().moveLayer(layer.id, -1) }}><ArrowUp size={12} /></button>
                  <button title="Move layer down" disabled={layerIndex === layers.length - 1} onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().moveLayer(layer.id, 1) }}><ArrowDown size={12} /></button>
                  <button title="Zoom to layer" disabled={layer.geometry === 'Unknown'} onClick={(event) => { event.stopPropagation(); onZoomToLayer(layer) }}><LocateFixed size={12} /></button>
                  <button title="Open attribute table" onClick={(event) => { event.stopPropagation(); useArcWebStore.getState().setSelectedLayer(layer.id); useArcWebStore.getState().setTableOpen(true) }}><Table2 size={12} /></button>
                  <button title="Remove layer" onClick={(event) => { event.stopPropagation(); onRemoveLayer(layer.id) }}><X size={13} /></button>
                </div>
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
