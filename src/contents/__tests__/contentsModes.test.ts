import {describe,expect,it} from 'vitest'
import {contentsSections} from '../contentsModes'
import {createMapLayer} from '../../geo'
describe('Contents sections',()=>{
 it('counts selections without accessing the feature array',()=>{const layer=createMapLayer('Arabic name',{type:'FeatureCollection',features:[]});layer.data=new Proxy(layer.data,{get:(target,key)=>{if(key==='features')throw Error('Do not scan features');return Reflect.get(target,key)}});expect(contentsSections('selection',[layer],{[layer.id]:['a','b']})[0].label).toBe('2 selected')})
 it('groups sources and preserves drawing order',()=>{const a=createMapLayer('A',{type:'FeatureCollection',features:[]}),b={...a,id:'b',name:'B',source:{kind:'file' as const,name:'roads.zip'}};expect(contentsSections('drawing',[a,b],{})[0].layers.map(l=>l.id)).toEqual([a.id,'b']);expect(contentsSections('source',[a,b],{}).map(s=>s.label)).toEqual(['Unknown source','roads.zip'])})
})
