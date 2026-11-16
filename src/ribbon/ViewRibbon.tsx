import {
  Box, Focus, LayoutTemplate, Layers3, Map as MapIcon, Moon, PanelRight, Sun, Table2,
} from 'lucide-react'
import type { WorkspacePreset } from '../workspaceLayout'

export type ViewMode = '2d' | '3d' | 'layout'
export type ViewPane = 'contents' | 'side' | 'table'

export interface ViewRibbonProps {
  contentsOpen: boolean
  sidePaneOpen: boolean
  tableOpen: boolean
  tableAvailable: boolean
  preset: WorkspacePreset
  mode: ViewMode
  fullCanvas: boolean
  theme: 'dark' | 'light'
  onTogglePane(pane: ViewPane): void
  onPreset(preset: WorkspacePreset): void
  onMode(mode: ViewMode): void
  onToggleFullCanvas(): void
  onToggleTheme(): void
}

const PRESETS: { id: WorkspacePreset; label: string; title: string }[] = [
  { id: 'standard', label: 'Standard', title: 'Standard layout: map with Contents and side pane' },
  { id: 'analysis', label: 'Analysis', title: 'Analysis focus: Geoprocessing pane and attribute table' },
  { id: 'cartography', label: 'Cartography', title: 'Cartography focus: print layout view' },
]

export function ViewRibbon(props: ViewRibbonProps) {
  const { contentsOpen, sidePaneOpen, tableOpen, tableAvailable, preset, mode, fullCanvas, theme } = props
  const active = (on: boolean) => `ribbon-action ${on ? 'tool-selected' : ''}`
  return (
    <>
      <div className="phase-ribbon-actions">
        <button className={active(contentsOpen)} title="Show or hide the Contents pane" onClick={() => props.onTogglePane('contents')}><Layers3 size={17} /><span>Contents</span></button>
        <button className={active(sidePaneOpen)} title="Show or hide the side pane (Symbology, Geoprocessing)" onClick={() => props.onTogglePane('side')}><PanelRight size={17} /><span>Side pane</span></button>
        <button className={active(tableOpen)} title={tableAvailable ? 'Show or hide the attribute table' : 'Select a layer to open its attribute table'} disabled={!tableAvailable} onClick={() => props.onTogglePane('table')}><Table2 size={17} /><span>Table</span></button>
        <div className="group-caption">Windows</div>
      </div>
      <div className="ribbon-separator" />
      <div className="phase-ribbon-actions">
        {PRESETS.map((item) => (
          <button key={item.id} className={active(preset === item.id)} title={item.title} onClick={() => props.onPreset(item.id)}><span>{item.label}</span></button>
        ))}
        <button className={active(fullCanvas)} title="Hide panels and ribbons for a full-canvas map view" onClick={props.onToggleFullCanvas}><Focus size={17} /><span>Full canvas</span></button>
        <div className="group-caption">Workspace</div>
      </div>
      <div className="ribbon-separator" />
      <div className="phase-ribbon-actions">
        <button className={active(mode === '2d')} title="Switch to 2D Map" onClick={() => props.onMode('2d')}><MapIcon size={17} /><span>2D Map</span></button>
        <button className={active(mode === '3d')} title="Switch to 3D Scene; right-drag to rotate and tilt" onClick={() => props.onMode('3d')}><Box size={17} /><span>3D Scene</span></button>
        <button className={active(mode === 'layout')} title="Switch to print layout view" onClick={() => props.onMode('layout')}><LayoutTemplate size={17} /><span>Layout</span></button>
        <div className="group-caption">View</div>
      </div>
      <div className="ribbon-separator" />
      <div className="phase-ribbon-actions">
        <button className="ribbon-action" title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={props.onToggleTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button>
        <div className="group-caption">Display</div>
      </div>
    </>
  )
}
