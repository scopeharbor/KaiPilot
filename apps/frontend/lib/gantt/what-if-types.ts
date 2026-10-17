/**
 * What-if session 类型 —— 甘特决策预览（V2.5 W2）。
 *
 * 设计原则（design D1–D6）：
 * - Session = Base Snapshot + Command History + Derived Preview
 * - Base snapshot 只读，含 input hash 用于 stale 检测。
 * - 命令封闭集合：move-task / resize-duration / add-dependency / remove-dependency / milestone-move。
 * - Preview 由 base + commands 实时推导，不保存第二份可漂移的完整任务树。
 * - Undo/Redo 用命令 cursor；新命令截断 redo tail。
 * - Apply 复用既有 previewToken / 正式排程 mutation。
 */

import type { GanttModel, GanttRenderTask, GanttRenderDependency } from './types'
import type { WorkingCalendarSettingsInput } from './working-calendar'

// ── Base Snapshot ──────────────────────────────────────────────

/**
 * 当前项目的只读规范化快照。
 * 通过 `serverRevision` / `inputHash` 检测数据新鲜度。
 */
export interface WhatIfBaseSnapshot {
  /** 服务端修订号（来自 API / TanStack Query 版本）；null 表示未知。 */
  serverRevision: string | null
  /** 规范化 schedule input hash（任务+依赖+日历+基线）。 */
  inputHash: string
  /** 快照时刻的任务列表（只读——变更时替换引用）。 */
  readonly tasks: readonly GanttRenderTask[]
  /** 快照时刻的依赖列表。 */
  readonly dependencies: readonly GanttRenderDependency[]
  /** 工作日历设置（用于 preview/CPM 重算）。 */
  calendarSettings: WorkingCalendarSettingsInput | null
  /**
   * 任务天偏移的基准时刻（= 来源 GanttModel.epochMs，B4 甘特镜头 W2 扩展）。
   * 缺省时命令执行沿用 V2.5 固定帧（2025-01-01），保持旧行为不变。
   */
  epochMs?: number | null
}

// ── Typed Commands ─────────────────────────────────────────────

export type WhatIfCommand =
  | WhatIfMoveTask
  | WhatIfResizeDuration
  | WhatIfAddDependency
  | WhatIfRemoveDependency
  | WhatIfMilestoneMove

export interface WhatIfMoveTask {
  kind: 'move-task'
  taskId: number
  newStartDate: string
  calendarSettings?: WorkingCalendarSettingsInput | null
}

export interface WhatIfResizeDuration {
  kind: 'resize-duration'
  taskId: number
  newStartDate: string
  newEndDate: string
  calendarSettings?: WorkingCalendarSettingsInput | null
}

export interface WhatIfAddDependency {
  kind: 'add-dependency'
  predecessorId: number
  successorId: number
}

export interface WhatIfRemoveDependency {
  kind: 'remove-dependency'
  dependencyId: number
  predecessorId: number
  successorId: number
}

export interface WhatIfMilestoneMove {
  kind: 'milestone-move'
  milestoneId: number
  taskId: number
  newDate: string
}

// ── Command History ────────────────────────────────────────────

export interface WhatIfHistory {
  /** 已执行命令（按序）。 */
  entries: WhatIfCommand[]
  /** undo/redo 游标：当前命令之后的索引。0 = 无已执行命令。 */
  cursor: number
  /** 历史上限（默认 100）。超限时压缩。 */
  maxEntries: number
}

// ── Preview ────────────────────────────────────────────────────

/**
 * 后端 preview 结果（lazy 获取：只在实际 Apply 前调用一次 schedule preview API）。
 */
export interface WhatIfBackendPreview {
  previewToken: string
  changes: Array<{
    taskId: number
    taskName: string
    before: { startDate: string; endDate: string; durationDays: number }
    after: { startDate: string; endDate: string; durationDays: number }
  }>
  warnings: string[]
  conflicts: Array<{
    taskId: number
    taskName: string
    code: string
    message: string
  }>
  calendar: { version: number; workdays: number[]; holidays: string[]; extraWorkdays: string[] }
}

// ── Derived Preview ────────────────────────────────────────────

/**
 * 前端即时 derived overlay（每次命令后实时重算）。
 * 不替代后端 previewToken——后者是 Apply 权威。
 */
export interface WhatIfDerivedPreview {
  /** 即时计算的关键路径重算模型。 */
  model: GanttModel
  /** 受影响的 task ids（仅被 commands 直接修改的任务）。 */
  affectedTaskIds: number[]
  /** 与基线相比的偏差摘要。 */
  deviationSummary: string | null
}

// ── Session State ──────────────────────────────────────────────

export type WhatIfSessionStatus = 'idle' | 'active' | 'stale' | 'applying' | 'applied' | 'error'

export interface WhatIfSession {
  status: WhatIfSessionStatus
  /** 该 session 所属项目（B4 甘特镜头单项目单一 session 唯一性登记；可空=未记录）。 */
  projectId?: number | null
  baseSnapshot: WhatIfBaseSnapshot | null
  history: WhatIfHistory
  /** 前端即时 derived preview（每次命令后更新）。 */
  derivedPreview: WhatIfDerivedPreview | null
  /** 后端 preview（lazy，Apply 前填充）。 */
  backendPreview: WhatIfBackendPreview | null
  /** 最后错误消息。 */
  errorMessage: string | null
  /** 未保存变更标记（与 status 关联）。 */
  hasUnsavedChanges: boolean
}

// ── What-if 模式控件状态 ──────────────────────────────────────

export interface WhatIfControlsState {
  /** 是否处于 What-if 模式。 */
  isActive: boolean
  /** 可否 undo。 */
  canUndo: boolean
  /** 可否 redo。 */
  canRedo: boolean
  /** 可否 reset。 */
  canReset: boolean
  /** 可否 Apply。 */
  canApply: boolean
  /** stale 标记。 */
  isStale: boolean
}

// ── 辅助工具 ───────────────────────────────────────────────────

/** 计算历史中的已执行命令数（= cursor）。 */
export function executedCount(history: WhatIfHistory): number {
  return history.cursor
}

/** 计算历史中的可重做命令数（= entries.length - cursor）。 */
export function redoableCount(history: WhatIfHistory): number {
  return history.entries.length - history.cursor
}

/** 创建空历史。 */
export function createEmptyHistory(maxEntries = 100): WhatIfHistory {
  return { entries: [], cursor: 0, maxEntries }
}
