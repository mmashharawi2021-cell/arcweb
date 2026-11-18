// @vitest-environment happy-dom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { act,createElement,type ReactElement } from 'react'
import { renderComponent } from './helpers/renderComponent'
import { createMapLayer } from '../geo'
import { SymbolPatch } from '../contents/SymbolPatch'
import { LayerPropertiesDialog } from '../contents/LayerPropertiesDialog'
import { MeasureWindow } from '../measure/MeasureWindow'
import { SketchToolbar } from '../editing/SketchToolbar'
import { KeyboardShortcutsDialog } from '../shell/KeyboardShortcutsDialog'
import { CommandSearch } from '../shell/CommandSearch'
const cleanups:(()=>void)[]=[]
function mount(element:ReactElement){const view=renderComponent(element);cleanups.push(view.unmount);return view}
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();document.body.innerHTML=''})
function input(selector:string,value:string){const control=document.querySelector(selector) as HTMLInputElement;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(control,value);control.dispatchEvent(new Event('input',{bubbles:true}))})}
describe('Pro component acceptance',()=>{
 it('draws a dashed line symbol',()=>{const layer={...createMapLayer('Roads',{type:'FeatureCollection',features:[]}),geometry:'Line' as const,strokeDash:'dashed' as const};mount(createElement(SymbolPatch,{layer}));expect(document.querySelector('path')!.getAttribute('stroke-dasharray')).toBe('5 3')})
 it('Layer Properties applies a name and a field alias',()=>{const layer=createMapLayer('Old',{type:'FeatureCollection',features:[{type:'Feature',properties:{value:1},geometry:{type:'Point',coordinates:[0,0]}}]});const onUpdate=vi.fn();mount(createElement(LayerPropertiesDialog,{layer,onUpdate,onClose:vi.fn()}));input('input:not([type=checkbox])','Renamed');input('[aria-label="Alias value"]','Population');act(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Apply')!.click());expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({name:'Renamed',fieldAliases:{value:'Population'}}))})
 it('Measure units rerender existing segments without new clicks',()=>{const onUnits=vi.fn();const props={mode:'distance' as const,points:[[0,0],[0,1]] as [number,number][],feature:null,units:'metric' as const,onUnits,onMode:vi.fn(),onClear:vi.fn(),onClose:vi.fn()};const view=mount(createElement(MeasureWindow,props));expect(document.body.textContent).toContain('Segment 1');view.rerender(createElement(MeasureWindow,{...props,units:'imperial'}));expect(document.body.textContent).toContain('mi')})
 it('Sketch toolbar prevents an early Finish and routes Undo',()=>{const onUndo=vi.fn();mount(createElement(SketchToolbar,{mode:'draw-polygon',vertexCount:2,onFinish:vi.fn(),onUndo,onCancel:vi.fn()}));const buttons=[...document.querySelectorAll('button')];expect(buttons.find(button=>button.textContent?.startsWith('Finish'))!.disabled).toBe(true);act(()=>buttons.find(button=>button.textContent==='Undo vertex')!.click());expect(onUndo).toHaveBeenCalledOnce();expect(document.querySelector('[aria-live=polite]')!.textContent).toContain('2')})
 it('Help lists every promised shortcut',()=>{mount(createElement(KeyboardShortcutsDialog,{onClose:vi.fn()}));for(const key of ['Ctrl+S','Ctrl+O','Alt+Q','F2','Esc','Ctrl+Z','Ctrl+Y'])expect(document.body.textContent).toContain(key)})
 it('Command search focuses its input and Enter runs the highlighted command',()=>{const run=vi.fn(),onClose=vi.fn();mount(createElement(CommandSearch,{commands:[{id:'one',label:'Select By Location',run}],onClose}));expect(document.activeElement?.getAttribute('aria-label')).toBe('Search commands');act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));expect(run).toHaveBeenCalledOnce();expect(onClose).toHaveBeenCalledOnce()})
})
