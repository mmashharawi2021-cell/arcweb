import {describe,expect,it} from 'vitest'
import {measurePoints,measureGeometry,formatLength,formatArea} from '../measure'
describe('geodesic measurements',()=>{
 it('returns segments and their total in meters',()=>{const result=measurePoints([[0,0],[0,1],[1,1]]);expect(result.segments).toHaveLength(2);expect(result.total).toBeGreaterThan(220000);expect(result.total).toBeLessThan(223000)})
 it('measures polygon area and perimeter, including a closing side',()=>{const geometry={type:'Polygon' as const,coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};const result=measureGeometry(geometry);expect(result.area).toBeGreaterThan(1e10);expect(result.total).toBeGreaterThan(440000)})
 it('supports metric, imperial and nautical conversions',()=>{expect(formatLength(1852,'nautical')).toContain('1.000 NM');expect(formatLength(1609.344,'imperial')).toContain('1.000 mi');expect(formatArea(1e6,'metric')).toContain('1.0000')})
})
