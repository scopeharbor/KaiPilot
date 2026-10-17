import type { GanttBaseline } from '@/lib/api/gantt-baseline'
import type { GanttModel } from './types'

const MS_PER_DAY = 86_400_000

function isoToDay(epochMs: number, iso: string | null): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(ms) ? undefined : Math.floor((ms - epochMs) / MS_PER_DAY)
}

/** 把基线日期只读叠加到当前模型，不修改任务真实数据。 */
export function applyBaselineToModel(
  model: GanttModel,
  baseline: GanttBaseline | null,
): GanttModel {
  if (!baseline) return model
  const byId = new Map(baseline.snapshot.tasks.map((task) => [task.id, task]))
  return {
    ...model,
    tasks: model.tasks.map((task) => {
      if (task.milestoneId !== undefined) return task
      const saved = byId.get(task.id)
      if (!saved) return task
      return {
        ...task,
        baselineStartDay: isoToDay(model.epochMs, saved.startDate),
        baselineEndDay: isoToDay(model.epochMs, saved.endDate),
      }
    }),
  }
}

export interface BaselineDeviationSummary {
  early: number
  late: number
  unchanged: number
  added: number
  deleted: number
}

export function summarizeBaselineDeviation(
  model: GanttModel,
  baseline: GanttBaseline | null,
): BaselineDeviationSummary {
  const summary = { early: 0, late: 0, unchanged: 0, added: 0, deleted: 0 }
  if (!baseline) return summary
  const current = new Map(
    model.tasks.filter((task) => task.milestoneId === undefined).map((task) => [task.id, task]),
  )
  const saved = new Map(baseline.snapshot.tasks.map((task) => [task.id, task]))
  for (const [id, task] of current) {
    const before = saved.get(id)
    if (!before) {
      summary.added++
      continue
    }
    const baselineEnd = isoToDay(model.epochMs, before.endDate)
    if (baselineEnd === undefined) {
      summary.unchanged++
      continue
    }
    const currentEnd = task.startDay + Math.max(1, task.durationDays) - 1
    if (currentEnd < baselineEnd) summary.early++
    else if (currentEnd > baselineEnd) summary.late++
    else summary.unchanged++
  }
  for (const id of saved.keys()) {
    if (!current.has(id)) summary.deleted++
  }
  return summary
}
