import { describe,expect,it } from 'vitest'
import { distance } from '@turf/turf'
import { rectangle,circleFromPoints } from '../constructionTools'
describe('construction tools',()=>{
 it('creates a closed rectangle and rejects zero area',()=>{expect(rectangle([0,0],[1,1])?.coordinates[0]).toHaveLength(5);expect(rectangle([0,0],[0,1])).toBeNull()})
 it('circle radius follows the second click',()=>{const geometry=circleFromPoints([0,0],[0,1])!;expect(distance([0,0],geometry.coordinates[0][0])).toBeCloseTo(distance([0,0],[0,1]),2);expect(circleFromPoints([0,0],[0,0])).toBeNull()})
})
