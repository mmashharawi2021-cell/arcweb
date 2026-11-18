import { useArcWebStore } from '../store'
import { useEffect, useState } from 'react'
import { toolboxTools } from '../toolboxes/registry'
import { assetInfo, getAsset } from '../storage/assets'
export function CatalogPane({ assetIds, onView, onTool, onAdd, onOffline, offlineBasemapName }: { offlineBasemapName?: string; assetIds: string[]; onView: (kind: '2d'|'layout')=>void; onTool:(id:string)=>void; onAdd:(files:File[])=>void; onOffline:()=>void }) {
  const [search,setSearch]=useState('')
  const [assets,setAssets]=useState<{id:string;name:string;missing:boolean}[]>([])
  const key=assetIds.join('|')
  useEffect(()=>{let alive=true; void Promise.all(key.split('|').filter(Boolean).map(async id=>{try{const info=await assetInfo(id);return {id,name:info?.name??'Source file is no longer stored',missing:!info}}catch{return {id,name:'Source file is no longer stored',missing:true}}})).then(rows=>{if(alive)setAssets(rows)});return()=>{alive=false}},[key])
  const match=(text:string)=>text.toLowerCase().includes(search.toLowerCase())
  return <div className="pro-pane-content"><input aria-label="Search Catalog" placeholder="Search Catalog" value={search} onChange={e=>setSearch(e.target.value)} />
    <h3>Maps</h3>{match('Map')&&<button onClick={()=>onView('2d')}>Map</button>}
    <h3>Layouts</h3>{match('Layout')&&<button onClick={()=>onView('layout')}>Layout</button>}
    <h3>Toolboxes</h3>{[...new Set(toolboxTools.map(tool=>tool.category))].filter(category=>toolboxTools.some(tool=>tool.category===category&&match(tool.name+' '+category))).map(category=><details key={category}><summary>{category}</summary>{toolboxTools.filter(tool=>tool.category===category && match(tool.name+' '+category)).map(tool=><button key={tool.id} onClick={()=>onTool(tool.id)}>{tool.name}</button>)}</details>)}
    <h3>Project files</h3>{assets.filter(asset=>match(asset.name)).map(asset=><div key={asset.id}><bdi>{asset.name}</bdi><button disabled={asset.missing} onClick={()=>void getAsset(asset.id).then(blob=>onAdd([new File([blob],asset.name)])).catch(error=>useArcWebStore.getState().addNotification(error instanceof Error?error.message:'Could not read source file','error'))}>Add To Current Map</button></div>)}
    <h3>Offline basemaps</h3><bdi>{offlineBasemapName??'No offline basemap selected'}</bdi><button onClick={onOffline}>Manage...</button>
  </div>
}
