import { create } from 'zustand'
import { createEditSessionSlice } from './slices/editSession'
import { createLayersSlice } from './slices/layers'
import { createProjectDataSlice } from './slices/projectData'
import { createSelectionSlice } from './slices/selection'
import { createWorkspaceSlice } from './slices/workspace'
import type { ArcWebState } from './types'

export * from './types'
export type { ArcWebState }

export const useArcWebStore = create<ArcWebState>()((...a) => ({
  ...createLayersSlice(...a),
  ...createSelectionSlice(...a),
  ...createEditSessionSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createProjectDataSlice(...a),
}))
