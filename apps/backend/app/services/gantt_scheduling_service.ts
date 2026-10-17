import { createHash } from 'node:crypto'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Project from '#models/project'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  pullForwardSchedule,
  scheduleProject,
  type ScheduleDependency,
  type ScheduleIntent,
  type ScheduleChange,
  type ScheduleResult,
  type ScheduleTask,
} from '#services/gantt_scheduling_engine'
import { createWorkingCalendar, WorkingCalendarError } from '#services/gantt_working_calendar'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'

export interface GanttScheduleInput extends ScheduleIntent {
  mode: 'preview' | 'commit'
  previewToken?: string | null
}

export interface GanttScheduleResponse extends ScheduleResult {
  previewToken: string
  committed: boolean
  calendar: { version: number; workdays: number[]; holidays: string[]; extraWorkdays: string[] }
}

@inject()
export default class GanttSchedulingService {
  constructor(private audit: AuditService) {}

  async assertAccess(organizationId: number, projectId: number, taskId: number): Promise<void> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    const task = await Task.query()
      .where('id', taskId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()
    if (!task) throw new ResourceNotFoundException('任务不存在')
  }

  async execute(
    organizationId: number,
    projectId: number,
    input: GanttScheduleInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<GanttScheduleResponse> {
    if (input.mode === 'preview') {
      const calculation = await this.calculate(organizationId, projectId, input)
      return { ...calculation, committed: false }
    }
    if (!input.previewToken) throw new ValidationException('提交排程需要 preview_token')

    const committed = await db.transaction(async (trx) => {
      const calculation = await this.calculate(organizationId, projectId, input, trx)
      if (calculation.previewToken !== input.previewToken) {
        throw new ConflictException('排程预览已过期，请重新预览', {
          code: 'SCHEDULE_STALE',
        })
      }
      if (calculation.conflicts.length) {
        throw new ValidationException('排程存在阻塞冲突', {
          details: calculation.conflicts,
        })
      }

      for (const change of calculation.changes) {
        const task = await Task.query({ client: trx })
          .where('id', change.taskId)
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .firstOrFail()
        task.startDate = DateTime.fromISO(change.after.startDate)
        task.endDate = DateTime.fromISO(change.after.endDate)
        task.durationDays = change.after.durationDays
        await task.save()
      }

      if (calculation.changes.length) {
        await this.audit.log({
          event: AuditEvent.GANTT_SCHEDULE_COMMITTED,
          userId: actorUserId,
          organizationId,
          projectId,
          entityType: 'project',
          entityId: projectId,
          requestId: ctx.requestId ?? null,
          metadata: {
            rootTaskId: input.taskId,
            operation: input.operation,
            previewToken: input.previewToken,
            changes: calculation.changes,
          },
          client: trx,
          strict: true,
        })
      }
      return { ...calculation, committed: true }
    })
    // 提交后广播：看板 / 日历 / WBS / 时间线等其他视图与协作者即时刷新
    broadcastTasksUpdated(
      organizationId,
      projectId,
      committed.changes.map((change) => change.taskId),
      actorUserId,
    )
    return committed
  }

  /**
   * 任务日期被直接修改（详情抽屉 / 编辑接口）后，沿依赖顺延后续任务，保持完成-开始等依赖不被破坏。
   * 在调用方事务内执行：根任务已按新日期保存，只落「dependency」原因的级联变更。
   * 存在阻塞冲突或其他任务缺日期时不级联（返回 skipped），由调用方提示。
   */
  async cascadeFromTask(
    organizationId: number,
    projectId: number,
    taskId: number,
    operation: 'move' | 'resize',
    actorUserId: number,
    trx: TransactionClientContract,
    ctx: AuthContext = {},
  ): Promise<{ changes: ScheduleChange[]; skipped: string | null }> {
    const root = await Task.query({ client: trx })
      .where('id', taskId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()
    const startDate = root?.startDate?.toISODate()
    const endDate = root?.endDate?.toISODate()
    if (!root || !startDate || !endDate) return { changes: [], skipped: null }

    let calculation: Omit<GanttScheduleResponse, 'committed'>
    try {
      calculation = await this.calculate(
        organizationId,
        projectId,
        { mode: 'preview', taskId, operation, startDate, endDate, autoSchedule: true },
        trx,
      )
    } catch (error) {
      return { changes: [], skipped: (error as Error).message }
    }
    if (calculation.conflicts.length) {
      return { changes: [], skipped: '后续任务存在排程冲突，未自动顺延，请在甘特图中调整' }
    }

    const changes = calculation.changes.filter((change) => change.taskId !== taskId)
    for (const change of changes) {
      const task = await Task.query({ client: trx })
        .where('id', change.taskId)
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .firstOrFail()
      task.startDate = DateTime.fromISO(change.after.startDate)
      task.endDate = DateTime.fromISO(change.after.endDate)
      task.durationDays = change.after.durationDays
      task.useTransaction(trx)
      await task.save()
    }
    if (changes.length) {
      await this.audit.log({
        event: AuditEvent.GANTT_SCHEDULE_COMMITTED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        requestId: ctx.requestId ?? null,
        metadata: { rootTaskId: taskId, operation, source: 'task_update_cascade', changes },
        client: trx,
        strict: true,
      })
    }
    return { changes, skipped: null }
  }

  /**
   * 往前拉（只提前）：任务提前完成或退回待处理 / 重开时，把下游未开工任务（退回时含锚点自身）
   * 拉回到依赖允许的最早开工日。与 cascadeFromTask 对称：同样只落日期变更、写同一审计事件，
   * 存在循环依赖时不拉（返回 skipped），由调用方提示。
   */
  async pullForwardFromTask(
    organizationId: number,
    projectId: number,
    taskId: number,
    options: {
      effectiveEnd?: string | null
      /** 锚点变更前的计划排期（提前完成时库内日期已缩成实际完成日，须以此为基准）。 */
      anchorPlanned?: {
        startDate: string | null
        endDate: string | null
        durationDays: number | null
      } | null
      moveAnchor: boolean
      source: string
    },
    actorUserId: number,
    trx: TransactionClientContract,
    ctx: AuthContext = {},
  ): Promise<{ changes: ScheduleChange[]; skipped: string | null }> {
    const project = await Project.query({ client: trx })
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) return { changes: [], skipped: '项目不存在' }
    const [taskModels, dependencyModels] = await Promise.all([
      Task.query({ client: trx })
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .orderBy('id'),
      TaskDependency.query({ client: trx })
        .whereHas('predecessor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .whereHas('successor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .orderBy('id'),
    ])
    if (!taskModels.some((task) => task.id === taskId)) {
      return { changes: [], skipped: '任务不存在' }
    }

    let result: ScheduleResult
    try {
      const calendar = createWorkingCalendar(project.settings ?? null)
      const planned = options.anchorPlanned
      const tasks: ScheduleTask[] = taskModels
        .filter((task) => task.startDate && task.endDate)
        .map((task) => {
          const usePlanned = task.id === taskId && planned?.startDate && planned.endDate
          return {
            id: task.id,
            name: task.name,
            taskType: task.taskType,
            startDate: usePlanned ? planned.startDate! : task.startDate!.toISODate()!,
            endDate: usePlanned ? planned.endDate! : task.endDate!.toISODate()!,
            durationDays: usePlanned ? planned.durationDays : task.durationDays,
            updatedAt: task.updatedAt?.toISO() ?? null,
            status: task.status,
          }
        })
      const dependencies: ScheduleDependency[] = dependencyModels.map((dependency) => ({
        id: dependency.id,
        predecessorId: Number(dependency.predecessorId),
        successorId: Number(dependency.successorId),
        type: dependency.type as ScheduleDependency['type'],
        lagDays: dependency.lagDays,
      }))
      result = pullForwardSchedule(calendar, tasks, dependencies, {
        anchorId: taskId,
        anchorEffectiveEnd: options.effectiveEnd ?? null,
        moveAnchor: options.moveAnchor,
      })
    } catch (error) {
      return { changes: [], skipped: (error as Error).message }
    }
    if (result.conflicts.length) {
      return { changes: [], skipped: '依赖图存在循环，未自动调整排期' }
    }

    const changes = result.changes.filter(
      (change) => options.moveAnchor || change.taskId !== taskId,
    )
    for (const change of changes) {
      const task = await Task.query({ client: trx })
        .where('id', change.taskId)
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .firstOrFail()
      task.startDate = DateTime.fromISO(change.after.startDate)
      task.endDate = DateTime.fromISO(change.after.endDate)
      task.durationDays = change.after.durationDays
      task.useTransaction(trx)
      await task.save()
    }
    if (changes.length) {
      await this.audit.log({
        event: AuditEvent.GANTT_SCHEDULE_COMMITTED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        requestId: ctx.requestId ?? null,
        metadata: { rootTaskId: taskId, operation: 'move', source: options.source, changes },
        client: trx,
        strict: true,
      })
    }
    return { changes, skipped: null }
  }

  private async calculate(
    organizationId: number,
    projectId: number,
    input: GanttScheduleInput,
    client?: TransactionClientContract,
  ): Promise<Omit<GanttScheduleResponse, 'committed'>> {
    const project = await Project.query({ client })
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')

    const [taskModels, dependencyModels] = await Promise.all([
      Task.query({ client }).where('project_id', projectId).whereNull('deleted_at').orderBy('id'),
      TaskDependency.query({ client })
        .whereHas('predecessor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .whereHas('successor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .orderBy('id'),
    ])
    const root = taskModels.find((task) => task.id === input.taskId)
    if (!root) throw new ResourceNotFoundException('任务不存在')

    try {
      const calendar = createWorkingCalendar(project.settings ?? null)
      const tasks: ScheduleTask[] = taskModels.map((task) => {
        const startDate = task.startDate?.toISODate()
        const endDate = task.endDate?.toISODate()
        if (!startDate || !endDate) {
          throw new ValidationException(`任务「${task.name}」缺少起止日期`)
        }
        return {
          id: task.id,
          name: task.name,
          taskType: task.taskType,
          startDate,
          endDate,
          durationDays: task.durationDays,
          updatedAt: task.updatedAt?.toISO() ?? null,
        }
      })
      const dependencies: ScheduleDependency[] = dependencyModels.map((dependency) => ({
        id: dependency.id,
        predecessorId: Number(dependency.predecessorId),
        successorId: Number(dependency.successorId),
        type: dependency.type as ScheduleDependency['type'],
        lagDays: dependency.lagDays,
      }))
      let result: ScheduleResult
      try {
        result = scheduleProject(calendar, tasks, dependencies, input)
      } catch (error) {
        throw new ValidationException((error as Error).message)
      }
      const calendarSummary = {
        version: calendar.settings.version,
        workdays: [...calendar.workdays].sort((a, b) => a - b),
        holidays: [...calendar.holidays].sort(),
        extraWorkdays: [...calendar.extraWorkdays].sort(),
      }
      const previewToken = createHash('sha256')
        .update(
          stableStringify({
            projectId,
            calendar: calendarSummary,
            intent: {
              taskId: input.taskId,
              operation: input.operation,
              startDate: input.startDate,
              endDate: input.endDate ?? null,
              autoSchedule: input.autoSchedule,
            },
            tasks,
            dependencies,
          }),
        )
        .digest('hex')
      return { ...result, previewToken, calendar: calendarSummary }
    } catch (error) {
      if (error instanceof WorkingCalendarError) {
        throw new ValidationException(error.message)
      }
      throw error
    }
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
