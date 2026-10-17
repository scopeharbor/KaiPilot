/**
 * 甘特关键路径法（CPM）计算核 —— 前端纯函数（T021 / sec13 T021）。
 *
 * 排程的「另一面」：前向算最早（ES/EF）、后向算最晚（LS/LF）、差额即浮动（totalFloat=LS−ES）。
 * 零浮动任务为关键，连接关键任务且边浮动为 0 的依赖为关键依赖。工作日空间运算
 * （周末/节假日不产生浮动），与 T020 排程语义一致。
 *
 * 算法与后端 `gantt_scheduling_engine.topologicalOrder`/`requiredStart` 同构（design D5）——
 * 前后端模块系统不同不能直接 import，但语义须等价，由对齐测试守门。
 *
 * 降级（design D7）：环/空集返回 `{ ok:false, reason }` 且全部 isCritical=false，不抛、不阻塞渲染。
 * 汇总任务排除（design D9）；里程碑零工期作为节点正常参与传递。
 */

import {
  endFromStart,
  shiftWorkingDays,
  snapToWorkingDay,
  startFromEnd,
  workingDayDuration,
  type WorkingCalendar,
} from './working-calendar'
import type { DependencyType, GanttModel } from './types'

const CPM_DAY_MS = 86_400_000

/**
 * 把 CPM 结果回填进渲染模型（design D4）：从 `GanttModel` 的天偏移 + epochMs 重算工作日工期
 * （不复用语义模糊的 `durationDays` 字段），调用记忆化 CPM，写回 `isCritical`/`isOnLongestPath`/
 * `totalFloat` 与依赖 `isCritical`。环/空时全部留 false，不阻塞渲染。
 *
 * 就地修改并返回同一 model（模型每次重建为新对象，调用点不持有旧引用）。
 */
export function backfillCriticalPath(model: GanttModel, calendar: WorkingCalendar): GanttModel {
  const cpmTasks: CpmTaskInput[] = model.tasks.map((t) => {
    const startMs = model.epochMs + t.startDay * CPM_DAY_MS
    const spanDays = t.kind === 'milestone' ? 0 : Math.max(t.durationDays - 1, 0)
    const endMs = model.epochMs + (t.startDay + spanDays) * CPM_DAY_MS
    const taskType: CpmTaskType =
      t.kind === 'milestone' ? 'milestone' : t.kind === 'summary' ? 'summary' : 'task'
    return { taskId: t.id, startMs, endMs, taskType }
  })
  const cpmDeps: CpmDependencyInput[] = model.dependencies.map((d) => ({
    depId: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type as DependencyType,
    lagDays: d.lagDays,
  }))

  const result = memoizedComputeCriticalPath(cpmTasks, cpmDeps, calendar)

  for (const task of model.tasks) {
    const r = result.tasks.get(task.id)
    if (r) {
      task.isCritical = r.isCritical
      task.isOnLongestPath = r.isOnLongestPath
      task.totalFloat = r.totalFloat
    } else {
      // 汇总任务或被排除：不描红（其子任务条已描红，信息不丢——design D9）。
      task.isCritical = false
      task.isOnLongestPath = false
      task.totalFloat = undefined
    }
  }
  for (const dep of model.dependencies) {
    dep.isCritical = result.deps.get(dep.id) ?? false
  }
  return model
}

export type CpmTaskType = 'task' | 'milestone' | 'summary'

export interface CpmTaskInput {
  taskId: number
  startMs: number
  endMs: number
  taskType: CpmTaskType
}

export interface CpmDependencyInput {
  depId: number
  predecessorId: number
  successorId: number
  type: DependencyType
  lagDays: number
}

export interface CpmTaskResult {
  isCritical: boolean
  isOnLongestPath: boolean
  totalFloat: number
}

export type CpmResult =
  | { ok: true; tasks: Map<number, CpmTaskResult>; deps: Map<number, boolean> }
  | {
      ok: false
      reason: 'CYCLE' | 'EMPTY'
      tasks: Map<number, CpmTaskResult>
      deps: Map<number, boolean>
    }

interface ResolvedTask {
  id: number
  startMs: number
  endMs: number
  /** 工作日工期：里程碑 0、其它 ≥1。 */
  duration: number
  isMilestone: boolean
  es: number
  ef: number
  ls: number
  lf: number
}

interface ResolvedDependency {
  depId: number
  predecessorId: number
  successorId: number
  type: DependencyType
  lagDays: number
}

const EMPTY_TASKS = new Map<number, CpmTaskResult>()
const EMPTY_DEPS = new Map<number, boolean>()

function emptyResult(reason: 'CYCLE' | 'EMPTY'): CpmResult {
  return { ok: false, reason, tasks: EMPTY_TASKS, deps: EMPTY_DEPS }
}

/** 工期 0 的里程碑安全反推：d≤1 时直接返回锚点，避免 startFromEnd/endFromStart 要求 ≥1。 */
function startFromEndSafe(cal: WorkingCalendar, end: number, d: number): number {
  return d <= 0 ? end : startFromEnd(cal, end, d)
}

function endFromStartSafe(cal: WorkingCalendar, start: number, d: number): number {
  return d <= 0 ? start : endFromStart(cal, start, d)
}

/**
 * 后继最早开始（与后端 `requiredStart` 等价，design D5）。
 * FS：前置结束 + 1 工作日 + lag；SS：前置开始 + lag；
 * FF：前置结束 + lag 后反推开始；SF：前置开始 + lag 后反推开始。
 */
function earliestStartOfSuccessor(
  cal: WorkingCalendar,
  dep: ResolvedDependency,
  predecessor: ResolvedTask,
  successorDuration: number,
): number {
  switch (dep.type) {
    case 'fs':
      return shiftWorkingDays(cal, predecessor.ef, dep.lagDays + 1)
    case 'ss':
      return shiftWorkingDays(cal, predecessor.es, dep.lagDays)
    case 'ff': {
      const requiredEnd = shiftWorkingDays(cal, predecessor.ef, dep.lagDays)
      return startFromEndSafe(cal, requiredEnd, successorDuration)
    }
    case 'sf': {
      const requiredEnd = shiftWorkingDays(cal, predecessor.es, dep.lagDays)
      return startFromEndSafe(cal, requiredEnd, successorDuration)
    }
  }
}

/**
 * 后向传递：由后继 LS/LF 反推前置最晚允许 LS（design D6 对称约束）。
 * FS：pred_LF ≤ succ_LS − 1 − lag；SS：pred_LS ≤ succ_LS − lag；
 * FF：pred_LF ≤ succ_LF − lag；SF：pred_LS ≤ succ_LF − lag。
 */
function latestStartOfPredecessor(
  cal: WorkingCalendar,
  dep: ResolvedDependency,
  predecessor: ResolvedTask,
  successor: ResolvedTask,
): number {
  switch (dep.type) {
    case 'fs': {
      const predLfBound = shiftWorkingDays(cal, successor.ls, -dep.lagDays - 1)
      return startFromEndSafe(cal, predLfBound, predecessor.duration)
    }
    case 'ss':
      return shiftWorkingDays(cal, successor.ls, -dep.lagDays)
    case 'ff': {
      const predLfBound = shiftWorkingDays(cal, successor.lf, -dep.lagDays)
      return startFromEndSafe(cal, predLfBound, predecessor.duration)
    }
    case 'sf':
      return shiftWorkingDays(cal, successor.lf, -dep.lagDays)
  }
}

/** Kahn BFS 拓扑排序 + 环检测（与后端 `topologicalOrder` 同构）。 */
function topologicalOrder(
  taskIds: Set<number>,
  dependencies: ResolvedDependency[],
): { order: number[]; cycle: boolean } {
  const indegree = new Map<number, number>([...taskIds].map((id) => [id, 0]))
  const outgoing = new Map<number, number[]>()
  for (const dep of dependencies) {
    if (!taskIds.has(dep.predecessorId) || !taskIds.has(dep.successorId)) continue
    indegree.set(dep.successorId, (indegree.get(dep.successorId) ?? 0) + 1)
    outgoing.set(dep.predecessorId, [...(outgoing.get(dep.predecessorId) ?? []), dep.successorId])
  }
  const queue = [...taskIds].filter((id) => indegree.get(id) === 0).sort((a, b) => a - b)
  const order: number[] = []
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]!
    order.push(current)
    for (const next of outgoing.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1
      indegree.set(next, degree)
      if (degree === 0) queue.push(next)
    }
  }
  return { order, cycle: order.length !== taskIds.size }
}

/**
 * 归一化输入：排除汇总任务；去重依赖；跳过自环、端点缺失、端点为汇总任务的依赖。
 * 返回参与 CPM 的任务集与依赖集（仅含非汇总任务）。
 */
function normalize(
  calendar: WorkingCalendar,
  input: {
    tasks: readonly CpmTaskInput[]
    dependencies: readonly CpmDependencyInput[]
  },
): { tasks: Map<number, ResolvedTask>; deps: ResolvedDependency[] } {
  const tasks = new Map<number, ResolvedTask>()
  for (const t of input.tasks) {
    if (t.taskType === 'summary') continue
    const isMilestone = t.taskType === 'milestone'
    const duration = isMilestone ? 0 : workingDayDuration(calendar, t.startMs, t.endMs)
    tasks.set(t.taskId, {
      id: t.taskId,
      startMs: t.startMs,
      endMs: t.endMs,
      duration,
      isMilestone,
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
    })
  }
  const seen = new Set<string>()
  const deps: ResolvedDependency[] = []
  for (const d of input.dependencies) {
    if (d.predecessorId === d.successorId) continue // 自环
    if (!tasks.has(d.predecessorId) || !tasks.has(d.successorId)) continue // 端点缺失或为汇总任务
    const key = `${d.depId}`
    if (seen.has(key)) continue // 重复依赖按 id 去重
    seen.add(key)
    deps.push({
      depId: d.depId,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
    })
  }
  return { tasks, deps }
}

/**
 * CPM 双传递主入口。纯函数、无副作用。
 * 输入归一化后：拓扑排序 → 前向（ES/EF）→ 后向（LS/LF）→ 浮动 → 关键标记。
 */
export function computeCriticalPath(
  tasks: readonly CpmTaskInput[],
  dependencies: readonly CpmDependencyInput[],
  calendar: WorkingCalendar,
): CpmResult {
  const { tasks: resolved, deps } = normalize(calendar, { tasks, dependencies })
  if (resolved.size === 0) return emptyResult('EMPTY')

  const taskIds = new Set(resolved.keys())
  const topo = topologicalOrder(taskIds, deps)
  if (topo.cycle) {
    // 环：全部不标记关键，返回结构化警示。
    const taskResults = new Map<number, CpmTaskResult>()
    for (const id of resolved.keys()) {
      taskResults.set(id, { isCritical: false, isOnLongestPath: false, totalFloat: 0 })
    }
    return {
      ok: false,
      reason: 'CYCLE',
      tasks: taskResults,
      deps: new Map(deps.map((d) => [d.depId, false])),
    }
  }

  const incoming = new Map<number, ResolvedDependency[]>()
  const outgoing = new Map<number, ResolvedDependency[]>()
  for (const dep of deps) {
    outgoing.set(dep.predecessorId, [...(outgoing.get(dep.predecessorId) ?? []), dep])
    incoming.set(dep.successorId, [...(incoming.get(dep.successorId) ?? []), dep])
  }

  // 前向传递：ES/EF。无前置者 ES=自身开始日（吸附工作日）；有前置者取 max(自身, 各依赖推算)。
  for (const id of topo.order) {
    const task = resolved.get(id)!
    const ownStart = snapToWorkingDay(calendar, task.startMs, 1)
    let es = ownStart
    const inbound = incoming.get(id) ?? []
    for (const dep of inbound) {
      const pred = resolved.get(dep.predecessorId)!
      const required = earliestStartOfSuccessor(calendar, dep, pred, task.duration)
      if (required > es) es = required
    }
    task.es = es
    task.ef = task.isMilestone ? es : endFromStartSafe(calendar, es, task.duration)
  }

  // 合同工期锚点＝所有任务 EF 的最大值（design D6：尽早工期＝合同工期）。
  let projectDeadline = 0
  for (const task of resolved.values()) {
    if (task.ef > projectDeadline) projectDeadline = task.ef
  }

  // 后向传递：LS/LF。初始化 LF=锚点；逆拓扑序由后继约束推前置最晚 LS。
  for (const task of resolved.values()) {
    task.lf = projectDeadline
    task.ls = task.isMilestone ? task.lf : startFromEndSafe(calendar, task.lf, task.duration)
  }
  for (const id of [...topo.order].reverse()) {
    const pred = resolved.get(id)
    if (!pred) continue
    const outbound = outgoing.get(id) ?? []
    for (const dep of outbound) {
      const succ = resolved.get(dep.successorId)
      if (!succ) continue
      const latest = latestStartOfPredecessor(calendar, dep, pred, succ)
      if (latest < pred.ls) {
        pred.ls = latest
        pred.lf = pred.isMilestone ? latest : endFromStartSafe(calendar, latest, pred.duration)
      }
    }
  }

  // 浮动与关键标记。totalFloat = 工作日(ES, LS) − 1（ES==LS → 0）。
  const taskResults = new Map<number, CpmTaskResult>()
  for (const task of resolved.values()) {
    const float = task.ls <= task.es ? 0 : workingDayDuration(calendar, task.es, task.ls) - 1
    const isCritical = float <= 0
    taskResults.set(task.id, {
      isCritical,
      isOnLongestPath: isCritical,
      totalFloat: float,
    })
  }

  // 关键依赖识别：两端均关键 且 边浮动（后继 ES − 该依赖推算的最早开始）为 0。
  const depResults = new Map<number, boolean>()
  for (const dep of deps) {
    const pred = resolved.get(dep.predecessorId)!
    const succ = resolved.get(dep.successorId)!
    const predResult = taskResults.get(dep.predecessorId)!
    const succResult = taskResults.get(dep.successorId)!
    if (!predResult.isCritical || !succResult.isCritical) {
      depResults.set(dep.depId, false)
      continue
    }
    const required = earliestStartOfSuccessor(calendar, dep, pred, succ.duration)
    const edgeFloat = succ.es <= required ? 0 : workingDayDuration(calendar, required, succ.es) - 1
    depResults.set(dep.depId, edgeFloat <= 0)
  }

  return { ok: true, tasks: taskResults, deps: depResults }
}

/**
 * 轻量签名 hash（design D8）：任务 id+起止日、依赖 id+type+lag、日历 workdays+holidays。
 * 仅滚动/视口变化不改签名→复用；拖拽改日期/增删依赖/改日历→重算。
 */
function signatureOf(
  tasks: readonly CpmTaskInput[],
  dependencies: readonly CpmDependencyInput[],
  calendar: WorkingCalendar,
): string {
  const taskPart = tasks.map((t) => `${t.taskId}:${t.taskType}:${t.startMs}:${t.endMs}`).join('|')
  const depPart = dependencies
    .map((d) => `${d.depId}:${d.predecessorId}:${d.successorId}:${d.type}:${d.lagDays}`)
    .join('|')
  const calPart = `${[...calendar.workdays].join(',')}/${[...calendar.holidays].join(',')}`
  return `${tasks.length}#${taskPart}#${dependencies.length}#${depPart}#${calPart}`
}

interface MemoEntry {
  signature: string
  result: CpmResult
}

let memoEntry: MemoEntry | null = null

/**
 * 记忆化包装：签名命中则复用同结果引用（design D8，对齐 `visibleDayRange` 记忆化策略）。
 * 单槽缓存即可覆盖渲染模型重建场景——模型每次重建只产生一个新签名。
 */
export function memoizedComputeCriticalPath(
  tasks: readonly CpmTaskInput[],
  dependencies: readonly CpmDependencyInput[],
  calendar: WorkingCalendar,
): CpmResult {
  const signature = signatureOf(tasks, dependencies, calendar)
  if (memoEntry && memoEntry.signature === signature) return memoEntry.result
  const result = computeCriticalPath(tasks, dependencies, calendar)
  memoEntry = { signature, result }
  return result
}

/** 仅供测试重置缓存。 */
export function __resetCriticalPathMemo(): void {
  memoEntry = null
}
