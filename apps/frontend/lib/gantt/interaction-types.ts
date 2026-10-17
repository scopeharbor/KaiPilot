/**
 * 甘特交互层类型（V2 gantt-interaction-upgrade / design D1–D3）。
 *
 * 统一「任务日期 / 里程碑日期 / 进度 / 依赖 / 导航」草稿类型，让鼠标拖拽与键盘步进
 * 生成**同一类** `GanttInteractionDraft`（design 风险缓解：拖拽与键盘语义一致，可测等价）。
 * 底层排程/依赖草稿仍复用 `./types` 的既有事实来源，本文件只做交互层聚合与新增。
 */

import type { DependencyType, GanttDependencyDraft, GanttScheduleDraft } from './types'

export type { DependencyType, GanttDependencyDraft, GanttScheduleDraft }

/**
 * 交互模式（design D3）：工具栏显式切换。切换只改变**可交互图元与提示**，
 * 绝不修改任务、依赖、里程碑或基线数据。默认低风险 `select`。
 */
export type GanttInteractionMode =
  | 'select' // 选择/查看（默认，最低风险）
  | 'schedule' // 任务条移动/边界调整
  | 'dependency' // 依赖锚点连线
  | 'progress' // 进度调整
  | 'baselineInspect' // 基线偏差阅读（只读）

/** 全部交互模式（工具栏枚举与只读降级派生用）。 */
export const GANTT_INTERACTION_MODES: GanttInteractionMode[] = [
  'select',
  'schedule',
  'dependency',
  'progress',
  'baselineInspect',
]

/** 里程碑目标日期调整草稿（task 2.5）：只挪目标日，复用同一确认流程。 */
export interface GanttMilestoneDateDraft {
  milestoneId: number
  taskId: number
  /** 目标天偏移（相对模型 epoch）。 */
  day: number
}

/** 任务进度调整草稿（task 2.6）：只改进度，禁止隐式改期/改依赖/改里程碑/改基线。 */
export interface GanttProgressDraft {
  taskId: number
  /** 目标完成度 0..1。 */
  progress: number
}

/**
 * 导航目标（design D5）：只改视口滚动位置 / 可见时间窗 / 焦点，**绝不修改排程数据**。
 */
export type GanttNavigationTarget =
  | { kind: 'today' }
  | { kind: 'project-start' }
  | { kind: 'project-end' }
  | { kind: 'task'; taskId: number }
  | { kind: 'critical-start' }
  | { kind: 'critical-end' }
  | { kind: 'day'; day: number }
  | { kind: 'range'; startDay: number; endDay: number }

/**
 * 统一交互草稿（discriminated union）。任何会写入正式数据的动作都先落成草稿，
 * 由页面转成既有 schedule preview / 依赖 mutation / 进度确认，人工确认后才 commit。
 */
export type GanttInteractionDraft =
  | { kind: 'schedule'; draft: GanttScheduleDraft }
  | { kind: 'milestone'; draft: GanttMilestoneDateDraft }
  | { kind: 'progress'; draft: GanttProgressDraft }
  | { kind: 'dependency'; draft: GanttDependencyDraft }

/**
 * 叠加层可见性开关（design D6 优先级组合中的**用户可控**部分）。
 * 优先级排序（preview→冲突→选中链→关键路径→问题链→基线→常规依赖）由渲染层固定，
 * 这里只表达用户显式开关，属本地 UI 偏好，禁止写业务数据。
 */
export interface GanttOverlayVisibility {
  showAllDependencies: boolean
  showProblemChain: boolean
  showCriticalPath: boolean
  compareBaseline: boolean
  /** 选中任务的上下游链路高亮。 */
  showSelectedChain: boolean
}

export const DEFAULT_OVERLAY_VISIBILITY: GanttOverlayVisibility = {
  showAllDependencies: false,
  showProblemChain: false,
  showCriticalPath: true,
  compareBaseline: false,
  showSelectedChain: true,
}

/**
 * 只读降级派生（task 1.4）：按当前权限过滤可用交互模式。
 * 无任务编辑权限时禁用 schedule/progress；无依赖编辑权限时禁用 dependency。
 * `select` 与 `baselineInspect` 恒可用（纯查看）。
 */
export function availableModes(
  editable: boolean,
  dependencyEditable: boolean,
): GanttInteractionMode[] {
  return GANTT_INTERACTION_MODES.filter((mode) => {
    if (mode === 'schedule' || mode === 'progress') return editable
    if (mode === 'dependency') return dependencyEditable
    return true
  })
}

/** 当前模式在给定权限下不可用时，回落到安全的 `select`。 */
export function resolveMode(
  mode: GanttInteractionMode,
  editable: boolean,
  dependencyEditable: boolean,
): GanttInteractionMode {
  return availableModes(editable, dependencyEditable).includes(mode) ? mode : 'select'
}

/** 依赖类型推断：由前置锚点侧 + 后继锚点侧确定 FS/SS/FF/SF（拖拽与键盘共用）。 */
export function inferDependencyType(
  from: 'start' | 'finish',
  to: 'start' | 'finish',
): DependencyType {
  if (from === 'start') return to === 'start' ? 'ss' : 'sf'
  return to === 'start' ? 'fs' : 'ff'
}
