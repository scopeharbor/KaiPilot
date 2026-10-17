/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 前端 Zustand 局部状态（task 10.2）。
 *
 * 只管理本地筛选、展开、当前选中和未提交编辑草稿。
 * 服务端状态由 TanStack Query 管理。
 */
import { create } from 'zustand'

export interface DraftLayerUiState {
  // 筛选
  entityTypeFilter: string[]
  statusFilter: string[]
  searchQuery: string

  // 展开状态
  expandedChangeIds: Set<number>
  expandedEntityIds: Set<string>

  // 选中
  selectedChangeIds: Set<number>

  // 动作
  setEntityTypeFilter: (types: string[]) => void
  setStatusFilter: (statuses: string[]) => void
  setSearchQuery: (query: string) => void
  toggleExpandChange: (changeId: number) => void
  toggleExpandEntity: (entityId: string) => void
  toggleSelectChange: (changeId: number) => void
  selectAll: (changeIds: number[]) => void
  clearSelection: () => void
  reset: () => void
}

const initial = {
  entityTypeFilter: [] as string[],
  statusFilter: [] as string[],
  searchQuery: '',
  expandedChangeIds: new Set<number>(),
  expandedEntityIds: new Set<string>(),
  selectedChangeIds: new Set<number>(),
}

export const useDraftLayerUiStore = create<DraftLayerUiState>((set) => ({
  ...initial,

  setEntityTypeFilter: (types) => set({ entityTypeFilter: types }),
  setStatusFilter: (statuses) => set({ statusFilter: statuses }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleExpandChange: (changeId) =>
    set((state) => {
      const next = new Set(state.expandedChangeIds)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return { expandedChangeIds: next }
    }),

  toggleExpandEntity: (entityId) =>
    set((state) => {
      const next = new Set(state.expandedEntityIds)
      if (next.has(entityId)) next.delete(entityId)
      else next.add(entityId)
      return { expandedEntityIds: next }
    }),

  toggleSelectChange: (changeId) =>
    set((state) => {
      const next = new Set(state.selectedChangeIds)
      if (next.has(changeId)) next.delete(changeId)
      else next.add(changeId)
      return { selectedChangeIds: next }
    }),

  selectAll: (changeIds) => set({ selectedChangeIds: new Set(changeIds) }),
  clearSelection: () => set({ selectedChangeIds: new Set() }),
  reset: () => set(initial),
}))
