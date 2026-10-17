/**
 * v2-5-compiler-dynamic-routing-management-ui —— 路由规则编排本地编辑态 store。
 *
 * 草稿走 Zustand 本地态；提交前展示 diff，显式确认后才发写请求。
 * 无确认离开不落库。
 */
import { create } from 'zustand'
import type { RoutingRuleAuthoringRequest } from '@aiproj/types/compiler-dynamic-routing'

interface CompilerRoutingStoreState {
  /** 当前编辑中的规则草稿（null = 无编辑）。 */
  draft: RoutingRuleAuthoringRequest | null
  /** 是否已修改（未保存）。 */
  isDirty: boolean
  /** 确认 token（从 preview 响应获取）。 */
  confirmToken: string | null
}

interface CompilerRoutingStoreActions {
  /** 开始编辑规则（进入草稿态）。 */
  startEditing: (rule: RoutingRuleAuthoringRequest) => void
  /** 更新草稿。 */
  updateDraft: (partial: Partial<RoutingRuleAuthoringRequest>) => void
  /** 设置确认 token。 */
  setConfirmToken: (token: string) => void
  /** 清除草稿（取消编辑）。 */
  discard: () => void
  /** 确认提交后清除草稿。 */
  committed: () => void
}

const initialState: CompilerRoutingStoreState = {
  draft: null,
  isDirty: false,
  confirmToken: null,
}

export const useCompilerRoutingStore = create<
  CompilerRoutingStoreState & CompilerRoutingStoreActions
>((set) => ({
  ...initialState,

  startEditing: (rule) => set({ draft: rule, isDirty: false, confirmToken: null }),

  updateDraft: (partial) =>
    set((state) => ({
      draft: state.draft ? { ...state.draft, ...partial } : null,
      isDirty: true,
    })),

  setConfirmToken: (token) => set({ confirmToken: token }),

  discard: () => set(initialState),

  committed: () => set(initialState),
}))
