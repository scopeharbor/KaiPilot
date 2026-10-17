/**
 * What-if Impact Summary —— 确定性的 base-vs-preview 影响分析（V2.5 W2）。
 *
 * 接收 base snapshot 与后端 normalized preview，返回结构化 ImpactSummary。
 * 纯函数、无副作用、可单测。
 *
 * @file what-if-impact.ts
 */

import { backfillCriticalPath } from './critical-path'
import { createWorkingCalendar, type WorkingCalendarSettingsInput } from './working-calendar'
import type { GanttModel, GanttRenderTask, GanttRenderDependency } from './types'
import type { WhatIfBaseSnapshot } from './what-if-types'

// ── Reason Codes ───────────────────────────────────────────────

export type ReasonCode =
  | 'DIRECT_DATE_MOVE'
  | 'DIRECT_RESIZE'
  | 'DEPENDENCY_PROPAGATION'
  | 'WORKING_CALENDAR_SNAP'
  | 'CRITICAL_PATH_ENTERED'
  | 'CRITICAL_PATH_EXITED'
  | 'MILESTONE_DELAYED'
  | 'MILESTONE_ADVANCED'
  | 'MILESTONE_UNCHANGED'
  | 'BASELINE_VARIANCE_INCREASED'
  | 'BASELINE_VARIANCE_DECREASED'
  | 'BASELINE_UNKNOWN'
  | 'CYCLE_DETECTED'
  | 'VALIDATION_ERROR'
  | 'STALE_SESSION'
  | 'MISSING_DATE'
  | 'MISSING_BASELINE'
  | 'UNKNOWN'

// ── Severity ───────────────────────────────────────────────────

export type Severity = 'blocker' | 'warning' | 'info'

// ── Evidence Item ──────────────────────────────────────────────

export interface EvidenceItem {
  entityType: 'task' | 'dependency' | 'milestone' | 'project'
  entityId: number
  entityName: string
  before: string | null
  after: string | null
  reasonCode: ReasonCode
  propagation: 'direct' | 'propagated'
  severity: Severity
}

// ── Metrics ────────────────────────────────────────────────────

export interface TimelineMetric {
  before: string | null
  after: string | null
  workingDelta: number | null
}

export interface TaskCountMetric {
  direct: number
  propagated: number
  unchanged: number
  total: number
}

export interface CriticalPathMetric {
  baseCriticalTaskCount: number
  previewCriticalTaskCount: number
  addedCriticalTaskIds: number[]
  removedCriticalTaskIds: number[]
  baseTotalFloatRange: { min: number; max: number } | null
  previewTotalFloatRange: { min: number; max: number } | null
}

export interface MilestoneMetric {
  total: number
  delayed: number
  advanced: number
  unchanged: number
}

export interface ConflictMetric {
  cycleCount: number
  constraintViolationCount: number
  total: number
}

export interface BaselineMetric {
  finishVariance: number | null
  startVariance: number | null
  durationVariance: number | null
  hasBaseline: boolean
}

// ── Impact Summary ─────────────────────────────────────────────

export interface ImpactSummary {
  /** 是否基于后端 normalized preview（false = provisional）。 */
  isAuthoritative: boolean
  /** 项目工期/起止。 */
  timeline: TimelineMetric
  /** 任务计数。 */
  tasks: TaskCountMetric
  /** 关键路径。 */
  criticalPath: CriticalPathMetric
  /** 里程碑。 */
  milestones: MilestoneMetric
  /** 冲突。 */
  conflicts: ConflictMetric
  /** 基线偏差。 */
  baseline: BaselineMetric
  /** 详细证据列表。按 priority 排序：blocker > warning > info。 */
  evidence: EvidenceItem[]
  /** Apply 门禁。 */
  gate: {
    hasBlocker: boolean
    hasWarning: boolean
    blockerCount: number
    warningCount: number
    warningConfirmed: boolean
  }
}

// ── Calculator ─────────────────────────────────────────────────

export interface ImpactCalculatorInput {
  baseSnapshot: WhatIfBaseSnapshot
  previewModel: GanttModel
  directCommandTaskIds: number[]
  backendPreviewToken: string | null
  serverRevision: string
  /** 可选：后端 validation 结果。 */
  validation?: {
    hasCycle: boolean
    constraintViolations: number
    warnings: string[]
  }
  /** 可选：baseline data。 */
  baseline?: {
    finishDate: string
    startDate: string
    durationDays: number
  } | null
}

/**
 * 计算 base vs preview 的影响摘要。
 * 纯函数：输入相同则输出相同。
 */
export function computeImpactSummary(input: ImpactCalculatorInput): ImpactSummary {
  const {
    baseSnapshot,
    previewModel,
    directCommandTaskIds,
    backendPreviewToken,
    validation,
    baseline,
  } = input

  const isAuthoritative = backendPreviewToken !== null
  const baseTasks = baseSnapshot.tasks as GanttRenderTask[]
  const previewTasks = previewModel.tasks
  const directSet = new Set(directCommandTaskIds)

  // ── Timeline ─────────────────────────────────────────────
  const timeline = computeTimeline(
    baseTasks,
    previewTasks,
    baseSnapshot.calendarSettings,
    previewModel.epochMs ?? baseSnapshot.epochMs ?? undefined,
  )

  // ── Task counts ──────────────────────────────────────────
  const tasks = computeTaskCounts(baseTasks, previewTasks, directSet)

  // ── Critical path ────────────────────────────────────────
  const criticalPath = computeCriticalPathMetric(baseSnapshot, previewModel)

  // ── Milestones ───────────────────────────────────────────
  const milestones = computeMilestoneMetric(baseTasks, previewTasks)

  // ── Conflicts ────────────────────────────────────────────
  const conflicts: ConflictMetric = {
    cycleCount: validation?.hasCycle ? 1 : 0,
    constraintViolationCount: validation?.constraintViolations ?? 0,
    total: (validation?.hasCycle ? 1 : 0) + (validation?.constraintViolations ?? 0),
  }

  // ── Baseline ─────────────────────────────────────────────
  const baselineMetric = computeBaselineMetric(baseTasks, previewTasks, baseline)

  // ── Evidence items ───────────────────────────────────────
  const evidence = generateEvidence(baseTasks, previewTasks, directSet, validation)

  // ── Gate ─────────────────────────────────────────────────
  const hasBlocker = evidence.some((e) => e.severity === 'blocker')
  const hasWarning = evidence.some((e) => e.severity === 'warning')
  const blockerCount = evidence.filter((e) => e.severity === 'blocker').length
  const warningCount = evidence.filter((e) => e.severity === 'warning').length

  return {
    isAuthoritative,
    timeline,
    tasks,
    criticalPath,
    milestones,
    conflicts,
    baseline: baselineMetric,
    evidence,
    gate: {
      hasBlocker,
      hasWarning,
      blockerCount,
      warningCount,
      warningConfirmed: false,
    },
  }
}

// ── 子计算器 ───────────────────────────────────────────────────

function computeTimeline(
  base: GanttRenderTask[],
  preview: GanttRenderTask[],
  _calendarSettings: WorkingCalendarSettingsInput | null,
  modelEpochMs?: number,
): TimelineMetric {
  const baseStart = minStartDay(base)
  const baseEnd = maxEndDay(base)
  const prevStart = minStartDay(preview)
  const prevEnd = maxEndDay(preview)

  const baseDuration = baseEnd - baseStart + 1
  const prevDuration = prevEnd - prevStart + 1
  // 完工日期变动 = 试算完工日 − 原定完工日（正 = 延后，负 = 提前）。
  // 原先用「总工期差」：把第一个任务往后拖 1 天、完工日不变时，总工期少 1 天，
  // 却显示成「项目整体完工日期提前 1 天」（2026-10-12 用户反馈）。
  const workingDelta = prevEnd - baseEnd

  const epochMs = modelEpochMs ?? Date.UTC(2025, 0, 1)
  const fmt = (day: number) => new Date(epochMs + day * 86_400_000).toISOString().slice(0, 10)

  return {
    before: `${fmt(baseStart)} ~ ${fmt(baseEnd)} (${baseDuration}d)`,
    after: `${fmt(prevStart)} ~ ${fmt(prevEnd)} (${prevDuration}d)`,
    workingDelta: workingDelta !== 0 ? workingDelta : null,
  }
}

function computeTaskCounts(
  base: GanttRenderTask[],
  preview: GanttRenderTask[],
  directSet: Set<number>,
): TaskCountMetric {
  let direct = 0
  let propagated = 0
  let unchanged = 0

  const baseMap = new Map(base.map((t) => [t.id, t]))

  for (const task of preview) {
    const baseTask = baseMap.get(task.id)
    if (!baseTask) {
      unchanged++
      continue
    }
    const changed =
      baseTask.startDay !== task.startDay || baseTask.durationDays !== task.durationDays
    if (!changed) {
      unchanged++
      continue
    }
    if (directSet.has(task.id)) {
      direct++
    } else {
      propagated++
    }
  }

  return { direct, propagated, unchanged, total: preview.length }
}

function computeCriticalPathMetric(
  baseSnapshot: WhatIfBaseSnapshot,
  previewModel: GanttModel,
): CriticalPathMetric {
  const calendar = baseSnapshot.calendarSettings
  let cal
  try {
    cal = createWorkingCalendar(calendar)
  } catch {
    cal = createWorkingCalendar()
  }

  const baseModel: GanttModel = {
    tasks: baseSnapshot.tasks as GanttRenderTask[],
    dependencies: baseSnapshot.dependencies as GanttRenderDependency[],
    milestones: previewModel.milestones,
    timeRange: previewModel.timeRange,
    epochMs: previewModel.epochMs,
  }
  const baseWithCPM = backfillCriticalPath(baseModel, cal)

  // Preview 已含 CPM（从 executeCommandsAndPreview 产出）
  const previewWithCPM = previewModel

  const baseCriticalIds = new Set(baseWithCPM.tasks.filter((t) => t.isCritical).map((t) => t.id))
  const previewCriticalIds = new Set(
    previewWithCPM.tasks.filter((t) => t.isCritical).map((t) => t.id),
  )

  const added = [...previewCriticalIds].filter((id) => !baseCriticalIds.has(id))
  const removed = [...baseCriticalIds].filter((id) => !previewCriticalIds.has(id))

  const baseFloat = baseWithCPM.tasks
    .filter((t) => t.totalFloat !== undefined)
    .map((t) => t.totalFloat!)
  const prevFloat = previewWithCPM.tasks
    .filter((t) => t.totalFloat !== undefined)
    .map((t) => t.totalFloat!)

  return {
    baseCriticalTaskCount: baseCriticalIds.size,
    previewCriticalTaskCount: previewCriticalIds.size,
    addedCriticalTaskIds: added,
    removedCriticalTaskIds: removed,
    baseTotalFloatRange:
      baseFloat.length > 0 ? { min: Math.min(...baseFloat), max: Math.max(...baseFloat) } : null,
    previewTotalFloatRange:
      prevFloat.length > 0 ? { min: Math.min(...prevFloat), max: Math.max(...prevFloat) } : null,
  }
}

function computeMilestoneMetric(
  base: GanttRenderTask[],
  preview: GanttRenderTask[],
): MilestoneMetric {
  const baseMile = base.filter((t) => t.kind === 'milestone')
  const previewMile = preview.filter((t) => t.kind === 'milestone')
  const baseMap = new Map(baseMile.map((t) => [t.id, t]))

  let delayed = 0,
    advanced = 0,
    unchanged = 0
  for (const t of previewMile) {
    const bt = baseMap.get(t.id)
    if (!bt) {
      unchanged++
      continue
    }
    if (t.startDay > bt.startDay) delayed++
    else if (t.startDay < bt.startDay) advanced++
    else unchanged++
  }

  return { total: previewMile.length, delayed, advanced, unchanged }
}

function computeBaselineMetric(
  _base: GanttRenderTask[],
  _preview: GanttRenderTask[],
  baseline: { finishDate: string; startDate: string; durationDays: number } | null | undefined,
): BaselineMetric {
  if (!baseline) {
    return { finishVariance: null, startVariance: null, durationVariance: null, hasBaseline: false }
  }

  const prevStart = minStartDay(_preview)
  const prevEnd = maxEndDay(_preview)
  const prevDuration = prevEnd - prevStart + 1

  const epochMs = Date.UTC(2025, 0, 1)
  const baseFinishDays = Math.floor(
    (Date.parse(`${baseline.finishDate}T00:00:00Z`) - epochMs) / 86_400_000,
  )
  const baseStartDays = Math.floor(
    (Date.parse(`${baseline.startDate}T00:00:00Z`) - epochMs) / 86_400_000,
  )

  return {
    finishVariance: prevEnd - baseFinishDays,
    startVariance: prevStart - baseStartDays,
    durationVariance: prevDuration - baseline.durationDays,
    hasBaseline: true,
  }
}

// ── Evidence Generation ────────────────────────────────────────

function generateEvidence(
  base: GanttRenderTask[],
  preview: GanttRenderTask[],
  directSet: Set<number>,
  validation?: { hasCycle: boolean; constraintViolations: number; warnings: string[] },
): EvidenceItem[] {
  const items: EvidenceItem[] = []
  const baseMap = new Map(base.map((t) => [t.id, t]))

  for (const task of preview) {
    const bt = baseMap.get(task.id)
    if (!bt) continue

    const startChanged = bt.startDay !== task.startDay
    const durChanged = bt.durationDays !== task.durationDays
    if (!startChanged && !durChanged) continue

    const isDirect = directSet.has(task.id)
    const propagation: 'direct' | 'propagated' = isDirect ? 'direct' : 'propagated'

    const before = `${bt.startDay}d (dur=${bt.durationDays})`
    const after = `${task.startDay}d (dur=${task.durationDays})`

    if (isDirect) {
      if (durChanged && startChanged) {
        items.push({
          entityType: 'task',
          entityId: task.id,
          entityName: task.name,
          before,
          after,
          reasonCode: 'DIRECT_RESIZE',
          propagation,
          severity: 'info',
        })
      } else {
        items.push({
          entityType: 'task',
          entityId: task.id,
          entityName: task.name,
          before,
          after,
          reasonCode: 'DIRECT_DATE_MOVE',
          propagation,
          severity: 'info',
        })
      }
    } else {
      items.push({
        entityType: 'task',
        entityId: task.id,
        entityName: task.name,
        before,
        after,
        reasonCode: 'DEPENDENCY_PROPAGATION',
        propagation,
        severity: 'info',
      })
    }
  }

  // 里程碑
  const baseMilestones = base.filter((t) => t.kind === 'milestone')
  const baseMsMap = new Map(baseMilestones.map((t) => [t.id, t]))
  for (const t of preview.filter((t) => t.kind === 'milestone')) {
    const bms = baseMsMap.get(t.id)
    if (!bms) continue
    if (bms.startDay !== t.startDay) {
      const delayed = t.startDay > bms.startDay
      items.push({
        entityType: 'milestone',
        entityId: t.id,
        entityName: t.name,
        before: `${bms.startDay}d`,
        after: `${t.startDay}d`,
        reasonCode: delayed ? 'MILESTONE_DELAYED' : 'MILESTONE_ADVANCED',
        propagation: directSet.has(t.id) ? 'direct' : 'propagated',
        severity: delayed ? 'warning' : 'info',
      })
    }
  }

  // 环路 blocker
  if (validation?.hasCycle) {
    items.push({
      entityType: 'project',
      entityId: 0,
      entityName: '依赖',
      before: null,
      after: null,
      reasonCode: 'CYCLE_DETECTED',
      propagation: 'propagated',
      severity: 'blocker',
    })
  }

  // 关键路径变化
  // （由 computeCriticalPathMetric 中的 added/removed 处理，这里补 evidence）
  const baseWithCPM = backfillCriticalPath(
    {
      tasks: base as GanttRenderTask[],
      dependencies: [],
      milestones: [],
      timeRange: { startDay: 0, endDay: 1 },
      epochMs: Date.UTC(2025, 0, 1),
    },
    createWorkingCalendar(),
  )
  const baseCritIds = new Set(baseWithCPM.tasks.filter((t) => t.isCritical).map((t) => t.id))
  const prevCritIds = new Set(preview.filter((t) => t.isCritical).map((t) => t.id))
  for (const id of [...prevCritIds].filter((id) => !baseCritIds.has(id))) {
    const t = preview.find((tt) => tt.id === id)
    if (t)
      items.push({
        entityType: 'task',
        entityId: id,
        entityName: t.name,
        before: '非关键',
        after: '关键路径',
        reasonCode: 'CRITICAL_PATH_ENTERED',
        propagation: directSet.has(id) ? 'direct' : 'propagated',
        severity: 'warning',
      })
  }
  for (const id of [...baseCritIds].filter((id) => !prevCritIds.has(id))) {
    const t = preview.find((tt) => tt.id === id)
    if (t)
      items.push({
        entityType: 'task',
        entityId: id,
        entityName: t.name,
        before: '关键路径',
        after: '非关键',
        reasonCode: 'CRITICAL_PATH_EXITED',
        propagation: directSet.has(id) ? 'direct' : 'propagated',
        severity: 'info',
      })
  }

  return items
}

// ── 辅助 ───────────────────────────────────────────────────────

function minStartDay(tasks: GanttRenderTask[]): number {
  return tasks.reduce((min, t) => Math.min(min, t.startDay), Infinity)
}

function maxEndDay(tasks: GanttRenderTask[]): number {
  return tasks.reduce((max, t) => Math.max(max, t.startDay + t.durationDays), 0)
}

// createWorkingCalendar 已从 ./working-calendar 导入
