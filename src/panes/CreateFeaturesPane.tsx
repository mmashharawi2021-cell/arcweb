import { useState } from 'react'
import { useArcWebStore, type MapLayer, type ToolMode } from '../store'
import { isRasterLayer } from '../ribbon/contextualTabs'
import { SymbolPatch } from '../contents/SymbolPatch'
interface Props {
 layers:MapLayer[];selectedLayer:MapLayer|null;selectedFeatureIsEditable:boolean;tool:ToolMode
 onCreateLayer:(name:string,geometry:'Point'|'Line'|'Polygon',fields:string[])=>void
 onSetTool:(tool:ToolMode)=>void;onDeleteFeature:()=>void;onOpenTable:()=>void;onFinishSketch:()=>void
}
export function CreateFeaturesPane({layers,selectedLayer,tool,onCreateLayer,onSetTool}:Props){
 const [name,setName]=useState(''),[geometry,setGeometry]=useState<'Point'|'Line'|'Polygon'>('Point'),[fields,setFields]=useState('')
 const editable=layers.filter(layer=>layer.editable!==false&&!isRasterLayer(layer))
 const target=selectedLayer&&editable.some(layer=>layer.id===selectedLayer.id)?selectedLayer:null
 const tools: {id:ToolMode;label:string}[]=!target?[]:target.geometry==='Point'?[{id:'draw-point',label:'Point'}]:target.geometry==='Line'?[{id:'draw-line',label:'Line'}]:[{id:'draw-polygon',label:'Polygon'},{id:'draw-rectangle',label:'Rectangle'},{id:'draw-circle',label:'Circle'}]
 return <div className="pro-pane-content"><h3>Templates</h3>{editable.map(layer=><button key={layer.id} aria-pressed={target?.id===layer.id} onClick={()=>{useArcWebStore.getState().setSelectedLayer(layer.id);onSetTool(layer.geometry==='Point'?'draw-point':layer.geometry==='Line'?'draw-line':'draw-polygon')}}><SymbolPatch layer={layer}/><bdi>{layer.name}</bdi> ({layer.geometry})</button>)}
 <div role="toolbar" aria-label="Construction tools">{tools.map(item=><button key={item.id} aria-pressed={tool===item.id} onClick={()=>onSetTool(item.id)}>{item.label}</button>)}</div>
 <hr/><h3>New Layer...</h3><label>Layer name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Geometry<select value={geometry} onChange={e=>setGeometry(e.target.value as typeof geometry)}><option>Point</option><option>Line</option><option>Polygon</option></select></label><label>Fields<input placeholder="name, category, notes" value={fields} onChange={e=>setFields(e.target.value)}/></label><button disabled={!name.trim()} onClick={()=>{onCreateLayer(name.trim(),geometry,[...new Set(fields.split(',').map(value=>value.trim()).filter(Boolean))]);setName('');setFields('')}}>Create layer</button></div>
}
