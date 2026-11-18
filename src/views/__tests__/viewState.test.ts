import { describe,expect,it } from 'vitest'
import {openView,closeView} from '../viewState'
describe('document views',()=>{it('deduplicates views and never closes Map',()=>{const views=openView([{kind:'map'}],'scene');expect(openView(views,'scene')).toBe(views);expect(closeView(views,'map').views).toBe(views);expect(closeView(views,'scene').next).toBe('map')})})
