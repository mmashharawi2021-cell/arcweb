// @vitest-environment happy-dom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { act,createElement } from 'react'
import { renderComponent } from '../../__tests__/helpers/renderComponent'
import { DockArea } from '../DockArea'
import { defaultPaneLayout } from '../paneLayout'
import { useArcWebStore } from '../../store'
afterEach(()=>{document.body.innerHTML=''})
describe('independent docks',()=>{
 it('has bottom tabs, leaves the pane unchanged when a ribbon tab changes and ignores Escape',()=>{
  const onChange=vi.fn(),layout=defaultPaneLayout();layout.active.right='symbology'
  renderComponent(createElement(DockArea,{side:'right',layout,onChange,panes:{symbology:{title:'Symbology',render:()=>createElement('p',null,'Symbols remain')},catalog:{title:'Catalog',render:()=>createElement('p',null,'Catalog')}}}))
  act(()=>useArcWebStore.getState().setActiveTab('Analysis'))
  expect(document.body.textContent).toContain('Symbols remain')
  expect(document.querySelector('.pro-pane-tabs [role="tab"]')).not.toBeNull()
  act(()=>document.querySelector('.pro-pane')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(onChange).not.toHaveBeenCalled()
  act(()=>(document.querySelector('[aria-label="Close Symbology"]') as HTMLButtonElement).click())
  expect(onChange.mock.calls[0][0].active.right).toBe('catalog')
 })
})
