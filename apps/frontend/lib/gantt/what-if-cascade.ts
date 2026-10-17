/**
 * What-if 本地依赖级联顺延（B4 next-gantt-lens W2）—— 纯前端内存派生引擎的级联补充。
 *
 * 后端 `executeCommandsAndPreview` 只重放用户显式命令，不会自动牵引下游；
 * 本模块在命令重放之后做一次确定性的「仅顺延（forward-only）」依赖传导，
 * 使 `derivedPreview` 呈现「前置延期 → 后继任务因 FS/SS/FF/SF 约束自动顺延」的预演效果
 * （对齐 `v3-ui-next-gantt-lens` spec「拖拽排程零写入与本地内存派生」场景：
 * 任务 B 具备 FS 依赖任务 A，A 延后后 B 联动顺延）。
 *
 * 语义边界（与后端两次一致）：
 * - **只向后顺延，绝不提前**：用户显式拖拽提前的任务不会被级联拉回，避免与用户意图对抗；
 * - 整数天粒度、保持各任务自身工期；里程碑（durationDays=0）仅平移当天；
 * - 迭代至不动点，上限 = 任务数 + 1，天然防环（依赖环时最坏情形由上限兜底）；
 * - 纯函数、无副作用、零网络（RL-08）；工作日历的精排由 Apply 阶段的
 *   `POST /gantt/schedule`（mode='preview'）后端权威计算兜底，本地级联仅作即时预演。
 *
 * @file what-if-cascade.ts
 */

import type { GanttRenderDependency, GanttRenderTask } from './types'

/** 任务（含里程碑）的排程结束天（闭区间终点，里程碑=当天）。 */
export function taskEndDay(task: GanttRenderTask): number {
  return task.kind === 'milestone' ? task.startDay : task.startDay + task.durationDays - 1
}

export interface GanttCascadeResult {
  /** 级联后的任务列表（未发生级联时与入参恒等引用，零拷贝）。 */
  tasks: readonly GanttRenderTask[]
  /** 被级联被动顺延的任务 id（不含用户显式命令直接修改的任务）。 */
  shiftedTaskIds: number[]
}

/**
 * 前置依赖约束 → 后继任务的「顺延最小起点」（按依赖类型 + lagDays 推导）。
 * 返回 null 表示该依赖两端任务缺失（防御脏数据，跳过）。
 */
function requiredSuccessorStart(
  taskBy: Map<number, GanttRenderTask>,
  dep: GanttRenderDependency,
): number | null {
  const pred = taskBy.get(dep.predecessorId)
  const succ = taskBy.get(dep.successorId)
  if (!pred || !succ) return null

  const predEnd = taskEndDay(pred)
  const succSpan = succ.kind === 'milestone' ? 0 : succ.durationDays - 1

  switch (dep.type) {
    case 'fs':
      // 后继开始 ≥ 前置结束 + 1 + lag（顺延语义：不足则补满）
      return predEnd + 1 + dep.lagDays
    case 'ss':
      return pred.startDay + dep.lagDays
    case 'ff':
      // 后继结束 ≥ 前置结束 + lag → 后继开始 ≥ predEnd + lag - succSpan
      return predEnd + dep.lagDays - succSpan
    case 'sf':
      // 后继结束 ≥ 前置开始 + lag（罕见类型，宽松处理）
      return pred.startDay + dep.lagDays - succSpan
    default:
      return null
  }
}

/**
 * 对命令重放后的任务集执行「仅顺延」级联传导。
 *
 * 迭代规则：对每条依赖，若后继当前起点早于约束要求的起点，则将后继整体
 * 向后平移差额（保持其自身工期）；平移可能再触发下游，重复至不动点。
 */
export function applyDependencyCascade(
  tasks: readonly GanttRenderTask[],
  dependencies: readonly GanttRenderDependency[],
  maxPasses: number = tasks.length + 1,
): GanttCascadeResult {
  let currentTasks: GanttRenderTask[] = tasks as GanttRenderTask[]
  let changed = false
  const shiftedTaskIds = new Set<number>()

  for (let pass = 0; pass < maxPasses; pass++) {
    let passChanged = false
    const taskBy = new Map(currentTasks.map((t) => [t.id, t]))

    for (const dep of dependencies) {
      const succ = taskBy.get(dep.successorId)
      const required = requiredSuccessorStart(taskBy, dep)
      if (!succ || required === null) continue
      if (succ.startDay < required) {
        const updated: GanttRenderTask = { ...succ, startDay: required }
        currentTasks = currentTasks.map((t) => (t.id === succ.id ? updated : t))
        shiftedTaskIds.add(succ.id)
        passChanged = true
      }
    }

    if (!passChanged) break
    changed = true
  }

  if (!changed) return { tasks, shiftedTaskIds: [] }
  return { tasks: currentTasks, shiftedTaskIds: [...shiftedTaskIds] }
}
