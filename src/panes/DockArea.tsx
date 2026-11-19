import { PANE_TITLES } from './paneTitles'
import { useState, type ReactNode } from 'react'
import DockablePanel from '../DockablePanel'
import { PANE_IDS, activatePane, closePane, movePane, toggleAutoHide, type PaneId, type PaneLayout } from './paneLayout'

export function DockArea({ side, layout, panes, onChange }: { side: 'left' | 'right'; layout: PaneLayout; panes: Partial<Record<PaneId, { title: string; render(): ReactNode }>>; onChange: (layout: PaneLayout) => void }) {
  const [peek, setPeek] = useState<PaneId | null>(null)
  const ids = PANE_IDS.filter(id => layout.panes[id]?.open && layout.panes[id]?.side === side && panes[id]).sort((a,b)=>(layout.panes[a]?.order ?? 99)-(layout.panes[b]?.order ?? 99))
  const active = peek ?? layout.active[side]
  const panel = (id: PaneId) => <div className="pro-pane"><header><strong>{panes[id]?.title}</strong><button aria-label={'Auto hide ' + PANE_TITLES[id]} aria-pressed={layout.panes[id].autoHide} onClick={()=>onChange(toggleAutoHide(layout,id))}>Pin</button><select aria-label={'Dock ' + PANE_TITLES[id]} value={layout.panes[id].side} onChange={e=>onChange(movePane(layout,id,e.target.value as 'left'|'right'|'float'))}><option value="left">Left</option><option value="right">Right</option><option value="float">Float</option></select><button aria-label={'Close ' + PANE_TITLES[id]} onClick={()=>onChange(closePane(layout,id))}>x</button></header><div className="pro-pane-body">{panes[id]?.render()}</div></div>
  const visible = active && ids.includes(active) && (!layout.panes[active].autoHide || peek === active)
  return <><aside className={'pro-dock pro-dock-' + side} style={{ width: visible ? layout.dockWidth[side] : ids.length ? 30 : 0 }} onMouseLeave={()=>setPeek(null)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setPeek(null)}}>
    {visible && panel(active)}
    <div className={visible ? 'pro-pane-tabs' : 'pro-edge-tabs'} role="tablist" aria-label={side + ' panes'}>{ids.map(id=><button key={id} role="tab" aria-selected={active===id} onFocus={()=>{if(layout.panes[id].autoHide)setPeek(id)}} onMouseEnter={()=>{if(layout.panes[id].autoHide)setPeek(id)}} onClick={()=>{onChange(activatePane(layout,id));setPeek(id)}}>{PANE_TITLES[id]}</button>)}</div>
  </aside>{side === 'right' && PANE_IDS.filter(id=>layout.panes[id]?.open && layout.panes[id]?.side==='float' && panes[id]).map(id=><DockablePanel key={id} floating frame={layout.panes[id]?.frame} onFrameChange={frame=>onChange({...layout,panes:{...layout.panes,[id]:{...layout.panes[id],frame}}})}>{panel(id)}</DockablePanel>)}</>
}
