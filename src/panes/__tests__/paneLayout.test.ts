import { describe,expect,it } from 'vitest'
import { defaultWorkspaceLayout } from '../../workspaceLayout'
import { defaultPaneLayout,openPane,closePane,movePane,toggleAutoHide,migrateWorkspaceLayout,normalizePaneLayout,applyPanePreset } from '../paneLayout'
describe('pane layouts',()=>{
 it('opens and activates a pane, then activates its neighbour when closed',()=>{let p=openPane(defaultPaneLayout(),'symbology');expect(p.active.right).toBe('symbology');p=closePane(p,'symbology');expect(p.active.right).toBe('catalog')})
 it('floating preserves the frame and removes the old active pane',()=>{const p=defaultPaneLayout();expect(movePane(p,'contents','float').panes.contents.frame).toEqual(p.panes.contents.frame);expect(movePane(p,'contents','float').active.left).toBeNull()})
 it('migrates legacy closed sides, auto hide and floating frames',()=>{const old=defaultWorkspaceLayout();old.contentsMinimized=true;old.rightPaneOpen=false;old.panels.symbology.floating=true;const p=migrateWorkspaceLayout(old);expect(p.panes.contents.autoHide).toBe(true);expect(p.active.right).toBeNull();expect(p.panes.symbology.frame).toEqual(old.panels.symbology.frame)})
 it('normalizes garbage and applies the analysis preset',()=>{expect(normalizePaneLayout(null)).toEqual(defaultPaneLayout());const p=applyPanePreset(defaultPaneLayout(),'analysis');expect(p.active.right).toBe('geoprocessing');expect(p.panes.contents.autoHide).toBe(true);expect(toggleAutoHide(p,'contents').panes.contents.autoHide).toBe(false)})
})
