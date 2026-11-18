import { Box, Focus, LayoutTemplate, Layers3, Map as MapIcon, Table2, FolderOpen, Paintbrush, Hammer, Plus, Spline, List } from 'lucide-react'
import type { WorkspacePreset } from '../workspaceLayout'
import type { PaneId } from '../panes/paneLayout'
import { RibbonButton, RibbonGroup, RibbonMenuButton } from './RibbonParts'
import { RibbonGroupBar } from './RibbonGroupBar'
export type ViewMode = '2d' | '3d' | 'layout'
export type ViewPane = 'contents' | 'side' | 'table'
export interface ViewRibbonProps {
  contentsOpen:boolean; sidePaneOpen:boolean; tableOpen:boolean; tableAvailable:boolean; preset:WorkspacePreset; mode:ViewMode; fullCanvas:boolean; theme:'dark'|'light'
  onTogglePane:(pane:ViewPane)=>void; onPreset:(preset:WorkspacePreset)=>void; onMode:(mode:ViewMode)=>void; onToggleFullCanvas:()=>void; onToggleTheme:()=>void; onOpenPane?:(pane:PaneId)=>void
}
export function ViewRibbon(props:ViewRibbonProps) {
  return <RibbonGroupBar>
    <RibbonGroup label="Windows" icon={Layers3}><div className="ribbon-window-grid">
      {([{id:'contents',label:'Contents',icon:Layers3},{id:'catalog',label:'Catalog',icon:FolderOpen},{id:'geoprocessing',label:'Geoprocessing',icon:Hammer},{id:'symbology',label:'Symbology',icon:Paintbrush},{id:'createFeatures',label:'Create Features',icon:Plus},{id:'modifyFeatures',label:'Modify Features',icon:Spline},{id:'attributes',label:'Attributes',icon:List}] as const).map(item=><RibbonButton key={item.id} id={'open-'+item.id} label={item.label} icon={item.icon} size="small" onClick={()=>props.onOpenPane?.(item.id)} />)}
      <RibbonButton id="open-table" label="Attribute Table" icon={Table2} size="small" disabled={!props.tableAvailable} onClick={()=>props.onTogglePane('table')} />
    </div></RibbonGroup>
    <RibbonGroup label="Workspace" icon={Focus}>
      <RibbonMenuButton id="reset-panes" label="Reset Panes" icon={Layers3} size="large" items={(['standard','analysis','cartography'] as const).map(id=>({id,label:id[0].toUpperCase()+id.slice(1),onSelect:()=>props.onPreset(id)}))} />
      <RibbonButton id="full-canvas" label="Full Canvas" icon={Focus} size="large" pressed={props.fullCanvas} onClick={props.onToggleFullCanvas} />
    </RibbonGroup>
    <RibbonGroup label="View" icon={MapIcon}>{([{id:'2d',label:'Map',icon:MapIcon},{id:'3d',label:'Scene',icon:Box},{id:'layout',label:'Layout',icon:LayoutTemplate}] as const).map(item=><RibbonButton key={item.id} id={'view-'+item.id} label={item.label} icon={item.icon} size="large" pressed={props.mode===item.id} onClick={()=>props.onMode(item.id)} />)}</RibbonGroup>
  </RibbonGroupBar>
}
