/**
 * 甘特渲染核 —— M0 确定性数据集 → 运行时渲染模型的适配器（**仅供 dev 性能 harness**）。
 *
 * 真实项目数据由 API 组装层（task 2.1）产出；本适配器把 `lib/gantt-m0/dataset.ts` 的确定性
 * 1000 任务集（CI 性能回归基线，design D10）转成 `GanttModel`，用于完整图元下的最差帧复测。
 *
 * 转换：①依赖类型大小写归一（M0 用 FS/SS/FF/SF，运行时用小写 fs/ss/ff/sf）②由 parentId 派生
 * summary/里程碑 kind ③合成负责人（简化入口头像）④关键路径由 CPM 真算（T021），不再用占位链。
 */

import { buildGanttM0Dataset } from '@/lib/gantt-m0/dataset'
import type { GanttSpec } from '@/lib/gantt-m0/types'
import { backfillCriticalPath } from './critical-path'
import { createWorkingCalendar } from './working-calendar'
import { CHART_EPOCH_MS } from './geometry'
import type {
  DependencyType,
  GanttModel,
  GanttRenderDependency,
  GanttRenderTask,
  GanttRowKind,
  MilestoneStatus,
} from './types'

function lowerDep(type: string): DependencyType {
  return type.toLowerCase() as DependencyType
}

/** 由 id 确定性合成负责人（简化入口头像用）。 */
function assigneeFor(id: number): { id: number; initials: string; name: string } {
  const n = (id % 12) + 1
  return { id: n, initials: `M${n}`, name: `成员${n}` }
}

/** M0 `GanttSpec` → 运行时 `GanttModel`。 */
export function m0SpecToModel(spec: GanttSpec): GanttModel {
  const parentIds = new Set<number>()
  for (const t of spec.tasks) {
    if (t.parentId !== null) parentIds.add(t.parentId)
  }

  const tasks: GanttRenderTask[] = spec.tasks.map((t) => {
    const kind: GanttRowKind = t.isMilestone
      ? 'milestone'
      : parentIds.has(t.id)
        ? 'summary'
        : 'task'
    return {
      id: t.id,
      name: t.name,
      wbsCode: t.wbsCode,
      depth: t.depth,
      parentId: t.parentId,
      kind,
      startDay: t.startDay,
      durationDays: t.durationDays,
      progress: t.progress,
      status: t.status,
      assignee: assigneeFor(t.id),
    }
  })

  const dependencies: GanttRenderDependency[] = spec.dependencies.map((d) => ({
    id: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: lowerDep(d.type),
    lagDays: d.lagDays,
  }))

  const milestones = spec.milestones.map((m) => {
    const task = spec.tasks[m.taskId]
    const status: MilestoneStatus =
      task?.status === 'completed'
        ? 'achieved'
        : task?.status === 'blocked' || task?.status === 'on_hold'
          ? 'at_risk'
          : task?.status === 'cancelled'
            ? 'missed'
            : task?.status === 'in_progress'
              ? 'planned'
              : 'not_started'
    return {
      id: m.id,
      taskId: m.taskId,
      day: m.day,
      name: task?.name ?? `里程碑 ${m.id}`,
      status,
    }
  })

  // M0 无项目日历设置，用默认 Mon-Fri；关键路径由 CPM 真算（T021）。
  return backfillCriticalPath(
    {
      tasks,
      dependencies,
      milestones,
      timeRange: spec.timeRange,
      epochMs: CHART_EPOCH_MS,
    },
    createWorkingCalendar(),
  )
}

/** 便捷入口：按 seed 直接产出渲染模型。 */
export function buildGanttModelFromSeed(seed: number): GanttModel {
  return m0SpecToModel(buildGanttM0Dataset(seed))
}
