/**
 * 排期阶段输出抢救与甘特预览确定性推导。
 *
 * 背景（实测）：200+ 任务的项目，排期阶段一次输出数百条依赖（约 4.5 万字符），
 * 模型偶发 JSON 格式错误（malformed_json）→ 整段重跑 3–4 分钟。依赖逐条完整时直接抢救；
 * 甘特预览（起止、总工期、关键路径、阶段数）完全可由任务 + 依赖确定性推导，不必依赖模型。
 */

import { salvageTopLevelArray } from './wbs_tasks_chunked.ts'

type JsonObject = Record<string, unknown>

const DAY_MS = 86_400_000
const DERIVED_MARKER = {
  confidence: 0.9,
  source: 'inferred',
  reason: '由任务排期与依赖确定性推导',
  needsConfirmation: true,
} as const

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markedString(value: unknown): string | null {
  return isObject(value) && typeof value.value === 'string' ? value.value : null
}

function markedNumber(value: unknown): number {
  return isObject(value) && typeof value.value === 'number' && Number.isFinite(value.value)
    ? value.value
    : 0
}

function parseDay(value: string | null): number | null {
  if (!value) return null
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) ? time : null
}

function formatDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** 依赖网上按工期的最长路径（真正的关键路径）；有环或无任务时返回空数组。 */
export function longestPathTaskIds(tasks: JsonObject[], dependencies: JsonObject[]): string[] {
  const ids = tasks.map((task) => String(task.id))
  const duration = new Map(tasks.map((task) => [String(task.id), markedNumber(task.durationDays)]))
  const predecessors = new Map<string, string[]>(ids.map((id) => [id, []]))
  const successors = new Map<string, string[]>(ids.map((id) => [id, []]))
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const dependency of dependencies) {
    const from = String(dependency.predecessorId)
    const to = String(dependency.successorId)
    if (!duration.has(from) || !duration.has(to) || from === to) continue
    predecessors.get(to)!.push(from)
    successors.get(from)!.push(to)
    indegree.set(to, indegree.get(to)! + 1)
  }
  const queue = ids.filter((id) => indegree.get(id) === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const next of successors.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== ids.length || order.length === 0) return []

  const finish = new Map<string, number>()
  const via = new Map<string, string | null>()
  for (const id of order) {
    let best: string | null = null
    for (const pred of predecessors.get(id)!) {
      if (best === null || finish.get(pred)! > finish.get(best)!) best = pred
    }
    finish.set(id, (best === null ? 0 : finish.get(best)!) + duration.get(id)!)
    via.set(id, best)
  }
  let tail = order[0]
  for (const id of order) if (finish.get(id)! > finish.get(tail)!) tail = id
  const path: string[] = []
  for (let current: string | null = tail; current !== null; current = via.get(current) ?? null) {
    path.unshift(current)
  }
  return path
}

/**
 * 依赖网上按工期（工作日）的最长链长度与链上任务（只计 FS 语义 + lag，SS/FF/SF 按 FS 保守估计）。
 * 有环时返回 null。用于判断模型给的依赖是否把本该并行的工作串成了一条过长的链。
 */
export function longestChainWorkdays(
  tasks: JsonObject[],
  dependencies: JsonObject[],
): { workdays: number; taskIds: string[] } | null {
  const chain = longestPathTaskIds(tasks, dependencies)
  if (chain.length === 0) return tasks.length === 0 ? { workdays: 0, taskIds: [] } : null
  const duration = new Map(tasks.map((task) => [String(task.id), markedNumber(task.durationDays)]))
  const lag = new Map(
    dependencies.map((dependency) => [
      `${String(dependency.predecessorId)}>${String(dependency.successorId)}`,
      markedNumber(dependency.lagDays),
    ]),
  )
  let workdays = 0
  chain.forEach((id, index) => {
    workdays += duration.get(id) ?? 0
    if (index > 0) workdays += Math.max(0, lag.get(`${chain[index - 1]}>${id}`) ?? 0)
  })
  return { workdays, taskIds: chain }
}

/** 由任务与依赖确定性推导甘特预览（总工期按日历天，HL-001 同时接受日历天 / 工作日口径）。 */
export function deriveGanttPreview(
  tasks: JsonObject[],
  dependencies: JsonObject[],
  wbs: unknown[],
): JsonObject | null {
  const starts = tasks
    .map((task) => parseDay(markedString(task.startDate)))
    .filter((time): time is number => time !== null)
  const ends = tasks
    .map((task) => parseDay(markedString(task.endDate)))
    .filter((time): time is number => time !== null)
  if (starts.length === 0 || ends.length === 0) return null
  const first = Math.min(...starts)
  const last = Math.max(...ends)
  return {
    startDate: { value: formatDay(first), marker: DERIVED_MARKER },
    endDate: { value: formatDay(last), marker: DERIVED_MARKER },
    totalDurationDays: {
      value: Math.max(0, Math.round((last - first) / DAY_MS) + 1),
      marker: DERIVED_MARKER,
    },
    criticalPathTaskIds: longestPathTaskIds(tasks, dependencies),
    phaseCount: wbs.filter((node) => isObject(node) && node.parentId == null).length,
  }
}

/**
 * JSON 解析失败时抢救排期阶段产物：依赖逐条完整才接受，甘特预览一律确定性推导。
 * 返回 null 表示无法抢救（照常走重试）。
 */
export function salvageScheduleOutput(
  raw: string,
  aggregate: Record<string, unknown>,
): { dependencies: unknown[]; ganttPreview: JsonObject } | null {
  const dependencies = salvageTopLevelArray(raw, 'dependencies')
  if (!dependencies || dependencies.length === 0) return null
  const tasks = Array.isArray(aggregate.tasks) ? aggregate.tasks.filter(isObject) : []
  const wbs = Array.isArray(aggregate.wbs) ? aggregate.wbs : []
  const ganttPreview = deriveGanttPreview(tasks, dependencies.filter(isObject), wbs)
  return ganttPreview ? { dependencies, ganttPreview } : null
}
