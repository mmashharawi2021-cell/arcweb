import { useState } from 'react'
import { useArcWebStore, type MapLayer } from '../store'
import { isRasterLayer } from '../ribbon/contextualTabs'
export function AttributesPane({ layers,onEdit }: {layers:MapLayer[];onEdit:(layer:MapLayer,id:string|number,field:string,value:unknown)=>void}) {
  const selections=useArcWebStore(state=>state.selections),selected=useArcWebStore(state=>state.selectedFeature)
  const [index,setIndex]=useState(0)
  const features=layers.flatMap(layer=>(selections[layer.id]??(selected?.layerId===layer.id?[selected.featureId]:[])).flatMap(id=>{const feature=layer.data.features.find(f=>f.id===id);return feature?[{layer,feature}]:[]}))
  const current=features[Math.min(index,features.length-1)]
  return <div className="pro-pane-content"><button disabled={index<=0} onClick={()=>setIndex(i=>i-1)}>Previous</button><span>{features.length?Math.min(index+1,features.length):0} / {features.length}</span><button disabled={index>=features.length-1} onClick={()=>setIndex(i=>i+1)}>Next</button>{current&&Object.entries(current.feature.properties??{}).map(([field,value])=><label key={field}>{field}<input key={current.layer.id+current.feature.id+field} defaultValue={String(value??'')} readOnly={current.layer.editable===false||isRasterLayer(current.layer)} onBlur={e=>{if(e.target.value!==String(value??''))onEdit(current.layer,current.feature.id!,field,typeof value==='number'?Number(e.target.value):e.target.value)}} /></label>)}</div>
}

