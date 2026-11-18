// @vitest-environment happy-dom
import { afterEach,describe,expect,it,vi } from 'vitest'
import { act,createElement } from 'react'
import { CatalogPane } from '../CatalogPane'
import { renderComponent } from '../../__tests__/helpers/renderComponent'
const assets=vi.hoisted(()=>({info:vi.fn(),get:vi.fn()}))
vi.mock('../../storage/assets',()=>({assetInfo:assets.info,getAsset:assets.get}))
afterEach(()=>{document.body.innerHTML='';vi.clearAllMocks()})
describe('Catalog assets and search',()=>{
 it('reimports a stored source with its original name and disables missing sources',async()=>{
  assets.info.mockImplementation(async(id:string)=>id==='ok'?{name:'original.geojson'}:undefined);assets.get.mockResolvedValue(new Blob(['{}'],{type:'application/json'}));const onAdd=vi.fn()
  const view=renderComponent(createElement(CatalogPane,{assetIds:['ok','missing'],onView:vi.fn(),onTool:vi.fn(),onAdd,onOffline:vi.fn()}))
  await act(async()=>{})
  const buttons=[...document.querySelectorAll('button')].filter(button=>button.textContent==='Add To Current Map')
  expect(buttons).toHaveLength(2);expect(buttons[1].disabled).toBe(true);expect(document.body.textContent).toContain('Source file is no longer stored')
  await act(async()=>{buttons[0].click()});expect(onAdd.mock.calls[0][0][0].name).toBe('original.geojson')
  view.unmount()
 })
})
