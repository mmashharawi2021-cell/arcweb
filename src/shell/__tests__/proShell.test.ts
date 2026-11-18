import {describe,expect,it,vi} from 'vitest'
import {searchCommands,runCommand} from '../commands'
import {parseScale} from '../scaleInput'
import {formatCoordinates} from '../../coordinateFormat'
import {useArcWebStore} from '../../store'
describe('Pro shell',()=>{
 it('ranks prefixes before keywords and disabled commands last',()=>{const run=vi.fn();const commands=[{id:'a',label:'Find',keywords:'select location',run},{id:'b',label:'Select By Location',run},{id:'c',label:'Select Location',disabled:true,run}];expect(searchCommands(commands,'select loc').map(x=>x.id)).toEqual(['b','a','c']);expect(runCommand(commands[2])).toBe(false);expect(run).not.toHaveBeenCalled()})
 it('accepts RF scales and rejects invalid values',()=>{expect(parseScale('1:50,000')).toBe(50000);expect(parseScale('1:0')).toBeNull();expect(parseScale('garbage')).toBeNull()})
 it('formats DMS and UTM without losing hemisphere',()=>{expect(formatCoordinates(-10,-20,'dms')).toContain('W');expect(formatCoordinates(-10,-20,'ddm')).toContain('S');expect(formatCoordinates(35,31,'utm')).toContain('EPSG:32636')})
 it('keeps only fifty notifications and marks them read',()=>{useArcWebStore.setState({notifications:[]});for(let i=0;i<60;i++)useArcWebStore.getState().addNotification('Message '+i,'success');expect(useArcWebStore.getState().notifications).toHaveLength(50);expect(useArcWebStore.getState().notifications[0].message).toBe('Message 59');useArcWebStore.getState().markNotificationsRead();expect(useArcWebStore.getState().notifications.every(n=>n.read)).toBe(true)})
 it('keeps two tables and per-layer sort/filter settings until each is closed',()=>{useArcWebStore.setState({openTables:[],activeTable:null});const state=useArcWebStore.getState();state.openTable('a');state.setTableView('a',{sort:{field:'name',direction:1}});state.openTable('b');expect(useArcWebStore.getState().openTables).toEqual(['a','b']);state.closeTable('b');expect(useArcWebStore.getState().activeTable).toBe('a');expect(useArcWebStore.getState().tableViews.a.sort?.field).toBe('name');state.closeTable('a');expect(useArcWebStore.getState().tableOpen).toBe(false)})
})
