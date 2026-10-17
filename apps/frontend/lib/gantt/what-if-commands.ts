/**
 * What-if 命令处理核心 —— 命令执行、求逆、验证与历史管理。
 *
 * 每个命令在 base snapshot（只读）之上计算 derived preview。
 * undo 使用命令求逆 + cursor 前移。
 *
 * @file what-if-commands.ts
 */

import { backfillCriticalPath } from './critical-path'
import { createWorkingCalendar } from './working-calendar'
import type {
  WhatIfCommand,
  WhatIfMoveTask,
  WhatIfResizeDuration,
  WhatIfAddDependency,
  WhatIfRemoveDependency,
  WhatIfMilestoneMove,
  WhatIfHistory,
  WhatIfBaseSnapshot,
  WhatIfDerivedPreview,
} from './what-if-types'
import type { GanttModel, GanttRenderTask, GanttRenderDependency } from './types'

const MS_PER_DAY = 86_400_000

/**
 * 会话默认时间帧（V2.5 约定固定帧）。`WhatIfBaseSnapshot.epochMs` 缺省时沿用，
 * 保持既有调用方行为不变；B4 甘特镜头由 store 注入真实模型 epochMs 对齐天偏移。
 */
export const WHAT_IF_DEFAULT_EPOCH_MS = Date.UTC(2025, 0, 1)

/** 'YYYY-MM-DD' → UTC 午夜毫秒。 */
function parseIsoMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

// ── 命令执行 ───────────────────────────────────────────────────

/**
 * 在 base snapshot 上执行一条命令，返回受影响的 model + task ids。
 *
 * **不修改** base snapshot 的任何数据；每次都从 base 拷贝出一份浅拷贝树再修改。
 */
export function executeCommandOnSnapshot(
  base: WhatIfBaseSnapshot,
  command: WhatIfCommand,
): { tasks: GanttRenderTask[]; dependencies: GanttRenderDependency[]; affectedIds: number[] } {
  // 从 base 拷贝（浅拷贝——修改时替换引用，不触及其他任务/依赖）。
  const tasks: GanttRenderTask[] = base.tasks.map((t) => ({ ...t }))
  const dependencies: GanttRenderDependency[] = base.dependencies.map((d) => ({ ...d }))
  const affectedIds: number[] = []
  const epochMs = base.epochMs ?? WHAT_IF_DEFAULT_EPOCH_MS

  switch (command.kind) {
    case 'move-task':
      return executeMoveTask(tasks, dependencies, affectedIds, command, epochMs)
    case 'resize-duration':
      return executeResizeDuration(tasks, dependencies, affectedIds, command, epochMs)
    case 'add-dependency':
      return executeAddDependency(tasks, dependencies, affectedIds, command)
    case 'remove-dependency':
      return executeRemoveDependency(tasks, dependencies, affectedIds, command)
    case 'milestone-move':
      return executeMilestoneMove(tasks, dependencies, affectedIds, command, epochMs)
  }
}

function executeMoveTask(
  tasks: GanttRenderTask[],
  dependencies: GanttRenderDependency[],
  affectedIds: number[],
  cmd: WhatIfMoveTask,
  epochMs: number,
) {
  const task = tasks.find((t) => t.id === cmd.taskId)
  if (!task || task.kind === 'milestone') return { tasks, dependencies, affectedIds }

  const newStartMs = parseIsoMs(cmd.newStartDate)
  const newStartDay = Math.floor((newStartMs - epochMs) / MS_PER_DAY)
  // 保持工期不变
  task.startDay = Math.max(0, newStartDay)
  affectedIds.push(cmd.taskId)
  return { tasks, dependencies, affectedIds }
}

function executeResizeDuration(
  tasks: GanttRenderTask[],
  dependencies: GanttRenderDependency[],
  affectedIds: number[],
  cmd: WhatIfResizeDuration,
  epochMs: number,
) {
  const task = tasks.find((t) => t.id === cmd.taskId)
  if (!task || task.kind === 'milestone') return { tasks, dependencies, affectedIds }

  const startMs = parseIsoMs(cmd.newStartDate)
  const endMs = parseIsoMs(cmd.newEndDate)
  const startDay = Math.floor((startMs - epochMs) / MS_PER_DAY)
  const endDay = Math.floor((endMs - epochMs) / MS_PER_DAY)
  task.startDay = Math.max(0, startDay)
  task.durationDays = Math.max(1, endDay - startDay + 1)
  affectedIds.push(cmd.taskId)
  return { tasks, dependencies, affectedIds }
}

function executeAddDependency(
  tasks: GanttRenderTask[],
  dependencies: GanttRenderDependency[],
  affectedIds: number[],
  cmd: WhatIfAddDependency,
) {
  // 检查环：禁止添加会形成环的依赖（BFS 从 successor 出发能否 reach predecessor）。
  if (wouldCreateCycle(dependencies, cmd.predecessorId, cmd.successorId)) {
    return { tasks, dependencies, affectedIds }
  }
  // 检查是否已存在相同方向的依赖
  const exists = dependencies.some(
    (d) => d.predecessorId === cmd.predecessorId && d.successorId === cmd.successorId,
  )
  if (exists) return { tasks, dependencies, affectedIds }

  // 用负 id 作为临时依赖 id（正式依赖 id 只在 Apply 产生）。
  const tempId = -(dependencies.length + 1)
  dependencies.push({
    id: tempId,
    predecessorId: cmd.predecessorId,
    successorId: cmd.successorId,
    type: 'fs',
    lagDays: 0,
  })
  affectedIds.push(cmd.predecessorId, cmd.successorId)
  return { tasks, dependencies, affectedIds }
}

function executeRemoveDependency(
  tasks: GanttRenderTask[],
  dependencies: GanttRenderDependency[],
  affectedIds: number[],
  cmd: WhatIfRemoveDependency,
) {
  const idx = dependencies.findIndex((d) => d.id === cmd.dependencyId)
  if (idx === -1) return { tasks, dependencies, affectedIds }
  dependencies.splice(idx, 1)
  affectedIds.push(cmd.predecessorId, cmd.successorId)
  return { tasks, dependencies, affectedIds }
}

function executeMilestoneMove(
  tasks: GanttRenderTask[],
  dependencies: GanttRenderDependency[],
  affectedIds: number[],
  cmd: WhatIfMilestoneMove,
  epochMs: number,
) {
  const task = tasks.find((t) => t.id === cmd.taskId)
  if (!task || task.kind !== 'milestone') return { tasks, dependencies, affectedIds }

  const newMs = parseIsoMs(cmd.newDate)
  const newDay = Math.floor((newMs - epochMs) / MS_PER_DAY)
  task.startDay = Math.max(0, newDay)
  task.durationDays = 0
  affectedIds.push(cmd.taskId)
  return { tasks, dependencies, affectedIds }
}

// ── 执行命令并计算 Derived Preview ────────────────────────────

/**
 * 对 base snapshot 执行一条命令，返回 derived preview（含 CPM 重算）。
 * 此操作为即时前端计算，不产生后端调用。
 */
export function executeCommandAndPreview(
  base: WhatIfBaseSnapshot,
  command: WhatIfCommand,
): WhatIfDerivedPreview {
  const { tasks, dependencies, affectedIds } = executeCommandOnSnapshot(base, command)

  const epochMs = computeEpochMs(base.tasks as GanttRenderTask[], base.epochMs)
  const milestones = (base.tasks as GanttRenderTask[])
    .filter((t) => t.milestoneId && t.kind === 'milestone')
    .map((t) => ({
      id: t.milestoneId ?? t.id,
      taskId: t.id,
      day: tasks.find((tt) => tt.id === t.id)?.startDay ?? t.startDay,
      name: t.name,
      status: 'planned' as const,
    }))

  const maxEndDay = tasks.reduce((max, t) => Math.max(max, t.startDay + t.durationDays), 0)

  // 先建模型再回填关键路径
  let model: GanttModel = {
    tasks,
    dependencies,
    milestones,
    timeRange: { startDay: 0, endDay: Math.max(1, maxEndDay) },
    epochMs,
  }

  try {
    const calendar = createWorkingCalendar(base.calendarSettings)
    model = backfillCriticalPath(model, calendar)
  } catch {
    // 工作日历失败时跳过 CPM 回填
  }

  const deviationSummary = computeDeviationSummary(base, tasks)

  return { model, affectedTaskIds: affectedIds, deviationSummary }
}

/**
 * 批量执行多条命令，返回最终 derived preview（用于 undo/redo/reset 后的全量重算）。
 */
export function executeCommandsAndPreview(
  base: WhatIfBaseSnapshot,
  commands: WhatIfCommand[],
): WhatIfDerivedPreview {
  let current = base
  let allAffected: number[] = []

  for (const cmd of commands) {
    const { tasks, dependencies, affectedIds } = executeCommandOnSnapshot(current, cmd)
    allAffected = [...allAffected, ...affectedIds]
    current = { ...current, tasks, dependencies }
  }

  const epochMs = computeEpochMs(base.tasks as GanttRenderTask[], base.epochMs)
  const milestones = (base.tasks as GanttRenderTask[])
    .filter((t) => t.milestoneId && t.kind === 'milestone')
    .map((t) => ({
      id: t.milestoneId ?? t.id,
      taskId: t.id,
      day:
        (current.tasks as GanttRenderTask[]).find((tt) => tt.id === t.id)?.startDay ?? t.startDay,
      name: t.name,
      status: 'planned' as const,
    }))

  const maxEndDay = (current.tasks as GanttRenderTask[]).reduce(
    (max, t) => Math.max(max, t.startDay + t.durationDays),
    0,
  )

  let model: GanttModel = {
    tasks: current.tasks as GanttRenderTask[],
    dependencies: current.dependencies as GanttRenderDependency[],
    milestones,
    timeRange: { startDay: 0, endDay: Math.max(1, maxEndDay) },
    epochMs,
  }

  try {
    const calendar = createWorkingCalendar(base.calendarSettings)
    model = backfillCriticalPath(model, calendar)
  } catch {
    // 跳过 CPM
  }

  const deviationSummary = computeDeviationSummary(base, current.tasks as GanttRenderTask[])

  return { model, affectedTaskIds: [...new Set(allAffected)], deviationSummary }
}

// ── 命令求逆（用于 undo） ──────────────────────────────────────

/** 计算一条命令的逆命令。undo 时执行返回的逆命令。 */
export function invertCommand(
  base: WhatIfBaseSnapshot,
  command: WhatIfCommand,
  appliedTasks: Map<number, { startDay: number; durationDays: number }>,
  appliedDeps: Map<number, { predecessorId: number; successorId: number }>,
): WhatIfCommand | null {
  switch (command.kind) {
    case 'move-task':
      return invertMoveTask(command, appliedTasks)
    case 'resize-duration':
      return invertResizeDuration(command, appliedTasks)
    case 'add-dependency':
      return invertAddDependency(command, base, appliedDeps)
    case 'remove-dependency':
      return invertRemoveDependency(command)
    case 'milestone-move':
      return invertMilestoneMove(command, appliedTasks)
  }
}

function invertMoveTask(
  cmd: WhatIfMoveTask,
  appliedTasks: Map<number, { startDay: number; durationDays: number }>,
): WhatIfMoveTask | null {
  // 从 base tasks 找原始日期（base 只读，用之前保存的 snapshot 数据）
  const orig = appliedTasks.get(cmd.taskId)
  if (!orig) return null
  const epochMs = computeEpochMsFromMap(appliedTasks)
  const origDate = new Date(epochMs + orig.startDay * MS_PER_DAY)
  return {
    kind: 'move-task',
    taskId: cmd.taskId,
    newStartDate: origDate.toISOString().slice(0, 10),
  }
}

function invertResizeDuration(
  cmd: WhatIfResizeDuration,
  appliedTasks: Map<number, { startDay: number; durationDays: number }>,
): WhatIfResizeDuration | null {
  const orig = appliedTasks.get(cmd.taskId)
  if (!orig) return null
  const epochMs = computeEpochMsFromMap(appliedTasks)
  const origStart = new Date(epochMs + orig.startDay * MS_PER_DAY)
  const origEnd = new Date(epochMs + (orig.startDay + orig.durationDays - 1) * MS_PER_DAY)
  return {
    kind: 'resize-duration',
    taskId: cmd.taskId,
    newStartDate: origStart.toISOString().slice(0, 10),
    newEndDate: origEnd.toISOString().slice(0, 10),
  }
}

function invertAddDependency(
  cmd: WhatIfAddDependency,
  _base: WhatIfBaseSnapshot,
  _appliedDeps: Map<number, { predecessorId: number; successorId: number }>,
): WhatIfRemoveDependency | null {
  // 在 applied deps 中找到新增的依赖（负 id 为临时）。
  // 返回的 remove-dependency 需要知道 dependencyId。我们从 base 中无法得知生成的 tempId，
  // 所以 add-dependency 的逆是 remove，且 dependencyId 在运行时由 reducer 记录。
  return {
    kind: 'remove-dependency',
    dependencyId: -1, // 运行时替换为实际临时 id
    predecessorId: cmd.predecessorId,
    successorId: cmd.successorId,
  }
}

function invertRemoveDependency(cmd: WhatIfRemoveDependency): WhatIfAddDependency {
  return {
    kind: 'add-dependency',
    predecessorId: cmd.predecessorId,
    successorId: cmd.successorId,
  }
}

function invertMilestoneMove(
  cmd: WhatIfMilestoneMove,
  appliedTasks: Map<number, { startDay: number; durationDays: number }>,
): WhatIfMilestoneMove | null {
  const orig = appliedTasks.get(cmd.taskId)
  if (!orig) return null
  const epochMs = computeEpochMsFromMap(appliedTasks)
  const origDate = new Date(epochMs + orig.startDay * MS_PER_DAY)
  return {
    kind: 'milestone-move',
    milestoneId: cmd.milestoneId,
    taskId: cmd.taskId,
    newDate: origDate.toISOString().slice(0, 10),
  }
}

// ── 环检测 ─────────────────────────────────────────────────────

/** BFS 从 successor 出发探索已有依赖链能否 reach predecessor（存在环则 true）。 */
export function wouldCreateCycle(
  dependencies: GanttRenderDependency[],
  predecessorId: number,
  successorId: number,
): boolean {
  // 构建邻接表：predecessor → [successors]（依赖方向）。
  const adj = new Map<number, number[]>()
  for (const d of dependencies) {
    const list = adj.get(d.predecessorId) ?? []
    list.push(d.successorId)
    adj.set(d.predecessorId, list)
  }
  // BFS 从 successor 出发沿依赖方向走。
  // 如果最终 reach 了 predecessorId，说明新依赖会形成环。
  const visited = new Set<number>()
  const queue = [successorId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === predecessorId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const succ of adj.get(current) ?? []) {
      if (!visited.has(succ)) queue.push(succ)
    }
  }
  return false
}

// ── 命令验证 ───────────────────────────────────────────────────

export interface CommandValidation {
  valid: boolean
  error: string | null
}

/** 验证命令是否合法（仅前端预检——正式校验在 Apply 时由后端完成）。 */
export function validateCommand(
  command: WhatIfCommand,
  taskIds: Set<number>,
  dependencyIds: Set<number>,
): CommandValidation {
  switch (command.kind) {
    case 'move-task':
      if (!taskIds.has(command.taskId))
        return { valid: false, error: `任务 ${command.taskId} 不存在` }
      if (!command.newStartDate) return { valid: false, error: '日期不能为空' }
      return { valid: true, error: null }
    case 'resize-duration':
      if (!taskIds.has(command.taskId))
        return { valid: false, error: `任务 ${command.taskId} 不存在` }
      if (!command.newStartDate || !command.newEndDate)
        return { valid: false, error: '日期不能为空' }
      return { valid: true, error: null }
    case 'add-dependency':
      if (!taskIds.has(command.predecessorId))
        return { valid: false, error: `前置任务 ${command.predecessorId} 不存在` }
      if (!taskIds.has(command.successorId))
        return { valid: false, error: `后续任务 ${command.successorId} 不存在` }
      if (command.predecessorId === command.successorId)
        return { valid: false, error: '不能自依赖' }
      return { valid: true, error: null }
    case 'remove-dependency':
      if (!dependencyIds.has(command.dependencyId))
        return { valid: false, error: `依赖 ${command.dependencyId} 不存在` }
      return { valid: true, error: null }
    case 'milestone-move':
      if (!taskIds.has(command.taskId))
        return { valid: false, error: `里程碑任务 ${command.taskId} 不存在` }
      if (!command.newDate) return { valid: false, error: '日期不能为空' }
      return { valid: true, error: null }
  }
}

// ── 历史管理 ───────────────────────────────────────────────────

/**
 * 添加命令到历史。
 * 新命令截断 redo tail（cursor 之后的条目删除）。
 * 超限时保留最新的 maxEntries 条，并重置 cursor = maxEntries。
 */
export function pushCommand(history: WhatIfHistory, command: WhatIfCommand): WhatIfHistory {
  // 截断 redo tail
  const entries = history.entries.slice(0, history.cursor)
  entries.push(command)

  // 超限压缩
  if (entries.length > history.maxEntries) {
    const excess = entries.length - history.maxEntries
    // 丢弃最旧条目
    entries.splice(0, excess)
    return { ...history, entries, cursor: history.maxEntries }
  }

  return { ...history, entries, cursor: entries.length }
}

/** undo：cursor 前移一位，返回被"撤销"的命令（用于计算逆）。 */
export function undoCommand(history: WhatIfHistory): {
  history: WhatIfHistory
  undone: WhatIfCommand | null
} {
  if (history.cursor <= 0) return { history, undone: null }
  const cursor = history.cursor - 1
  const cmd = history.entries[cursor]
  const undone: WhatIfCommand | null = cmd ?? null
  return { history: { ...history, cursor }, undone }
}

/** redo：cursor 后移一位，返回被"重做"的命令。 */
export function redoCommand(history: WhatIfHistory): {
  history: WhatIfHistory
  redone: WhatIfCommand | null
} {
  if (history.cursor >= history.entries.length) return { history, redone: null }
  const cursor = history.cursor + 1
  const cmd = history.entries[history.cursor]
  const redone: WhatIfCommand | null = cmd ?? null
  return { history: { ...history, cursor }, redone }
}

/** 获取当前已执行的有效命令序列。 */
export function activeCommands(history: WhatIfHistory): WhatIfCommand[] {
  return history.entries.slice(0, history.cursor)
}

// ── 辅助 ───────────────────────────────────────────────────────

function computeEpochMs(_tasks: GanttRenderTask[], epochMs?: number | null): number {
  return epochMs ?? WHAT_IF_DEFAULT_EPOCH_MS
}

function computeEpochMsFromMap(_tasks: Map<number, { startDay: number }>): number {
  return WHAT_IF_DEFAULT_EPOCH_MS
}

function computeDeviationSummary(
  base: WhatIfBaseSnapshot,
  currentTasks: GanttRenderTask[],
): string | null {
  const deviations: string[] = []
  const baseTaskMap = new Map((base.tasks as GanttRenderTask[]).map((t) => [t.id, t]))

  for (const task of currentTasks) {
    const baseTask = baseTaskMap.get(task.id)
    if (!baseTask) continue
    if (baseTask.startDay !== task.startDay) {
      deviations.push(`${task.name}: 开始日变化`)
    }
    if (baseTask.durationDays !== task.durationDays) {
      deviations.push(`${task.name}: 工期变化 (${baseTask.durationDays}→${task.durationDays}d)`)
    }
  }

  return deviations.length > 0 ? deviations.join('；') : null
}
