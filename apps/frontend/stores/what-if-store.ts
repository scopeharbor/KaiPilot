/**
 * What-if Session Store —— 甘特单一内存 session 管理（V2.5 W2）。
 *
 * 设计原则（design D1–D6）：
 * - 一个项目一个 session，仅内存（无 localStorage / IndexedDB / 后端持久化）。
 * - Enter → 建 BaseSnapshot；exit/discard → 清理。
 * - Undo/Redo 使用命令 cursor + 全量重算 derived preview。
 * - Stale 检测通过 serverRevision/inputHash 比较。
 * - Apply 复用现有 schedule preview + commit mutation。
 *
 * @file what-if-store.ts
 */

import { create } from 'zustand'
import type {
  WhatIfCommand,
  WhatIfSession,
  WhatIfBaseSnapshot,
  WhatIfBackendPreview,
  WhatIfControlsState,
  WhatIfSessionStatus,
  WhatIfDerivedPreview,
} from '@/lib/gantt/what-if-types'
import { createEmptyHistory } from '@/lib/gantt/what-if-types'
import type { ImpactSummary } from '@/lib/gantt/what-if-impact'
import {
  executeCommandsAndPreview,
  pushCommand,
  undoCommand,
  redoCommand,
  activeCommands,
  validateCommand,
} from '@/lib/gantt/what-if-commands'
import { applyDependencyCascade } from '@/lib/gantt/what-if-cascade'
import { backfillCriticalPath } from '@/lib/gantt/critical-path'
import { createWorkingCalendar } from '@/lib/gantt/working-calendar'
import type { GanttRenderTask, GanttRenderDependency } from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'

// ── 类型 ───────────────────────────────────────────────────────

export interface WhatIfSessionStore {
  /** 当前 session 状态。 */
  session: WhatIfSession

  /** 当前 impact summary（可选，从 derivedPreview 计算）。 */
  impactSummary: ImpactSummary | null

  /** 设置 impact summary（每次 derivedPreview 变化时由 hook 计算）。 */
  setImpactSummary: (summary: ImpactSummary | null) => void

  /** 确认所有 warning（已确认的 warning 不再阻止 Apply）。 */
  confirmWarnings: () => void

  /** 进入 What-if 模式：基于当前项目数据建 base snapshot。 */
  enterSession: (
    tasks: readonly GanttRenderTask[],
    dependencies: readonly GanttRenderDependency[],
    calendarSettings: WorkingCalendarSettingsInput | null,
    serverRevision: string,
    projectId?: number | null,
    /** 任务天偏移基准时刻（来源 GanttModel.epochMs）；缺省沿用 V2.5 固定帧。 */
    epochMs?: number | null,
  ) => void

  /** 退出 What-if 模式但不清理 session（保留当前预览，以便用户重新审视）。 */
  exitSession: () => void

  /** 丢弃当前 session 的一切变更并留在 idle。 */
  discardSession: () => void

  /** 重置（undo 所有命令回到 base snapshot）。 */
  resetSession: () => void

  /** 执行一条命令。 */
  executeCommand: (command: WhatIfCommand) => { valid: boolean; error: string | null }

  /** Undo 上一条命令。 */
  undo: () => void

  /** Redo 一条命令。 */
  redo: () => void

  /** 标记 stale（当 serverRevision 变化时外部调用）。 */
  markStale: () => void

  /** 设置后端 preview（Apply 前调用 schedule preview API 获取）。 */
  setBackendPreview: (preview: WhatIfBackendPreview) => void

  /** 清除后端 preview。 */
  clearBackendPreview: () => void

  /** Apply 成功后的回调：清理 session。 */
  onApplySuccess: () => void

  /** Apply 失败的回调。 */
  onApplyError: (errorMessage: string) => void

  /** 获取控件状态（用于 UI）。 */
  getControlsState: () => WhatIfControlsState

  /** 更新 serverRevision（来自 TanStack Query / realtime）。 */
  updateServerRevision: (
    revision: string,
    tasks: readonly GanttRenderTask[],
    dependencies: readonly GanttRenderDependency[],
  ) => void
}

// ── 辅助 ───────────────────────────────────────────────────────

function computeInputHash(
  tasks: readonly GanttRenderTask[],
  dependencies: readonly GanttRenderDependency[],
  calendarSettings: WorkingCalendarSettingsInput | null,
): string {
  // 简化的确定性 hash：JSON 序列化后取 hash（运行时不做加密，只做一致性检测）。
  // 前端 hash 够用——正式 stale 判定用后端返回的 revision/inputHash。
  const raw = JSON.stringify({
    tasks: tasks.map((t) => ({ id: t.id, startDay: t.startDay, durationDays: t.durationDays })),
    dependencies: dependencies.map((d) => ({
      id: d.id,
      pred: d.predecessorId,
      succ: d.successorId,
      type: d.type,
    })),
    calendarSettings,
  })
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return `hash_${Math.abs(hash).toString(36)}`
}

function computeIdSet(
  tasks: readonly GanttRenderTask[],
  deps: readonly GanttRenderDependency[],
): { taskIds: Set<number>; depIds: Set<number> } {
  return {
    taskIds: new Set(tasks.map((t) => t.id)),
    depIds: new Set(deps.map((d) => d.id)),
  }
}

// ── 初始状态 ───────────────────────────────────────────────────

function createInitialSession(): WhatIfSession {
  return {
    status: 'idle',
    projectId: null,
    baseSnapshot: null,
    history: createEmptyHistory(100),
    derivedPreview: null,
    backendPreview: null,
    errorMessage: null,
    hasUnsavedChanges: false,
  }
}

// ── 派生重算 ───────────────────────────────────────────────────

/**
 * 从 base snapshot 重放有效命令集，派生本地预演模型（B4 甘特镜头 W2 扩展）。
 *
 * 在既有 `executeCommandsAndPreview`（仅重放显式命令）之上补充确定性级联顺延
 * （`applyDependencyCascade`，仅向后顺延后继任务），并对级联后的任务集重算
 * CPM 关键路径，使 `derivedPreview.model` 忠实呈现「前置延期 → 下游联动顺延」的
 * 即时预演效果（spec「拖拽排程零写入与本地内存派生」）。纯内存计算，零网络零持久化（RL-08）。
 */
function recomputeDerivedPreview(
  base: WhatIfBaseSnapshot,
  commands: WhatIfCommand[],
): WhatIfDerivedPreview {
  const raw = executeCommandsAndPreview(base, commands)
  const cascade = applyDependencyCascade(raw.model.tasks, base.dependencies)
  if (cascade.shiftedTaskIds.length === 0) return raw

  let calendar
  try {
    calendar = createWorkingCalendar(base.calendarSettings)
  } catch {
    calendar = createWorkingCalendar()
  }
  const model = backfillCriticalPath(
    { ...raw.model, tasks: cascade.tasks as GanttRenderTask[] },
    calendar,
  )
  return { ...raw, model }
}

// ── Store ──────────────────────────────────────────────────────

export const useWhatIfSessionStore = create<WhatIfSessionStore>((set, get) => ({
  session: createInitialSession(),
  impactSummary: null,

  setImpactSummary: (summary) => set({ impactSummary: summary }),

  confirmWarnings: () => {
    const current = get().impactSummary
    if (!current) return
    set({ impactSummary: { ...current, gate: { ...current.gate, warningConfirmed: true } } })
  },

  enterSession: (
    tasks,
    dependencies,
    calendarSettings,
    serverRevision,
    projectId = null,
    epochMs = null,
  ) => {
    const inputHash = computeInputHash(tasks, dependencies, calendarSettings)
    const baseSnapshot: WhatIfBaseSnapshot = {
      serverRevision,
      inputHash,
      tasks,
      dependencies,
      calendarSettings,
      epochMs,
    }

    set({
      session: {
        status: 'active',
        projectId,
        baseSnapshot,
        history: createEmptyHistory(100),
        derivedPreview: null,
        backendPreview: null,
        errorMessage: null,
        hasUnsavedChanges: false,
      },
    })
  },

  exitSession: () => {
    // 退出但不清理：保留 session 数据，status 设 idle，用户可重新查看。
    // 但保留 derived preview 供 UI 展示（直到 discard）。
    set((state) => ({
      session: { ...state.session, status: 'idle' as WhatIfSessionStatus },
    }))
  },

  discardSession: () => {
    set({ session: createInitialSession(), impactSummary: null })
  },

  resetSession: () => {
    const state = get()
    const { baseSnapshot } = state.session
    if (!baseSnapshot) return

    set({
      session: {
        ...state.session,
        history: createEmptyHistory(100),
        derivedPreview: null,
        backendPreview: null,
        errorMessage: null,
        hasUnsavedChanges: false,
      },
    })
  },

  executeCommand: (command) => {
    const state = get()
    const { baseSnapshot, history } = state.session
    if (!baseSnapshot) return { valid: false, error: '无活跃 session' }
    // 提交失败（error）后允许继续调整：执行新命令即回到 active 并清掉旧的错误与冲突
    if (
      state.session.status !== 'active' &&
      state.session.status !== 'idle' &&
      state.session.status !== 'error'
    ) {
      return { valid: false, error: `session 状态不允许执行命令: ${state.session.status}` }
    }

    // 验证命令
    const { taskIds, depIds } = computeIdSet(baseSnapshot.tasks, baseSnapshot.dependencies)
    const validation = validateCommand(command, taskIds, depIds)
    if (!validation.valid) return validation

    // 添加到历史（自动截断 redo tail）
    const newHistory = pushCommand(history, command)

    // 重算 derived preview（含级联顺延与 CPM 重算）
    const activeCmds = activeCommands(newHistory)
    const derivedPreview = baseSnapshot ? recomputeDerivedPreview(baseSnapshot, activeCmds) : null

    const hasChanges = newHistory.cursor > 0

    set({
      session: {
        ...state.session,
        history: newHistory,
        derivedPreview,
        hasUnsavedChanges: hasChanges,
        backendPreview: null, // 清除旧后端 preview，要求 Apply 前重新获取
        errorMessage: null,
        status: 'active' as WhatIfSessionStatus,
      },
    })

    return { valid: true, error: null }
  },

  undo: () => {
    const state = get()
    const { history, baseSnapshot } = state.session
    if (!baseSnapshot) return
    if (history.cursor <= 0) return

    const { history: newHistory } = undoCommand(history)
    const activeCmds = activeCommands(newHistory)
    const derivedPreview = recomputeDerivedPreview(baseSnapshot, activeCmds)

    set({
      session: {
        ...state.session,
        history: newHistory,
        derivedPreview,
        hasUnsavedChanges: newHistory.cursor > 0,
        backendPreview: null, // undo 使旧 backend preview 失效
        errorMessage: null,
      },
    })
  },

  redo: () => {
    const state = get()
    const { history, baseSnapshot } = state.session
    if (!baseSnapshot) return
    if (history.cursor >= history.entries.length) return

    const { history: newHistory } = redoCommand(history)
    const activeCmds = activeCommands(newHistory)
    const derivedPreview = recomputeDerivedPreview(baseSnapshot, activeCmds)

    set({
      session: {
        ...state.session,
        history: newHistory,
        derivedPreview,
        hasUnsavedChanges: newHistory.cursor > 0,
        backendPreview: null,
        errorMessage: null,
      },
    })
  },

  markStale: () => {
    const state = get()
    if (state.session.status !== 'active') return

    set({
      session: {
        ...state.session,
        status: 'stale' as WhatIfSessionStatus,
        hasUnsavedChanges: true,
      },
    })
  },

  setBackendPreview: (preview) => {
    const state = get()
    set({
      session: { ...state.session, backendPreview: preview },
    })
  },

  clearBackendPreview: () => {
    const state = get()
    set({
      session: { ...state.session, backendPreview: null },
    })
  },

  onApplySuccess: () => {
    set({ session: createInitialSession(), impactSummary: null })
  },

  onApplyError: (errorMessage) => {
    const state = get()
    set({
      session: {
        ...state.session,
        status: 'error' as WhatIfSessionStatus,
        errorMessage,
      },
    })
  },

  getControlsState: () => {
    const { session } = get()
    const isActive = session.status === 'active'
    const isStale = session.status === 'stale'
    const isError = session.status === 'error'
    const hasCommands = session.history.cursor > 0
    const canRedo = session.history.cursor < session.history.entries.length

    return {
      isActive: isActive || isStale || isError,
      canUndo: isActive && session.history.cursor > 0,
      canRedo: isActive && canRedo,
      canReset: isActive && hasCommands,
      // 两阶段提交由「应用方案」按钮一键触发（preview→commit 在 applySession 内串联）；
      // 不要求预先持有 backendPreview——preview 结果（含 CYCLE 冲突）在点击后即时获取并阻断。
      canApply: isActive && hasCommands && !isStale,
      isStale,
    }
  },

  updateServerRevision: (revision, tasks, dependencies) => {
    const state = get()
    const { baseSnapshot } = state.session
    if (!baseSnapshot) return

    // 比较任务+依赖的 hash 是否变化
    const newHash = computeInputHash(tasks, dependencies, baseSnapshot.calendarSettings)
    if (baseSnapshot.inputHash !== newHash || baseSnapshot.serverRevision !== revision) {
      state.markStale()
    }
  },
}))
