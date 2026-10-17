/**
 * What-if Session 工具 —— 构建 BaseSnapshot 等辅助函数。
 *
 * @file what-if-session.ts
 */

import type { GanttRenderTask, GanttRenderDependency } from './types'
import type { WorkingCalendarSettingsInput } from './working-calendar'
import type { WhatIfBaseSnapshot } from './what-if-types'

/**
 * 从甘特数据和日历设置构建 WhatIfBaseSnapshot。
 * 计算确定性 inputHash 用于 stale 检测。
 */
export function buildGanttBaseSnapshot(
  tasks: readonly GanttRenderTask[],
  dependencies: readonly GanttRenderDependency[],
  calendarSettings: WorkingCalendarSettingsInput | null,
  serverRevision: string,
): WhatIfBaseSnapshot {
  const inputHash = computeStableInputHash(tasks, dependencies, calendarSettings)

  return {
    serverRevision,
    inputHash,
    tasks,
    dependencies,
    calendarSettings,
  }
}

/**
 * 计算稳定 input hash（仅包含排程相关字段：id/startDay/durationDays/dependencies）。
 * 不包含 name/progress/status 等与排程无关的字段，避免不影响排程的数据变化触发 false stale。
 */
function computeStableInputHash(
  tasks: readonly GanttRenderTask[],
  dependencies: readonly GanttRenderDependency[],
  calendarSettings: WorkingCalendarSettingsInput | null,
): string {
  const payload: unknown[] = [
    tasks.map((t) => ({
      id: t.id,
      s: t.startDay,
      d: t.durationDays,
      k: t.kind,
    })),
    dependencies.map((d) => ({
      id: d.id,
      p: d.predecessorId,
      s: d.successorId,
      t: d.type,
      l: d.lagDays,
    })),
    calendarSettings,
  ]

  const raw = JSON.stringify(payload)
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return `stable_${Math.abs(hash).toString(36)}`
}
