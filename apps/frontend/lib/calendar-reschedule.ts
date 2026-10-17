import { DateTime } from 'luxon'
import type { CalendarItem } from '@/lib/calendar-types'

/**
 * Calendar 完整（schedule）模式改期 patch 计算（纯函数，供拖拽与键盘等价操作共用）。
 *
 * 只负责组装 patch，不直接写库：任务走正式任务更新链路（startDate/endDate），
 * 里程碑走正式里程碑更新链路（plannedDate）。权限、校验、审计、缓存失效由上层负责。
 */

export interface TaskReschedulePatch {
  kind: 'task'
  taskId: number
  patch: { startDate?: string; endDate?: string }
  /** 乐观预览用的新区间 */
  optimistic: { start: string | null; end: string | null }
}

export interface MilestoneReschedulePatch {
  kind: 'milestone'
  milestoneId: number
  patch: { plannedDate: string }
  optimistic: { start: string | null; end: string | null }
}

export type ReschedulePatch = TaskReschedulePatch | MilestoneReschedulePatch

function shiftISO(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!
}

function diffDays(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days)
}

/**
 * 由「抓取日」到「落点日」计算改期 patch。
 *
 * - 里程碑：目标日直接成为新的 plannedDate。
 * - 任务（完整区间）：按落点相对抓取日的天数差整体平移开始/结束日期。
 * - 任务（仅截止日）：结束日移动到落点。
 * - 任务（仅开始日）：开始日移动到落点。
 *
 * @param grabbedDate 拖拽/聚焦起始的日期格
 * @param targetDate  落点日期格
 * @returns null 表示无有效改期（同日或缺失日期）
 */
export function computeReschedulePatch(
  item: CalendarItem,
  grabbedDate: string,
  targetDate: string,
): ReschedulePatch | null {
  if (!targetDate || grabbedDate === targetDate) return null

  if (item.kind === 'milestone') {
    return {
      kind: 'milestone',
      milestoneId: item.sourceId,
      patch: { plannedDate: targetDate },
      optimistic: { start: targetDate, end: targetDate },
    }
  }

  const { start, end } = item.dateRange

  if (start && end) {
    const delta = diffDays(grabbedDate, targetDate)
    if (delta === 0) return null
    const newStart = shiftISO(start, delta)
    const newEnd = shiftISO(end, delta)
    return {
      kind: 'task',
      taskId: item.sourceId,
      patch: { startDate: newStart, endDate: newEnd },
      optimistic: { start: newStart, end: newEnd },
    }
  }

  if (end) {
    return {
      kind: 'task',
      taskId: item.sourceId,
      patch: { endDate: targetDate },
      optimistic: { start: null, end: targetDate },
    }
  }

  if (start) {
    return {
      kind: 'task',
      taskId: item.sourceId,
      patch: { startDate: targetDate },
      optimistic: { start: targetDate, end: null },
    }
  }

  return null
}
