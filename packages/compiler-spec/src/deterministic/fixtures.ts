/**
 * Deterministic Engine Fixtures —— 测试夹具数据。
 *
 * 提供各类测试场景的标准化输入数据，供 graph validator、schedule、
 * critical path、resource load 等 engine 使用。
 *
 * @aiproj/compiler-spec
 */

import type {
  Dependency,
  ResourceLoadInput,
  ScheduleResult,
  TaskDependency,
  WorkingCalendar,
} from '../deterministic.js'

// ── Calendar ──

/** 标准工作日历（周一至周五，无节假日）。 */
export const standardCalendar: WorkingCalendar = {
  calendarId: 'default',
  workingDays: [1, 2, 3, 4, 5],
  excludedDates: [],
}

/** 含节假日的日历。 */
export const holidayCalendar: WorkingCalendar = {
  calendarId: 'holiday',
  workingDays: [1, 2, 3, 4, 5],
  excludedDates: ['2026-01-01', '2026-05-01', '2026-10-01'],
}

// ── Fixture: 最小项目（单一任务） ──

/** 最小项目：一个任务，无依赖。 */
export const minimalProject: Record<string, TaskDependency> = {
  task_1: { id: 'task_1', duration: 3, dependsOn: [] },
}

/** 最小项目预期 schedule（假设从 2026-07-13 周一）。 */
export const minimalProjectExpectedSchedule: Record<
  string,
  { plannedStart: string; plannedEnd: string; durationWorkingDays: number }
> = {
  task_1: { plannedStart: '2026-07-13', plannedEnd: '2026-07-15', durationWorkingDays: 3 },
}

// ── Fixture: 线性依赖 ──

/** 三任务线性依赖链：A -> B -> C。 */
export const linearChain: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 2, dependsOn: [] },
  task_B: { id: 'task_B', duration: 3, dependsOn: ['task_A'] },
  task_C: { id: 'task_C', duration: 1, dependsOn: ['task_B'] },
}

/** 线性依赖对应 dependencies 数组。 */
export const linearChainDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
  { predecessorId: 'task_B', successorId: 'task_C', type: 'FS', lag: 0 },
]

/** 线性依赖预期。 */
export const linearChainExpectedSchedule: Record<
  string,
  { plannedStart: string; plannedEnd: string; durationWorkingDays: number }
> = {
  task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14', durationWorkingDays: 2 },
  task_B: { plannedStart: '2026-07-15', plannedEnd: '2026-07-17', durationWorkingDays: 3 },
  task_C: { plannedStart: '2026-07-20', plannedEnd: '2026-07-20', durationWorkingDays: 1 },
}

// ── Fixture: 并行非关键路径 ──

/** 四任务：A -> B, C ；B 和 C 并行，B 更长。 */
export const parallelNonCritical: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 1, dependsOn: [] },
  task_B: { id: 'task_B', duration: 5, dependsOn: ['task_A'] },
  task_C: { id: 'task_C', duration: 2, dependsOn: ['task_A'] },
  task_D: { id: 'task_D', duration: 1, dependsOn: ['task_B', 'task_C'] },
}

export const parallelNonCriticalDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
  { predecessorId: 'task_A', successorId: 'task_C', type: 'FS', lag: 0 },
  { predecessorId: 'task_B', successorId: 'task_D', type: 'FS', lag: 0 },
  { predecessorId: 'task_C', successorId: 'task_D', type: 'FS', lag: 0 },
]

/** 并行非关键路径预期关键路径。 */
export const parallelNonCriticalExpectedCriticalPathIds = ['task_A', 'task_B', 'task_D']

// ── Fixture: 依赖环 ──

/** A -> B -> A 的环。 */
export const cycleGraph: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 1, dependsOn: ['task_B'] },
  task_B: { id: 'task_B', duration: 1, dependsOn: ['task_A'] },
}

export const cycleGraphDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
  { predecessorId: 'task_B', successorId: 'task_A', type: 'FS', lag: 0 },
]

/** 自环：A -> A。 */
export const selfCycle: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 1, dependsOn: ['task_A'] },
}

// ── Fixture: 缺失节点 ──

/** B 依赖不存在的任务 C。 */
export const missingNode: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 2, dependsOn: [] },
  task_B: { id: 'task_B', duration: 1, dependsOn: ['task_A', 'task_NONEXISTENT'] },
}

export const missingNodeDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
]

// ── Fixture: 重复 ID ──

/** 同一 ID 出现在任务 A 和另一个任务 X 中（通过 deps 模拟）。 */
export const duplicateId: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 2, dependsOn: [] },
  task_A2: { id: 'task_A', duration: 1, dependsOn: ['task_A'] },
}

// ── Fixture: 周末跳过 ──

/** 周五开始 2 工作日 → 应跨周末到周二。 */
export const weekendSkip: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 2, dependsOn: [] },
  task_B: { id: 'task_B', duration: 3, dependsOn: ['task_A'] },
}

export const weekendSkipDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
]

// ── Fixture: 显式开始日期 ──

export const explicitStart: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 1, dependsOn: [], explicitStart: '2026-08-01' },
  task_B: { id: 'task_B', duration: 2, dependsOn: ['task_A'] },
}

export const explicitStartDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: 0 },
]

// ── Fixture: 资源超载 ──

export const resourceOverloadInput: ResourceLoadInput = {
  capacities: { dev_1: 8, dev_2: 8 },
  assignments: {
    task_A: 'dev_1',
    task_B: 'dev_1',
    task_C: 'dev_1',
    task_D: 'dev_2',
  },
  schedules: {
    task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
    task_B: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
    task_C: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' },
    task_D: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
  },
}

// ── Fixture: 多起点多终点 ──

/** A, B 无起点依赖；X, Y 无后继；Z 在中间。 */
export const multiStartEnd: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 1, dependsOn: [] },
  task_B: { id: 'task_B', duration: 2, dependsOn: [] },
  task_Z: { id: 'task_Z', duration: 1, dependsOn: ['task_A', 'task_B'] },
  task_X: { id: 'task_X', duration: 1, dependsOn: ['task_Z'] },
  task_Y: { id: 'task_Y', duration: 2, dependsOn: ['task_Z'] },
}

export const multiStartEndDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_Z', type: 'FS', lag: 0 },
  { predecessorId: 'task_B', successorId: 'task_Z', type: 'FS', lag: 0 },
  { predecessorId: 'task_Z', successorId: 'task_X', type: 'FS', lag: 0 },
  { predecessorId: 'task_Z', successorId: 'task_Y', type: 'FS', lag: 0 },
]

// ── Fixture: SS/FF/SF 依赖 ──

export const ssffDeps: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 5, dependsOn: [] },
  task_B: {
    id: 'task_B',
    duration: 3,
    dependsOn: [],
    dependencies: [{ predecessorId: 'task_A', successorId: 'task_B', type: 'SS', lag: 2 }],
  },
  task_C: {
    id: 'task_C',
    duration: 4,
    dependsOn: [],
    dependencies: [{ predecessorId: 'task_A', successorId: 'task_C', type: 'FF', lag: 1 }],
  },
}

export const ssffDepsArray: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'SS', lag: 2 },
  { predecessorId: 'task_A', successorId: 'task_C', type: 'FF', lag: 1 },
]

// ── Fixture: 负 lag ──

export const negativeLag: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 5, dependsOn: [] },
  task_B: {
    id: 'task_B',
    duration: 3,
    dependsOn: ['task_A'],
    dependencies: [{ predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: -2 }],
  },
}

export const negativeLagDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_B', type: 'FS', lag: -2 },
]

// ── Fixture: Milestone ──

export const milestoneProject: Record<string, TaskDependency> = {
  task_A: { id: 'task_A', duration: 2, dependsOn: [] },
  task_M: { id: 'task_M', duration: 0, isMilestone: true, dependsOn: ['task_A'] },
  task_C: { id: 'task_C', duration: 3, dependsOn: ['task_M'] },
}

export const milestoneProjectDeps: Dependency[] = [
  { predecessorId: 'task_A', successorId: 'task_M', type: 'FS', lag: 0 },
  { predecessorId: 'task_M', successorId: 'task_C', type: 'FS', lag: 0 },
]

// ── Fixture: 1000 任务 Baseline ──

/**
 * 生成 1000 任务 baseline 数据。
 * 结构：10 条链，每条 100 任务，中间有少量交叉依赖。
 */
export function generateBaseline1000(): {
  tasks: Record<string, TaskDependency>
  deps: Dependency[]
} {
  const tasks: Record<string, TaskDependency> = {}
  const deps: Dependency[] = []

  for (let chain = 0; chain < 10; chain++) {
    let prevId: string | null = null
    for (let i = 0; i < 100; i++) {
      const taskId = `chain_${chain}_task_${i}`
      const dependsOn: string[] = []
      if (prevId) dependsOn.push(prevId)
      // 每 10 个任务加一条交叉依赖到下一链
      if (i % 10 === 0 && chain < 9) {
        dependsOn.push(`chain_${chain + 1}_task_${Math.max(0, i - 5)}`)
      }
      tasks[taskId] = { id: taskId, duration: 1 + (i % 5), dependsOn }
      if (prevId) {
        deps.push({ predecessorId: prevId, successorId: taskId, type: 'FS', lag: 0 })
      }
      prevId = taskId
    }
  }

  return { tasks, deps }
}

// ── Schedule result fixtures ──

export const minimalScheduleResult: ScheduleResult = {
  scheduled: {
    task_1: {
      taskId: 'task_1',
      plannedStart: '2026-07-13',
      plannedEnd: '2026-07-15',
      durationWorkingDays: 3,
      blocked: false,
    },
  },
  blocked: false,
  unscheduledTaskIds: [],
  warnings: [],
}

export const linearChainScheduleResult: ScheduleResult = {
  scheduled: {
    task_A: {
      taskId: 'task_A',
      plannedStart: '2026-07-13',
      plannedEnd: '2026-07-14',
      durationWorkingDays: 2,
      blocked: false,
    },
    task_B: {
      taskId: 'task_B',
      plannedStart: '2026-07-15',
      plannedEnd: '2026-07-17',
      durationWorkingDays: 3,
      blocked: false,
    },
    task_C: {
      taskId: 'task_C',
      plannedStart: '2026-07-20',
      plannedEnd: '2026-07-20',
      durationWorkingDays: 1,
      blocked: false,
    },
  },
  blocked: false,
  unscheduledTaskIds: [],
  warnings: [],
}
