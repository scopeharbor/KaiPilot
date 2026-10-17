import { create } from 'zustand'
import type { RiskCategory, RiskStatus } from '@/lib/api/risks'

export type RiskMatrixMode = 'inherent' | 'residual'

export interface RiskViewState {
  /** 矩阵基线切换 */
  matrixBasis: RiskMatrixMode
  setMatrixBasis: (basis: RiskMatrixMode) => void

  /** 类别筛选 */
  categoryFilter: RiskCategory | null
  setCategoryFilter: (category: RiskCategory | null) => void

  /** 状态筛选 */
  statusFilter: RiskStatus | null
  setStatusFilter: (status: RiskStatus | null) => void

  /** AI 建议抽屉开合 */
  aiDrawerOpen: boolean
  setAiDrawerOpen: (open: boolean) => void

  /** AI 建议批次中被采纳/拒绝的候选本地态 */
  acceptedSuggestionIds: Set<string>
  rejectedSuggestionIds: Set<string>
  markAccepted: (suggestionBatchId: string) => void
  markRejected: (suggestionBatchId: string) => void
  resetSuggestions: () => void
}

export const useRiskViewStore = create<RiskViewState>((set) => ({
  matrixBasis: 'inherent',
  setMatrixBasis: (basis) => set({ matrixBasis: basis }),

  categoryFilter: null,
  setCategoryFilter: (category) => set({ categoryFilter: category }),

  statusFilter: null,
  setStatusFilter: (status) => set({ statusFilter: status }),

  aiDrawerOpen: false,
  setAiDrawerOpen: (open) => set({ aiDrawerOpen: open }),

  acceptedSuggestionIds: new Set(),
  rejectedSuggestionIds: new Set(),
  markAccepted: (id) =>
    set((state) => {
      const accepted = new Set(state.acceptedSuggestionIds)
      accepted.add(id)
      return { acceptedSuggestionIds: accepted }
    }),
  markRejected: (id) =>
    set((state) => {
      const rejected = new Set(state.rejectedSuggestionIds)
      rejected.add(id)
      return { rejectedSuggestionIds: rejected }
    }),
  resetSuggestions: () =>
    set({ acceptedSuggestionIds: new Set(), rejectedSuggestionIds: new Set() }),
}))
