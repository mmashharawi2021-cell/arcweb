export type ViewKind = 'map'|'scene'|'layout'
export type ViewRef = { kind: ViewKind }
export function openView(views: ViewRef[], kind: ViewKind): ViewRef[] { return views.some(view=>view.kind===kind)?views:[...views,{kind}] }
export function closeView(views: ViewRef[], kind: ViewKind): {views:ViewRef[];next:ViewKind} { const next=kind==='map'?views:views.filter(view=>view.kind!==kind); return {views:next,next:next.at(-1)?.kind??'map'} }
