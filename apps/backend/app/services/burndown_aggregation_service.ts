/**
 * v3-chart-gallery-data-foundation —— BurndownAggregationService（W4.3）。
 *
 * 项目级燃尽/燃起（Burndown/Burnup）日时序聚合引擎，纯只读零写库（RL-06）。
 *
 * 数据事实（两条只读路径）：
 * 1. audit_logs 任务状态流：仅抽取本项目 entity_type='task' 且 metadata.event =
 *    'TASK_STATUS_CHANGED' 的事件投影（to='completed' → 任务完成时点），
 *    不暴露操作人 IP / UA / 敏感上下文 —— 权限降维：前端仅需 project:view；
 * 2. 任务自身时间戳：created_at（范围进入时点）、deleted_at（范围退出时点）、
 *    actual_end_date / status / estimated_hours（工时口径）。
 *
 * 每日口径（单调性保证）：
 * - TotalScope(d)：d 当日或之前创建、且当日尚未删除的任务集合（范围蔓延基线）；
 * - Completed(d)：完成时点 <= d 的任务集合（只增不减，燃起 Burnup 口径）；
 * - Remaining(d) = max(0, TotalScope − Completed)（下限钳制，防删除引发负剩余）；
 * - Ideal(d) = Scope_initial × (1 − (d − D_start) / (D_end − D_start))。
 * 任务「完成时点」= 最近一次 TASK_STATUS_CHANGED 的 to='completed' 审计时间；
 * 无审计流时回退 actual_end_date；仍缺失时（旧数据）回退 created_at 防御。
 *
 * 输出按 granularity（day 默认 / week）与 metric（task 默认 / hour）切分；
 * 周粒度按 7 天步进锚定窗口起点（与 EVM S 曲线同采样器），采样上限 150。
 *
 * 组织隔离：projectOrFail 断言项目隶属租户，跨组织抛 ResourceNotFoundException（404）。
 */
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

/** 燃尽采样粒度。 */
export type BurndownGranularity = 'day' | 'week'

/** 燃尽主口径：任务计数 / 预估工时。 */
export type BurndownMetric = 'task' | 'hour'

export interface BurndownQuery {
  granularity?: BurndownGranularity
  metric?: BurndownMetric
  startDate?: string
  endDate?: string
}

/** 单日采样点（spec：每日采样指标全量输出，前端按 metric 取主序列）。 */
export interface BurndownPoint {
  date: string
  /** 理想燃尽线，单位为 metric 所选口径。 */
  idealRemaining: number
  remainingTasks: number
  remainingHours: number
  completedTasks: number
  completedHours: number
  totalScopeTasks: number
  totalScopeHours: number
}

export interface BurndownResult {
  projectId: number
  startDate: string
  endDate: string
  granularity: BurndownGranularity
  metric: BurndownMetric
  initialScopeTasks: number
  initialScopeHours: number
  points: BurndownPoint[]
}

const TASK_STATUS_CHANGED_EVENT = 'TASK_STATUS_CHANGED'
const COMPLETED_STATUS = 'completed'
const MAX_POINTS = 150

/** 任务完成事件投影（仅取时间与去向，不暴露审计敏感字段）。 */
interface CompletionEvent {
  taskId: number
  at: DateTime
}

/** 任务内存投影。 */
interface BurndownTaskFacts {
  id: number
  status: string
  estimatedHours: number
  createdAt: DateTime
  actualEnd: DateTime | null
  deletedAt: DateTime | null
}

/** 数据装配结果。 */
interface BurndownDataSource {
  start: DateTime | null
  end: DateTime | null
  tasks: BurndownTaskFacts[]
  /** taskId -> 最近一次进入 completed 的时点（未完成或缺失为 null）。 */
  completedAtById: Map<number, DateTime>
  /** taskId -> 有效删除时点（未删除为 null）。 */
  deletedAtById: Map<number, DateTime | null>
}

@inject()
export default class BurndownAggregationService {
  async getBurndown(
    organizationId: number,
    projectId: number,
    query: BurndownQuery = {},
  ): Promise<BurndownResult> {
    const granularity: BurndownGranularity = query.granularity === 'week' ? 'week' : 'day'
    const metric: BurndownMetric = query.metric === 'hour' ? 'hour' : 'task'
    const data = await this.loadDataSource(organizationId, projectId, query)

    if (!data.start || !data.end) {
      return {
        projectId,
        startDate: '',
        endDate: '',
        granularity,
        metric,
        initialScopeTasks: 0,
        initialScopeHours: 0,
        points: [],
      }
    }
    const start = data.start
    const end = data.end

    const sampleDates = this.generateSampleDates(start, end, granularity)
    const totalDays = Math.max(1, calendarDayDiff(start, end))
    const initialScopeTasks = countInScopeAt(data, start)
    const initialScopeHours = sumScopeHoursAt(data, start)

    const points: BurndownPoint[] = sampleDates.map((date) => {
      const elapsedDays = Math.min(totalDays, Math.max(0, calendarDayDiff(start, date)))
      const idealFraction = 1 - elapsedDays / totalDays
      const totalTasks = countInScopeAt(data, date)
      const totalHours = sumScopeHoursAt(data, date)
      const completedTasks = countCompletedAt(data, date)
      const completedHours = sumCompletedHoursAt(data, date)

      return {
        date: date.toISODate()!,
        idealRemaining: round2(
          metric === 'hour' ? initialScopeHours * idealFraction : initialScopeTasks * idealFraction,
        ),
        remainingTasks: Math.max(0, totalTasks - completedTasks),
        remainingHours: Math.max(0, round2(totalHours - completedHours)),
        completedTasks,
        completedHours,
        totalScopeTasks: totalTasks,
        totalScopeHours: totalHours,
      }
    })

    return {
      projectId,
      startDate: data.start.toISODate()!,
      endDate: data.end.toISODate()!,
      granularity,
      metric,
      initialScopeTasks,
      initialScopeHours,
      points,
    }
  }

  // ---------------------------------------------------------------------------
  // 数据装配
  // ---------------------------------------------------------------------------

  private async loadDataSource(
    organizationId: number,
    projectId: number,
    window: BurndownQuery = {},
  ): Promise<BurndownDataSource> {
    const project = await this.projectOrFail(organizationId, projectId)

    // 含软删除：任务被删后其历史存在期仍参与范围回溯
    const taskRows = await Task.queryWithTrashed()
      .where('project_id', projectId)
      .select('id', 'status', 'estimated_hours', 'created_at', 'actual_end_date', 'deleted_at')
      .orderBy('id')

    const tasks: BurndownTaskFacts[] = []
    for (const row of taskRows as Array<Record<string, unknown>>) {
      const id = Number(row.id ?? 0)
      if (id <= 0) continue
      tasks.push({
        id,
        status: typeof row.status === 'string' ? row.status : '',
        estimatedHours: Number(row.estimated_hours ?? 0) || 0,
        createdAt: parseDbDateTime(row.created_at) ?? DateTime.now(),
        actualEnd: parseDbDate(row.actual_end_date),
        deletedAt: parseDbDateTime(row.deleted_at),
      })
    }

    // 审计状态流：本项目任务状态变更事件（权限降维，仅取完成时点）
    const auditRows = await AuditLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('entity_type', 'task')
      .whereNotNull('entity_id')
      .select('entity_id', 'metadata', 'created_at')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')

    const completionEvents: CompletionEvent[] = []
    const taskIds = new Set(tasks.map((t) => t.id))
    for (const log of auditRows) {
      const metadata = log.metadata
      if (!metadata || metadata.event !== TASK_STATUS_CHANGED_EVENT) continue
      const taskId = Number(log.entityId ?? 0)
      if (!taskIds.has(taskId)) continue
      if (metadata.to === COMPLETED_STATUS) {
        completionEvents.push({ taskId, at: log.createdAt })
      }
    }

    const completedAtById = new Map<number, DateTime>()
    for (const task of tasks) {
      if (task.status !== COMPLETED_STATUS) continue
      const lastCompletion = completionEvents.filter((e) => e.taskId === task.id).at(-1)
      if (lastCompletion) {
        completedAtById.set(task.id, lastCompletion.at)
      } else {
        // 旧数据无审计流：回退 actual_end_date；再缺失以 created_at 防御
        completedAtById.set(task.id, task.actualEnd ?? task.createdAt)
      }
    }

    const deletedAtById = new Map<number, DateTime | null>()
    for (const task of tasks) deletedAtById.set(task.id, task.deletedAt)

    // 时间轴：显式参数优先 → 项目计划日期 → 任务事实最小/最大 → 无轴空返回
    const start = this.resolveWindowStart(project, tasks, window?.startDate)
    const end = this.resolveWindowEnd(project, tasks, window?.endDate)

    return { start, end, tasks, completedAtById, deletedAtById }
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private resolveWindowStart(
    project: Project,
    tasks: BurndownTaskFacts[],
    startDate?: string,
  ): DateTime | null {
    if (startDate) {
      const parsed = DateTime.fromISO(startDate)
      return parsed.isValid ? parsed : null
    }
    if (project.startDate) return project.startDate
    if (tasks.length === 0) return null
    return tasks.reduce(
      (acc, task) => (task.createdAt.toMillis() < acc.toMillis() ? task.createdAt : acc),
      tasks[0].createdAt,
    )
  }

  private resolveWindowEnd(
    project: Project,
    tasks: BurndownTaskFacts[],
    endDate?: string,
  ): DateTime | null {
    if (endDate) {
      const parsed = DateTime.fromISO(endDate)
      return parsed.isValid ? parsed : null
    }
    if (project.endDate) return project.endDate
    if (tasks.length === 0) return null
    // 无项目计划终点：任务最晚活动与今天取较大者
    const latestActivity = tasks.reduce((acc, task) => {
      const candidates = [task.actualEnd, task.deletedAt]
      for (const candidate of candidates) {
        if (candidate && candidate.toMillis() > acc.toMillis()) acc = candidate
      }
      return acc
    }, tasks[0].createdAt)
    const today = DateTime.now()
    return latestActivity.toMillis() > today.toMillis() ? latestActivity : today
  }

  // ---------------------------------------------------------------------------
  // 每日聚合
  // ---------------------------------------------------------------------------

  private generateSampleDates(
    start: DateTime,
    end: DateTime,
    granularity: BurndownGranularity,
  ): DateTime[] {
    const spanDays = calendarDayDiff(start, end)
    if (spanDays <= 0) return [start.startOf('day')]

    let stepDays = granularity === 'week' ? 7 : 1
    if (Math.floor(spanDays / stepDays) + 2 > MAX_POINTS) {
      stepDays = Math.ceil(spanDays / (MAX_POINTS - 1))
    }

    const dates: DateTime[] = []
    let cursor = start.startOf('day')
    let guard = 0
    while (
      cursor.toISODate()! <= end.toISODate()! &&
      dates.length < MAX_POINTS &&
      guard < MAX_POINTS + 10
    ) {
      dates.push(cursor)
      cursor = cursor.plus({ days: stepDays })
      guard += 1
    }
    const last = dates[dates.length - 1]
    if (last && last.toISODate()! < end.toISODate()!) dates.push(end.startOf('day'))
    return dates
  }
}

// ---------------------------------------------------------------------------
// 模块级纯函数（便于单测推导与读代码验证）
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Number(value.toFixed(2))
}

/** 日历日差（忽略时刻与时区 DST 影响）。 */
function calendarDayDiff(from: DateTime, to: DateTime): number {
  const utcMs = (d: DateTime) => Date.UTC(d.year, d.month - 1, d.day)
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000)
}

/** 日期 d 当日（含）前创建、且 d 当日尚未删除的任务数。 */
function countInScopeAt(data: BurndownDataSource, d: DateTime): number {
  const day = d.toISODate()!
  let count = 0
  for (const task of data.tasks) {
    if (task.createdAt.toISODate()! > day) continue
    const deletedAt = data.deletedAtById.get(task.id) ?? null
    if (deletedAt && deletedAt.toISODate()! <= day) continue
    count += 1
  }
  return count
}

/** 日期 d 范围内任务预估工时总和（口径同 countInScopeAt）。 */
function sumScopeHoursAt(data: BurndownDataSource, d: DateTime): number {
  const day = d.toISODate()!
  let hours = 0
  for (const task of data.tasks) {
    if (task.createdAt.toISODate()! > day) continue
    const deletedAt = data.deletedAtById.get(task.id) ?? null
    if (deletedAt && deletedAt.toISODate()! <= day) continue
    hours += task.estimatedHours
  }
  return hours
}

/** 完成时点 <= d 的任务数（只增不减 —— 燃起口径）。 */
function countCompletedAt(data: BurndownDataSource, d: DateTime): number {
  const day = d.toISODate()!
  let count = 0
  for (const [taskId, completedAt] of data.completedAtById) {
    void taskId
    if (completedAt.toISODate()! <= day) count += 1
  }
  return count
}

/** 完成时点 <= d 的任务预估工时总和。 */
function sumCompletedHoursAt(data: BurndownDataSource, d: DateTime): number {
  const day = d.toISODate()!
  const byId = new Map(data.tasks.map((t) => [t.id, t]))
  let hours = 0
  for (const [taskId, completedAt] of data.completedAtById) {
    if (completedAt.toISODate()! > day) continue
    const task = byId.get(taskId)
    if (task) hours += task.estimatedHours
  }
  return hours
}

/** SQLite/Lucid 存储格式宽松解析（SQL 文本 / ISO 字符串）。 */
function parseDbDateTime(value: unknown): DateTime | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof DateTime) return value.isValid ? value : null
  if (typeof value !== 'string') return null
  const fromSql = DateTime.fromSQL(value)
  if (fromSql.isValid) return fromSql
  const fromIso = DateTime.fromISO(value)
  return fromIso.isValid ? fromIso : null
}

/** DATE 列（YYYY-MM-DD）解析。 */
function parseDbDate(value: unknown): DateTime | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof DateTime) return value.isValid ? value : null
  if (typeof value !== 'string') return null
  const parsed = DateTime.fromISO(value)
  return parsed.isValid ? parsed : null
}
