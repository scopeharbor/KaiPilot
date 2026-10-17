/**
 * 驱动链（按最长依赖链标关键）——新轨甘特「关键路径」开关的主链来源。
 *
 * 严格 CPM（`critical-path.ts`）把任务自身的计划开始日当作「不早于」约束：计划里只要在依赖之间
 * 留了空档，前面整条链就都有浮动，关键路径只剩最后几个任务（演练项目 214 个任务只标出 3 个）。
 * 项目经理想看的是「哪条依赖链决定了完工日」，所以这里从最晚完成的任务出发往回追：
 * 每一步选对它开工约束最晚的前置任务（真正卡住它的那个；并列则都算），直到没有前置为止。
 *
 * 链的起点若晚于项目开工日且没有前置依赖，说明依赖在这里断开（AI 草案常见：后期阶段没连到前期），
 * 通过 `breakTaskIds` 交给界面提示项目经理补依赖。
 *
 * 纯函数、只读，不改模型；汇总行不参与（其子任务已在链上）。
 */

import type { GanttModel, GanttRenderDependency, GanttRenderTask } from './types'

export interface DrivingChain {
  taskIds: ReadonlySet<number>
  depIds: ReadonlySet<number>
  /** 链上没有前置依赖、却晚于项目开工的任务（依赖断点），按开工日升序。 */
  breakTaskIds: readonly number[]
}

export const EMPTY_DRIVING_CHAIN: DrivingChain = {
  taskIds: new Set(),
  depIds: new Set(),
  breakTaskIds: [],
}

const finishDay = (t: GanttRenderTask): number =>
  t.kind === 'milestone' ? t.startDay : t.startDay + Math.max(0, t.durationDays)

/** 前置任务经该依赖给后继施加的「最早开始日」约束（天偏移）。 */
function constraintOf(
  dep: GanttRenderDependency,
  pred: GanttRenderTask,
  succ: GanttRenderTask,
): number {
  const lag = dep.lagDays ?? 0
  const succDuration = succ.kind === 'milestone' ? 0 : Math.max(0, succ.durationDays)
  switch (dep.type) {
    case 'ss':
      return pred.startDay + lag
    case 'ff':
      return finishDay(pred) + lag - succDuration
    case 'sf':
      return pred.startDay + lag - succDuration
    case 'fs':
    default:
      return finishDay(pred) + lag
  }
}

export function computeDrivingChain(model: GanttModel): DrivingChain {
  const tasks = model.tasks.filter((t) => t.kind !== 'summary')
  if (tasks.length === 0 || model.dependencies.length === 0) return EMPTY_DRIVING_CHAIN

  const byId = new Map(tasks.map((t) => [t.id, t]))
  const incoming = new Map<number, GanttRenderDependency[]>()
  for (const dep of model.dependencies) {
    if (!byId.has(dep.predecessorId) || !byId.has(dep.successorId)) continue
    const list = incoming.get(dep.successorId)
    if (list) list.push(dep)
    else incoming.set(dep.successorId, [dep])
  }

  // 终点：有前置依赖的任务里完成最晚的那些（孤立任务不构成「链」，即便它最晚完成）。
  const chained = tasks.filter((t) => (incoming.get(t.id)?.length ?? 0) > 0)
  if (chained.length === 0) return EMPTY_DRIVING_CHAIN
  const chainFinish = Math.max(...chained.map(finishDay))
  const terminals = chained.filter((t) => finishDay(t) === chainFinish)

  const taskIds = new Set<number>()
  const depIds = new Set<number>()
  const breaks: GanttRenderTask[] = []
  const projectStart = Math.min(...tasks.map((t) => t.startDay))
  const stack = terminals.map((t) => t.id)
  while (stack.length > 0) {
    const id = stack.pop()!
    if (taskIds.has(id)) continue
    taskIds.add(id)
    const succ = byId.get(id)!
    const deps = incoming.get(id) ?? []
    if (deps.length === 0) {
      if (succ.startDay > projectStart) breaks.push(succ)
      continue
    }
    let latest = -Infinity
    const scored = deps.map((dep) => {
      const value = constraintOf(dep, byId.get(dep.predecessorId)!, succ)
      if (value > latest) latest = value
      return { dep, value }
    })
    for (const { dep, value } of scored) {
      if (value !== latest) continue
      depIds.add(dep.id)
      stack.push(dep.predecessorId)
    }
  }
  breaks.sort((a, b) => a.startDay - b.startDay)
  return { taskIds, depIds, breakTaskIds: breaks.map((t) => t.id) }
}
