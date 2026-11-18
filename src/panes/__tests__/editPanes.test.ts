// @vitest-environment happy-dom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { act,createElement } from 'react'
import { CreateFeaturesPane } from '../CreateFeaturesPane'
import { AttributesPane } from '../AttributesPane'
import { renderComponent } from '../../__tests__/helpers/renderComponent'
import { createMapLayer } from '../../geo'
import { useArcWebStore } from '../../store'
const layer=()=>({...createMapLayer('Parcels',{type:'FeatureCollection',features:[{type:'Feature',id:'a',properties:{value:1},geometry:{type:'Point',coordinates:[0,0]}},{type:'Feature',id:'b',properties:{value:2},geometry:{type:'Point',coordinates:[1,1]}}]}),geometry:'Polygon' as const})
afterEach(()=>{document.body.innerHTML=''})
describe('editing panes',()=>{
 it('only lists editable templates and offers Polygon Rectangle Circle',()=>{const polygon=layer(),locked={...polygon,id:'locked',name:'Locked',editable:false};const view=renderComponent(createElement(CreateFeaturesPane,{layers:[polygon,locked],selectedLayer:polygon,selectedFeatureIsEditable:false,tool:'pan',onCreateLayer:vi.fn(),onSetTool:vi.fn(),onDeleteFeature:vi.fn(),onOpenTable:vi.fn(),onFinishSketch:vi.fn()}));expect([...document.querySelectorAll('[aria-label="Construction tools"] button')].map(x=>x.textContent)).toEqual(['Polygon','Rectangle','Circle']);expect(document.body.textContent).not.toContain('Locked');view.unmount()})
 it('edits a selected feature and navigates multiple selected records',()=>{const polygon=layer();useArcWebStore.setState({selections:{[polygon.id]:['a','b']},selectedFeature:null});const onEdit=vi.fn();const view=renderComponent(createElement(AttributesPane,{layers:[polygon],onEdit}));const input=document.querySelector('input')!;act(()=>{input.value='7';input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))});expect(onEdit).toHaveBeenCalledWith(polygon,'a','value',7);act(()=>{[...document.querySelectorAll('button')].find(x=>x.textContent==='Next')!.click()});expect((document.querySelector('input') as HTMLInputElement).value).toBe('2');view.unmount()})
})
