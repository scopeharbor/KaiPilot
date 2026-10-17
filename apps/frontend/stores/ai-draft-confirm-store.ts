import { create } from 'zustand'
import type {
  DraftAutoFixDiff,
  DraftConfirmMode,
  DraftUnselectedStrategy,
  ProjectDraft,
  ProjectDraftSelection,
} from '@aiproj/types'
import {
  buildFullSelection,
  buildWbsNodeIdMap,
  createEmptySelection,
  resolveAncestors,
  resolveDescendantWbsAndTasks,
} from '@/lib/next/draft-selection-helpers'

/**
 * 草案转正确认交互状态库（v3-ui-next-draft-confirm W1 / tasks 1.2）。
 *
 * 纯内存 Store（**不启用 persist**，避免选择集/弹窗态等瞬时交互状态随
 * sessionStorage 持久化产生刷新幽灵死锁）。
 *
 * 硬性不变量（与服务端 import_selection.ts 对齐）：
 * - `mode: 'all'` 恒对应完整选择集（buildFullSelection）；
 * - 选择集**恒包含祖先闭包**：任何已选 WBS 节点 / 任务的祖先父链都在其中，
 *   杜绝悬空孤儿节点；
 * - 任何未选任务导致的悬空依赖由 `findDanglingDependencies` 实时分析，
 *   转正时后端负责最终移除。
 *
 * 数据核心仍以 `useAiProjectDraftStore`（draft / pendingModifications / confirmResponse）
 * 为单一事实来源；本 Store 只承载审查工作面的选择状态机。
 */

export interface AiDraftConfirmState {
  /** 全部接受 / 局部选择。默认全部接受。 */
  mode: DraftConfirmMode
  /** 当前选择集（含未选内容处置策略）。 */
  selection: ProjectDraftSelection
  /** 用户是否已勾选「已复核并确认 Warning 告警」。 */
  acknowledgedWarnings: boolean
  /** 确认转正请求在途标记（防重复点击）。 */
  isConfirming: boolean
  /** 转正失败分类错误文案（网络/冲突/服务端拦截），成功或重试前清空。 */
  confirmError: string | null
  /** 二次确认弹窗显隐（ActionBar 唤起 / ConfirmModal 关闭）。 */
  confirmModalOpen: boolean
  /** 自动修正 Diff 复核门禁状态（RL-02：autoFix 后强制人工复核新版本）。 */
  autoFixModalState: { open: boolean; diffs: DraftAutoFixDiff[]; version: number }
  /** 悬空依赖解绑警示挂载的任务 ID（PartiaAcceptPanel 解绑影响透视用）。 */
  unlinkedAlertTaskId: string | null
  /** 人员分配：草案角色 → 组织成员 userId（导入时按角色负载均衡把任务指派给真人）。 */
  roleAssignments: Record<string, number[]>
  setRoleAssignment: (role: string, userIds: number[]) => void

  /** 初始化为全部接受 + 完整选择集（依草案重置交互状态）。 */
  initSelection: (draft: ProjectDraft) => void
  /** 切换任务勾选：选中时自动补全直接 WBS 节点与祖先父链；反选仅移除该任务。 */
  toggleTask: (taskId: string, draft: ProjectDraft) => void
  /** 切换 WBS 节点：勾选包含整棵子树（节点+子孙+挂载任务）与祖先父链；反选联动清除子树。 */
  toggleWbs: (nodeId: string, draft: ProjectDraft) => void
  /** 切换模式：all 恢复完整选择集；partial 保留当前选择集。 */
  setMode: (mode: DraftConfirmMode, draft: ProjectDraft) => void
  /** 一键全选（恢复 mode: all + 完整选择集）。 */
  selectAll: (draft: ProjectDraft) => void
  /** 一键清空选择集（切至局部选择；转正操作将被「至少选择 1 项任务」守卫拦截）。 */
  clearAll: () => void
  setUnselectedStrategy: (strategy: DraftUnselectedStrategy) => void
  setAcknowledgedWarnings: (value: boolean) => void
  setIsConfirming: (value: boolean) => void
  setConfirmError: (message: string | null) => void
  /** 重置全部交互状态（切换草案 / 转正完成 / 会话终结时调用）。 */
  resetConfirmState: () => void
}

function withoutDuplicates(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

export const useAiDraftConfirmStore = create<AiDraftConfirmState>((set) => ({
  mode: 'all',
  selection: createEmptySelection(),
  acknowledgedWarnings: false,
  isConfirming: false,
  confirmError: null,
  confirmModalOpen: false,
  autoFixModalState: { open: false, diffs: [], version: 0 },
  unlinkedAlertTaskId: null,
  roleAssignments: {},

  setRoleAssignment: (role, userIds) =>
    set((state) => ({ roleAssignments: { ...state.roleAssignments, [role]: userIds } })),

  initSelection: (draft) =>
    set({
      mode: 'all',
      selection: buildFullSelection(draft),
      acknowledgedWarnings: false,
      isConfirming: false,
      confirmError: null,
      confirmModalOpen: false,
      autoFixModalState: { open: false, diffs: [], version: 0 },
      unlinkedAlertTaskId: null,
    }),

  toggleTask: (taskId, draft) =>
    set((state) => {
      // 全部接受模式下点选即视为「退出全选、进入局部选择」，以当前完整集为基数。
      const mode: DraftConfirmMode = state.mode === 'all' ? 'partial' : state.mode
      const base = state.mode === 'all' ? buildFullSelection(draft) : state.selection
      const taskIds = new Set(base.taskIds)
      const wbsNodeIds = new Set(base.wbsNodeIds)

      if (taskIds.has(taskId)) {
        taskIds.delete(taskId)
      } else {
        taskIds.add(taskId)
        // 正向级联：任务所属直接 WBS 节点与全部祖先父节点自动进入选择集
        // （spec「勾选任务自动包含其直接 WBS 节点及其所有祖先节点」）。
        const task = draft.tasks.find((item) => item.id === taskId)
        if (task) {
          const ancestors = resolveAncestors(buildWbsNodeIdMap(draft.wbs), [task.wbsNodeId])
          for (const id of ancestors) wbsNodeIds.add(id)
        }
      }

      return {
        mode,
        selection: {
          ...base,
          taskIds: withoutDuplicates(taskIds),
          wbsNodeIds: withoutDuplicates(wbsNodeIds),
        },
      }
    }),

  toggleWbs: (nodeId, draft) =>
    set((state) => {
      const mode: DraftConfirmMode = state.mode === 'all' ? 'partial' : state.mode
      const base = state.mode === 'all' ? buildFullSelection(draft) : state.selection
      const scope = resolveDescendantWbsAndTasks(draft.wbs, nodeId, draft.tasks)
      const wbsNodeIds = new Set(base.wbsNodeIds)
      const taskIds = new Set(base.taskIds)

      if (wbsNodeIds.has(nodeId)) {
        // 反向联动：取消勾选该节点下属全部子孙 WBS 节点与挂载任务（spec 需求一第 5 条）。
        for (const id of scope.wbsNodeIds) wbsNodeIds.delete(id)
        for (const id of scope.taskIds) taskIds.delete(id)
      } else {
        // 正向级联：整棵子树（节点 + 子孙 + 挂载任务）进入选择集，并保留完整祖先父链。
        for (const id of scope.wbsNodeIds) wbsNodeIds.add(id)
        for (const id of scope.taskIds) taskIds.add(id)
        const ancestors = resolveAncestors(buildWbsNodeIdMap(draft.wbs), [nodeId])
        for (const id of ancestors) wbsNodeIds.add(id)
      }

      return {
        mode,
        selection: {
          ...base,
          taskIds: withoutDuplicates(taskIds),
          wbsNodeIds: withoutDuplicates(wbsNodeIds),
        },
      }
    }),

  setMode: (mode, draft) =>
    set((state) => ({
      mode,
      selection: mode === 'all' ? buildFullSelection(draft) : state.selection,
    })),

  selectAll: (draft) =>
    set({
      mode: 'all',
      selection: buildFullSelection(draft),
      confirmError: null,
    }),

  clearAll: () =>
    set((state) => ({
      mode: 'partial',
      selection: {
        ...state.selection,
        taskIds: [],
        wbsNodeIds: [],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
      },
    })),

  setUnselectedStrategy: (strategy) =>
    set((state) => ({
      selection: { ...state.selection, unselectedStrategy: strategy },
    })),

  setAcknowledgedWarnings: (value) => set({ acknowledgedWarnings: value }),

  setIsConfirming: (value) => set({ isConfirming: value }),

  setConfirmError: (message) => set({ confirmError: message }),

  resetConfirmState: () =>
    set({
      mode: 'all',
      selection: createEmptySelection(),
      acknowledgedWarnings: false,
      isConfirming: false,
      confirmError: null,
      confirmModalOpen: false,
      autoFixModalState: { open: false, diffs: [], version: 0 },
      unlinkedAlertTaskId: null,
      roleAssignments: {},
    }),
}))
