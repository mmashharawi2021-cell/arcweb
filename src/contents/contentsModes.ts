import type { FeatureId,MapLayer } from '../store'
export type ContentsMode='drawing'|'source'|'visibility'|'selection'|'editing'|'snapping'
export function contentsSections(mode:ContentsMode,layers:MapLayer[],selections:Record<string,FeatureId[]>,snapshots:Record<string,unknown>={}) {
 const groups=new Map<string,MapLayer[]>()
 for(const layer of layers){const key=mode==='source'?layer.source?.name??'Unknown source':mode==='selection'?`${(selections[layer.id]??[]).length} selected`:mode==='editing'?(snapshots[layer.id]!==undefined&&snapshots[layer.id]!==layer.data?'Unsaved edits':layer.editable===false?'Read-only':'Editable'):mode==='snapping'?(layer.snappable===false?'Snapping off':'Snapping on'):mode==='visibility'?(layer.visible?'Visible':'Hidden'):'Drawing order';groups.set(key,[...(groups.get(key)??[]),layer])}
 return [...groups].map(([label,layers])=>({label,layers}))
}
