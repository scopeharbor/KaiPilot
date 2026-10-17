import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import GanttSchedulingService from '#services/gantt_scheduling_service'
import { ProjectRoleName } from '#rbac'
import AuditService, { AuditEvent } from '#services/audit_service'
import NotificationService, { type CreateNotificationInput } from '#services/notification_service'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import {
  MAX_TASK_DEPTH,
  assertTransition,
  normalizePriority,
  normalizeStatus,
  normalizeTaskType,
  type TaskStatus,
} from '#services/task_status_machine'
import logger from '@adonisjs/core/services/logger'
import { RealtimeEvents, type RealtimeEventEnvelope } from '#types/realtime_events'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { createWorkingCalendar } from '#services/gantt_working_calendar'
import { todayAnchor } from '#services/ai_intent/core_information_needs'
import { scheduleForStatus, syncStepsForStatus } from '#services/task_status_sync'

export interface CreateTaskInput {
  name: string
  description?: string | null
  status?: string
  priority?: string
  taskType?: string
  startDate?: string | null
  endDate?: string | null
  durationDays?: number | null
  estimatedHours?: number | null
  assigneeId?: number | null
  /** V3：负责人类型（user | agent），默认 'user' */
  assigneeType?: string | null
  reviewerId?: number | null
  parentTaskId?: number | null
  wbsNodeId?: number | null
  milestoneId?: number | null
  costEstimateCents?: number | null
  customFields?: Record<string, unknown> | null
  /**
   * V3 图表馆 RACI / LOB（W3.6/W3.7）：咨询方 / 知会方人员 ID 列表
   * （必须为当前组织有效成员），物理空间单元与流水工序阶段。
   */
  consultedUserIds?: number[] | null
  informedUserIds?: number[] | null
  locationUnit?: string | null
  cycleStage?: string | null
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  actualHours?: number | null
  costActualCents?: number | null
  progressPercent?: number
}

export interface ChangeStatusInput {
  status: string
  actualHours?: number | null
  progressPercent?: number
  note?: string | null
}

export interface TaskListFilters {
  status?: string
  priority?: string
  assigneeId?: number
  search?: string
  /** AI 建议岗位包含该文本（如「后端开发」）。 */
  roleHint?: string
  dateFrom?: string
  dateTo?: string
  sort?: string
  page?: number
  perPage?: number
}

export interface RecycleBinTaskRow {
  id: number
  projectId: number
  name: string
  status: string
  priority: string
  assigneeId: number | null
  deletedAt: string
}

export interface RecycleBinFilters {
  search?: string
  sort?: '-deletedAt' | '+deletedAt' | '+name' | '-name'
  page?: number
  perPage?: number
}

export const SOFT_DELETE_RESTORE_WINDOW_DAYS = 30
const PARENT_NOT_FOUND_CODE = '2008'

@inject()
export default class TaskService {
  constructor(
    private audit: AuditService,
    private notifications: NotificationService,
    private scheduling: GanttSchedulingService,
  ) {}

  /**
   * 最近一次状态变更 / 更新产生的提示（前置未完成、未能自动顺延等），按任务 id 暂存，
   * 供控制器放进响应 meta.warnings 让前端即时提示。服务实例随请求创建。
   */
  readonly warnings = new Map<number, string[]>()

  private addWarning(taskId: number, message: string) {
    const list = this.warnings.get(taskId) ?? []
    list.push(message)
    this.warnings.set(taskId, list)
  }

  /**
   * 重算项目总进度（projects.progress_percent）：叶子任务按工期加权平均，
   * 已完成计 100%、已取消不计入。任务新建 / 更新 / 改状态 / 删除 / 恢复时在同一事务内调用，
   * 项目顶部进度与仪表盘不再恒为 0%。
   */
  async recalculateProjectProgress(
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<number> {
    const q = client ?? db
    const rows = (await q
      .from('tasks as t')
      .where('t.project_id', projectId)
      .whereNull('t.deleted_at')
      .whereNot('t.status', 'cancelled')
      .whereNotExists((sub) =>
        sub.from('tasks as c').whereColumn('c.parent_task_id', 't.id').whereNull('c.deleted_at'),
      )
      .select('t.status', 't.progress_percent', 't.duration_days')) as Array<{
      status: string
      progress_percent: number | string | null
      duration_days: number | string | null
    }>
    let weightSum = 0
    let weighted = 0
    for (const row of rows) {
      const weight = Math.max(1, Number(row.duration_days) || 1)
      const progress =
        row.status === 'completed'
          ? 100
          : Math.min(100, Math.max(0, Number(row.progress_percent) || 0))
      weightSum += weight
      weighted += weight * progress
    }
    const value = weightSum ? Math.round((weighted / weightSum) * 100) / 100 : 0
    await q.from('projects').where('id', projectId).update({ progress_percent: value })
    return value
  }

  /** ai_metadata.assigneeHint 的取值表达式（PostgreSQL 与 SQLite 语法不同）。 */
  private roleHintExpr(): string {
    return db.connection().dialect.name === 'postgres'
      ? "(ai_metadata::jsonb ->> 'assigneeHint')"
      : "json_extract(ai_metadata, '$.assigneeHint')"
  }

  /**
   * 本项目出现过的 AI 建议岗位及任务数（「安全、运维」这类复合建议拆成单个岗位分别计数），
   * 供列表的岗位筛选下拉使用。
   */
  async roleHints(
    organizationId: number,
    projectId: number,
  ): Promise<Array<{ role: string; count: number }>> {
    await this.projectOrFail(organizationId, projectId)
    const rows = (await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotNull('ai_metadata')
      .select(db.raw(`${this.roleHintExpr()} as hint`))) as Array<{ hint: string | null }>
    const counts = new Map<string, number>()
    for (const { hint } of rows) {
      for (const role of String(hint ?? '').split(/[、,，/]/)) {
        const name = role.trim()
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count)
  }

  /** 项目管理者：项目创建者 + 在岗的 Project Owner / Project Manager 成员。 */
  private async projectManagerIds(
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<number[]> {
    const ids = new Set<number>()
    const project = await Project.query({ client }).where('id', projectId).first()
    if (project?.createdBy) ids.add(Number(project.createdBy))
    const members = await ProjectMember.query({ client })
      .where('project_id', projectId)
      .where('is_active', true)
      .preload('projectRole')
    for (const member of members) {
      const name = member.projectRole?.name
      if (name === ProjectRoleName.OWNER || name === ProjectRoleName.PROJECT_MANAGER) {
        ids.add(Number(member.userId))
      }
    }
    return [...ids]
  }

  /** 给一组用户发同一条通知（去重、排除操作者；通知失败不影响业务写入）。 */
  private async notifyUsers(
    recipientIds: Iterable<number | null | undefined>,
    actorUserId: number,
    input: Omit<CreateNotificationInput, 'recipientId'>,
    client?: TransactionClientContract,
  ) {
    const seen = new Set<number>()
    for (const raw of recipientIds) {
      const id = raw === null || raw === undefined ? Number.NaN : Number(raw)
      if (!Number.isFinite(id) || id === Number(actorUserId) || seen.has(id)) continue
      seen.add(id)
      try {
        await this.notifications.createForUser({ ...input, recipientId: id, client })
      } catch (error) {
        logger.warn(
          { recipientId: id, type: input.type, error: (error as Error).message },
          '任务通知发送失败（旁路，不影响业务写入）',
        )
      }
    }
  }

  // ---------------- 创建 ----------------

  async create(
    organizationId: number,
    projectId: number,
    input: CreateTaskInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Task> {
    await this.projectOrFail(organizationId, projectId)
    this.assertDatesValid(input.startDate ?? null, input.endDate ?? null)

    const status = normalizeStatus(input.status) ?? 'not_started'
    const priority = normalizePriority(input.priority) ?? 'medium'
    const taskType = normalizeTaskType(input.taskType) ?? 'task'

    let parentDepth = 0
    if (input.parentTaskId) {
      parentDepth = await this.assertParentValid(projectId, Number(input.parentTaskId), null)
    }

    const assigneeType = input.assigneeType ?? 'user'

    // Agent 分配时：跳过用户成员校验；User 分配时正常校验
    if (input.assigneeId && assigneeType !== 'agent') {
      await this.assertUserActiveProjectMember(projectId, Number(input.assigneeId), organizationId)
    }
    if (input.reviewerId) {
      await this.assertUserActiveProjectMember(projectId, Number(input.reviewerId), organizationId)
    }

    // RACI 咨询/知会人：须为当前组织有效成员（RL-05 组织边界防御）
    const consultedUserIds = this.normalizeUserIdList(input.consultedUserIds, 'consultedUserIds')
    const informedUserIds = this.normalizeUserIdList(input.informedUserIds, 'informedUserIds')
    if (consultedUserIds.length > 0 || informedUserIds.length > 0) {
      await this.assertRaciUsersBelongOrg(
        organizationId,
        Array.from(new Set([...consultedUserIds, ...informedUserIds])),
      )
    }

    // Agent 分配时：必须有 endDate（截止时间），不能有 estimatedHours
    if (assigneeType === 'agent') {
      if (!input.endDate) {
        throw new ValidationException('Agent 分配的任务必须设置截止时间', {
          status: 422,
          code: '422',
        } as never)
      }
      if (input.estimatedHours !== null && input.estimatedHours !== undefined) {
        throw new ValidationException('Agent 分配的任务不能设置预估工时', {
          status: 422,
          code: '422',
        } as never)
      }
    }

    const task = await db.transaction(async (trx) => {
      const maxRank = await trx
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .max('kanban_rank as maxRank')
        .first()
      const created = await Task.create(
        {
          projectId,
          name: input.name,
          description: input.description ?? null,
          status,
          priority,
          taskType,
          startDate: input.startDate ? DateTime.fromISO(input.startDate) : null,
          endDate: input.endDate ? DateTime.fromISO(input.endDate) : null,
          durationDays: input.durationDays ?? null,
          estimatedHours: input.estimatedHours ?? null,
          assigneeId: input.assigneeId ?? null,
          assigneeType,
          reviewerId: input.reviewerId ?? null,
          parentTaskId: input.parentTaskId ?? null,
          wbsNodeId: input.wbsNodeId ?? null,
          milestoneId: input.milestoneId ?? null,
          costEstimateCents: input.costEstimateCents ?? null,
          customFields: (input.customFields as Record<string, unknown> | null) ?? null,
          consultedUserIds,
          informedUserIds,
          locationUnit: this.normalizeOptionalString(input.locationUnit),
          cycleStage: this.normalizeOptionalString(input.cycleStage),
          kanbanRank: Number(maxRank?.maxRank ?? 0) + 1024,
        },
        { client: trx },
      )
      await this.audit.log({
        event: AuditEvent.TASK_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: created.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          name: created.name,
          status,
          priority,
          parentTaskId: input.parentTaskId ?? null,
          parentDepth,
          // AI 辅助新建（日历快速新建 / 看板 AI 补全）：记录来源与 AI 补的字段，人工确认的是这一次创建
          ...this.creationSourceAudit(input.customFields),
        },
        client: trx,
        strict: true,
      })
      await this.recalculateProjectProgress(projectId, trx)
      return created
    })

    return task
  }

  async assertProjectAccess(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.projectOrFail(organizationId, projectId, client)
  }

  // ---------------- 列表 ----------------

  async list(
    organizationId: number,
    projectId: number,
    filters: TaskListFilters = {},
  ): Promise<{
    data: Task[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    // 带上负责人：时间线 / WBS 等镜头直接用列表展示负责人，缺了会误显示「未分配」
    let query = Task.query().where('project_id', projectId).preload('assignee')

    if (filters.status) query = query.where('status', filters.status)
    if (filters.priority) query = query.where('priority', filters.priority)
    if (filters.assigneeId) query = query.where('assignee_id', filters.assigneeId)

    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query = query.where((builder) => {
        builder.whereILike('name', keyword).orWhereILike('description', keyword)
      })
    }

    if (filters.roleHint) {
      const like = `%${filters.roleHint.replace(/[%_]/g, '\\$&')}%`
      query = query.whereRaw(`${this.roleHintExpr()} like ?`, [like])
    }

    if (filters.dateFrom) {
      query = query.where('end_date', '>=', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.where('start_date', '<=', filters.dateTo)
    }

    const sortField = this.parseSortField(filters.sort ?? '-createdAt')
    // 次级按 id 稳定排序：同一天开始的任务在翻页 / 刷新间顺序不跳动
    query = query.orderBy(sortField.column, sortField.direction).orderBy('id', 'asc')

    const paginator = await query.paginate(page, perPage)
    const rows = paginator.all()
    await this.attachListAggregates(rows)

    const meta = paginator.getMeta()
    return {
      data: rows,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  // ---------------- 详情 ----------------

  async get(organizationId: number, projectId: number, taskId: number): Promise<Task> {
    await this.projectOrFail(organizationId, projectId)

    const task = await Task.query()
      .where('id', taskId)
      .where('project_id', projectId)
      .preload('assignee')
      .preload('reviewer')
      .preload('parent')
      .preload('subtasks')
      .first()

    if (!task) {
      throw new ResourceNotFoundException('任务不存在')
    }
    const dependencyCount = await db
      .from('task_dependencies as dependency')
      .join('tasks as predecessor', 'predecessor.id', 'dependency.predecessor_id')
      .join('tasks as successor', 'successor.id', 'dependency.successor_id')
      .where((query) =>
        query
          .where('dependency.predecessor_id', task.id)
          .orWhere('dependency.successor_id', task.id),
      )
      .whereNull('predecessor.deleted_at')
      .whereNull('successor.deleted_at')
      .count('* as total')
    task.$extras.dependencyCount = Number(dependencyCount[0]?.total ?? 0)
    return task
  }

  /**
   * 仅取任务实体（供 controller 做行级权限判定，不 preload）。
   * 不存在或跨项目 → 404。
   */
  async getForAuthorize(
    organizationId: number,
    projectId: number,
    taskId: number,
    client?: TransactionClientContract,
  ): Promise<Task> {
    return client
      ? this.getMutable(organizationId, projectId, taskId, client)
      : this.get(organizationId, projectId, taskId)
  }

  // ---------------- 编辑 ----------------

  async update(
    organizationId: number,
    projectId: number,
    taskId: number,
    input: UpdateTaskInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<Task> {
    const updated = await this.inTransaction(client, async (transaction) => {
      const task = await this.getMutable(organizationId, projectId, taskId, transaction)
      // 变更前快照：指派通知与排期级联都要和「改之前」比较（save 后 $original 已同步为新值）
      const previousAssigneeId = task.assigneeId !== null ? Number(task.assigneeId) : null
      const previousStart = task.startDate?.toISODate() ?? null
      const previousEnd = task.endDate?.toISODate() ?? null

      // 跨字段日期校验：合并新值后判定
      const nextStart =
        input.startDate !== undefined ? input.startDate : (task.startDate?.toISODate() ?? null)
      const nextEnd =
        input.endDate !== undefined ? input.endDate : (task.endDate?.toISODate() ?? null)
      this.assertDatesValid(nextStart, nextEnd)

      // 状态变更（若提交）经状态机
      if (input.status !== undefined) {
        const next = normalizeStatus(input.status)
        if (!next) throw new ValidationException('无效的任务状态')
        const current = task.status as TaskStatus
        if (next !== current) {
          assertTransition(current, next)
          this.applyStatusSideEffects(task, current, next)
          await this.syncWithStatus(projectId, task, current, next, transaction)
          task.status = next
        }
      }

      if (input.name !== undefined) task.name = input.name
      if (input.description !== undefined) task.description = input.description
      if (input.priority !== undefined) {
        task.priority = normalizePriority(input.priority) ?? task.priority
      }
      if (input.taskType !== undefined) {
        task.taskType = normalizeTaskType(input.taskType) ?? task.taskType
      }
      if (input.startDate !== undefined) {
        task.startDate = input.startDate ? DateTime.fromISO(input.startDate) : null
      }
      if (input.endDate !== undefined) {
        task.endDate = input.endDate ? DateTime.fromISO(input.endDate) : null
      }
      if (input.durationDays !== undefined) task.durationDays = input.durationDays
      if (input.estimatedHours !== undefined) task.estimatedHours = input.estimatedHours
      if (input.actualHours !== undefined) task.actualHours = input.actualHours
      if (input.costEstimateCents !== undefined) task.costEstimateCents = input.costEstimateCents
      if (input.costActualCents !== undefined) task.costActualCents = input.costActualCents
      if (input.progressPercent !== undefined) task.progressPercent = input.progressPercent
      if (input.customFields !== undefined) {
        task.customFields = (input.customFields as Record<string, unknown> | null) ?? null
      }
      if (input.wbsNodeId !== undefined) task.wbsNodeId = input.wbsNodeId
      if (input.milestoneId !== undefined) task.milestoneId = input.milestoneId

      if (input.parentTaskId !== undefined) {
        const newParentId = input.parentTaskId === null ? null : Number(input.parentTaskId)
        if (newParentId !== null) {
          await this.assertParentValid(projectId, newParentId, task.id, transaction)
        }
        task.parentTaskId = newParentId
      }

      // assignee/reviewer 变更：校验目标为活跃成员（task:assign 权限由 controller 守护）
      // V3：agent 类型跳过用户成员校验
      const nextAssigneeType = input.assigneeType ?? task.assigneeType ?? 'user'
      if (
        input.assigneeId !== undefined &&
        input.assigneeId !== null &&
        nextAssigneeType !== 'agent'
      ) {
        await this.assertUserActiveProjectMember(
          projectId,
          Number(input.assigneeId),
          organizationId,
          transaction,
        )
      }
      if (input.reviewerId !== undefined && input.reviewerId !== null) {
        await this.assertUserActiveProjectMember(
          projectId,
          Number(input.reviewerId),
          organizationId,
          transaction,
        )
      }

      // V3：Agent 分配时的校验
      if (nextAssigneeType === 'agent') {
        const agentNextEnd =
          input.endDate !== undefined ? input.endDate : (task.endDate?.toISODate() ?? null)
        if (!agentNextEnd) {
          throw new ValidationException('Agent 分配的任务必须设置截止时间', {
            status: 422,
            code: '422',
          } as never)
        }
        const nextEstimatedHours =
          input.estimatedHours !== undefined ? input.estimatedHours : task.estimatedHours
        if (nextEstimatedHours !== null && nextEstimatedHours !== undefined) {
          throw new ValidationException('Agent 分配的任务不能设置预估工时', {
            status: 422,
            code: '422',
          } as never)
        }
      }

      if (input.assigneeId !== undefined) task.assigneeId = input.assigneeId
      if (input.assigneeType !== undefined) task.assigneeType = input.assigneeType ?? 'user'
      if (input.reviewerId !== undefined) task.reviewerId = input.reviewerId

      // V3 图表馆 RACI / LOB（W3.6/W3.7）
      if (input.consultedUserIds !== undefined) {
        const ids = this.normalizeUserIdList(input.consultedUserIds, 'consultedUserIds')
        await this.assertRaciUsersBelongOrg(organizationId, ids, transaction)
        task.consultedUserIds = ids
      }
      if (input.informedUserIds !== undefined) {
        const ids = this.normalizeUserIdList(input.informedUserIds, 'informedUserIds')
        await this.assertRaciUsersBelongOrg(organizationId, ids, transaction)
        task.informedUserIds = ids
      }
      if (input.locationUnit !== undefined) {
        task.locationUnit = this.normalizeOptionalString(input.locationUnit)
      }
      if (input.cycleStage !== undefined) {
        task.cycleStage = this.normalizeOptionalString(input.cycleStage)
      }

      task.useTransaction(transaction)
      await task.save()

      const changedKeys = Object.keys(input)
      const beforeFields: Record<string, unknown> = {}
      const afterFields: Record<string, unknown> = {}
      for (const key of [
        'status',
        'priority',
        'assigneeId',
        'reviewerId',
        'parentTaskId',
        'wbsNodeId',
        'milestoneId',
        'consultedUserIds',
        'informedUserIds',
        'locationUnit',
        'cycleStage',
      ]) {
        if (key in input) {
          const typedTask = task as unknown as Record<string, unknown> & {
            $originalAttributes?: Record<string, unknown>
          }
          beforeFields[key] = typedTask.$originalAttributes?.[key] ?? typedTask[key]
          afterFields[key] = typedTask[key]
        }
      }
      await this.audit.log({
        event: AuditEvent.TASK_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: task.id,
        requestId: ctx.requestId ?? null,
        changes: { before: beforeFields, after: afterFields },
        metadata: { changed: changedKeys },
        client: transaction,
        strict: true,
      })

      // 指派变更单独记 TASK_ASSIGNED（便于审计检索）
      if (input.assigneeId !== undefined) {
        await this.audit.log({
          event: AuditEvent.TASK_ASSIGNED,
          userId: actorUserId,
          organizationId,
          projectId,
          entityType: 'task',
          entityId: task.id,
          requestId: ctx.requestId ?? null,
          metadata: {
            assigneeId: input.assigneeId,
            assigneeType: input.assigneeType ?? task.assigneeType ?? 'user',
          },
          client: transaction,
          strict: true,
        })

        // 任务指派通知（task 3.3）：避免给操作者发送重复通知
        const oldAssigneeId = previousAssigneeId
        const newAssigneeId = input.assigneeId !== null ? Number(input.assigneeId) : null

        // 指派给新负责人
        // 自己给自己派活不发通知
        if (
          newAssigneeId !== null &&
          newAssigneeId !== oldAssigneeId &&
          newAssigneeId !== Number(actorUserId)
        ) {
          await this.notifications.createForUser({
            client: transaction,
            organizationId,
            recipientId: newAssigneeId,
            type: 'task_assigned',
            title: `任务已指派给你：「${task.name}」`,
            body: `项目经理将任务「${task.name}」指派给你。`,
            severity: 'info',
            projectId,
            targetType: 'task',
            targetId: task.id,
            idempotencyKey: `task:${task.id}:assignee:${newAssigneeId}`,
            metadata: { taskName: task.name, projectId },
          })
        }

        // 取消指派（原负责人不再是负责人）
        if (oldAssigneeId !== null && newAssigneeId !== oldAssigneeId) {
          await this.notifications.createForUser({
            client: transaction,
            organizationId,
            recipientId: oldAssigneeId,
            type: 'task_unassigned',
            title: `任务已被取消指派：「${task.name}」`,
            body: `任务「${task.name}」已指派给其他人。`,
            severity: 'info',
            projectId,
            targetType: 'task',
            targetId: task.id,
            idempotencyKey: `task:${task.id}:unassigned:${oldAssigneeId}`,
            metadata: { taskName: task.name, projectId },
          })
        }
      }

      // 只有影响进度汇总的字段变化才重算（改负责人 / 名称等不触发，批量改派时省下整表扫描）
      if (
        input.progressPercent !== undefined ||
        input.status !== undefined ||
        input.durationDays !== undefined ||
        input.startDate !== undefined ||
        input.endDate !== undefined ||
        input.parentTaskId !== undefined
      ) {
        await this.recalculateProjectProgress(projectId, transaction)
      }

      await this.cascadeScheduleChange(
        organizationId,
        projectId,
        task,
        previousStart,
        previousEnd,
        actorUserId,
        transaction,
        ctx,
      )

      return task
    })
    // 事务提交后广播变更事件到项目频道（尽力而为的旁路，失败不抛错）
    if (!client) {
      this.broadcastTaskEvent(
        organizationId,
        projectId,
        taskId,
        actorUserId,
        RealtimeEvents.TASK_UPDATED,
      )
    }
    return client ? updated : this.get(organizationId, projectId, taskId)
  }

  /**
   * 状态变化的联动（2026-09-29）：执行步骤勾选、进度与排期跟着状态走（见 task_status_sync）。
   * 在保存前调用；排期若有变化，由 cascadeScheduleChange 沿依赖顺延后续任务。
   */
  private async syncWithStatus(
    projectId: number,
    task: Task,
    from: TaskStatus,
    to: TaskStatus,
    transaction: TransactionClientContract,
  ): Promise<void> {
    const steps = syncStepsForStatus(
      {
        customFields: (task.customFields as Record<string, unknown> | null) ?? null,
        description: task.description ?? null,
      },
      from,
      to,
    )
    if (steps) {
      task.customFields = steps.customFields
      task.description = steps.description
      // 完成固定 100%、退回待处理固定 0%（applyStatusSideEffects 已设），只有重新打开按勾选比例
      if (from === 'completed' && to === 'in_progress' && steps.progressPercent !== null) {
        task.progressPercent = steps.progressPercent
      }
    }

    const project = await Project.query({ client: transaction }).where('id', projectId).first()
    let calendar
    try {
      calendar = createWorkingCalendar(
        (project?.settings as Record<string, unknown> | null | undefined) ?? null,
      )
    } catch {
      return
    }
    const schedule = scheduleForStatus(
      {
        startDate: task.startDate?.toISODate() ?? null,
        endDate: task.endDate?.toISODate() ?? null,
        durationDays: task.durationDays !== null ? Number(task.durationDays) : null,
        taskType: task.taskType ?? null,
      },
      from,
      to,
      todayAnchor(new Date()),
      calendar,
    )
    if (!schedule) return
    task.startDate = DateTime.fromISO(schedule.startDate)
    task.endDate = DateTime.fromISO(schedule.endDate)
    task.durationDays = schedule.durationDays
    const message = {
      late_start: `比计划晚开工，排期已顺延为 ${schedule.startDate} ~ ${schedule.endDate}`,
      late_finish: `比计划晚完成，结束日期已改为 ${schedule.endDate}`,
      early_finish: `提前完成，结束日期已改为 ${schedule.endDate}`,
      reopened_overdue: `重新打开时已过计划结束日，结束日期已延到 ${schedule.endDate}`,
    }[schedule.reason]
    this.addWarning(task.id, message)
  }

  /** 排期变化：沿依赖顺延后续任务，并通知负责人 / 项目管理者 / 被顺延任务的负责人。 */
  private async cascadeScheduleChange(
    organizationId: number,
    projectId: number,
    task: Task,
    previousStart: string | null,
    previousEnd: string | null,
    actorUserId: number,
    transaction: TransactionClientContract,
    ctx: AuthContext,
  ): Promise<void> {
    const nextStartIso = task.startDate?.toISODate() ?? null
    const nextEndIso = task.endDate?.toISODate() ?? null
    if (nextStartIso !== previousStart || nextEndIso !== previousEnd) {
      const cascade = await this.scheduling.cascadeFromTask(
        organizationId,
        projectId,
        task.id,
        nextStartIso !== previousStart ? 'move' : 'resize',
        actorUserId,
        transaction,
        ctx,
      )
      if (cascade.skipped) this.addWarning(task.id, cascade.skipped)
      if (cascade.changes.length) {
        this.addWarning(task.id, `已按依赖自动顺延 ${cascade.changes.length} 个后续任务`)
      }
      const range = (a: string | null, b: string | null) => `${a ?? '未定'} ~ ${b ?? '未定'}`
      const managers = await this.projectManagerIds(projectId, transaction)
      const summary = `「${task.name}」排期调整：${range(previousStart, previousEnd)} → ${range(nextStartIso, nextEndIso)}`
      await this.notifyUsers(
        [...managers, task.assigneeId],
        actorUserId,
        {
          organizationId,
          type: 'task_schedule_changed',
          title: summary,
          body: cascade.changes.length
            ? `已按依赖自动顺延 ${cascade.changes.length} 个后续任务。`
            : (cascade.skipped ?? null),
          severity: 'warning',
          projectId,
          targetType: 'task',
          targetId: task.id,
          metadata: { taskName: task.name, projectId, cascaded: cascade.changes.length },
        },
        transaction,
      )
      if (cascade.changes.length) {
        const cascadedTasks = await Task.query({ client: transaction }).whereIn(
          'id',
          cascade.changes.map((change) => change.taskId),
        )
        for (const cascaded of cascadedTasks) {
          const change = cascade.changes.find((c) => c.taskId === cascaded.id)!
          await this.notifyUsers(
            [cascaded.assigneeId],
            actorUserId,
            {
              organizationId,
              type: 'task_schedule_changed',
              title: `「${cascaded.name}」因前置任务调整而顺延`,
              body: `${range(change.before.startDate, change.before.endDate)} → ${range(change.after.startDate, change.after.endDate)}（前置：「${task.name}」）`,
              severity: 'warning',
              projectId,
              targetType: 'task',
              targetId: cascaded.id,
              metadata: { taskName: cascaded.name, projectId, rootTaskId: task.id },
            },
            transaction,
          )
        }
      }
    }
  }

  /**
   * 事务提交后广播变更事件到项目频道（尽力而为的旁路）。
   * 失败不抛错、不阻塞业务写入。在外部事务里调用本服务写方法的一方（看板移动、批量操作）
   * 须在提交后自行调用本方法——写方法带 client 时不会广播（事务可能回滚）。
   */
  broadcastTaskEvent(
    organizationId: number,
    projectId: number,
    entityId: number,
    actorUserId: number,
    eventType: string,
  ) {
    try {
      const broadcaster = new RealtimeBroadcaster()
      const event: RealtimeEventEnvelope = {
        type: eventType,
        projectId,
        entityId,
        actorId: actorUserId,
        occurredAt: new Date().toISOString(),
      }
      broadcaster.broadcastToProject(organizationId, projectId, event)
    } catch (error) {
      // 广播失败绝对不向调用方抛错（设计 D5）
      logger.warn(
        { entityId, eventType, error: error instanceof Error ? error.message : 'unknown' },
        '广播任务事件失败（旁路，不影响业务写入）',
      )
    }
  }

  // ---------------- 状态变更 ----------------

  async changeStatus(
    organizationId: number,
    projectId: number,
    taskId: number,
    input: ChangeStatusInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<Task> {
    const updated = await this.inTransaction(client, async (transaction) => {
      const task = await this.getMutable(organizationId, projectId, taskId, transaction)

      const next = normalizeStatus(input.status)
      if (!next) throw new ValidationException('无效的任务状态')
      const current = task.status as TaskStatus

      // 幂等：同状态无操作，不写审计
      if (next === current) {
        return task
      }

      assertTransition(current, next)
      const previousStart = task.startDate?.toISODate() ?? null
      const previousEnd = task.endDate?.toISODate() ?? null
      const previousDuration = task.durationDays
      this.applyStatusSideEffects(task, current, next, actorUserId, input.note ?? null)
      await this.syncWithStatus(projectId, task, current, next, transaction)

      if (input.actualHours !== undefined) task.actualHours = input.actualHours
      if (input.progressPercent !== undefined) task.progressPercent = input.progressPercent
      task.status = next
      task.useTransaction(transaction)
      await task.save()

      await this.audit.log({
        event: AuditEvent.TASK_STATUS_CHANGED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: task.id,
        requestId: ctx.requestId ?? null,
        changes: { before: { status: current }, after: { status: next } },
        metadata: {
          from: current,
          to: next,
          ...(input.note ? { note: input.note } : {}),
          ...(input.progressPercent !== undefined
            ? { progressPercent: input.progressPercent }
            : {}),
        },
        client: transaction,
        strict: true,
      })

      await this.recalculateProjectProgress(projectId, transaction)
      await this.cascadeScheduleChange(
        organizationId,
        projectId,
        task,
        previousStart,
        previousEnd,
        actorUserId,
        transaction,
        ctx,
      )
      await this.pullForwardOnStatusChange(
        organizationId,
        projectId,
        task,
        current,
        next,
        { startDate: previousStart, endDate: previousEnd, durationDays: previousDuration },
        actorUserId,
        transaction,
        ctx,
      )
      await this.afterStatusChanged(
        organizationId,
        projectId,
        task,
        current,
        next,
        actorUserId,
        input.note ?? null,
        transaction,
      )

      return task
    })
    // 广播事件到项目频道（尽力而为的旁路，失败不抛错）
    if (!client) {
      this.broadcastTaskEvent(
        organizationId,
        projectId,
        taskId,
        actorUserId,
        RealtimeEvents.TASK_STATUS_CHANGED,
      )
    }
    return client ? updated : this.get(organizationId, projectId, taskId)
  }

  // ---------------- 软删除 / 恢复 ----------------

  async delete(
    organizationId: number,
    projectId: number,
    taskId: number,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (transaction) => {
      const task = await this.getMutable(organizationId, projectId, taskId, transaction)

      const activeSubtaskCount = await Task.query({ client: transaction })
        .where('parent_task_id', taskId)
        .whereNull('deleted_at')
        .count('*', 'total')
      if (Number(activeSubtaskCount[0]?.$extras?.total ?? 0) > 0) {
        throw new ValidationException('请先删除或移走该任务的子任务', {
          status: 422,
          code: '422',
        } as never)
      }

      task.deletedAt = DateTime.now()
      task.useTransaction(transaction)
      await task.save()

      await this.audit.log({
        event: AuditEvent.TASK_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: task.id,
        requestId: ctx.requestId ?? null,
        client: transaction,
        strict: true,
      })
      await this.recalculateProjectProgress(projectId, transaction)
    })
  }

  async restore(
    organizationId: number,
    projectId: number,
    taskId: number,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<Task> {
    const restored = await this.inTransaction(client, async (transaction) => {
      await this.projectOrFail(organizationId, projectId, transaction)

      const row = await Task.queryWithTrashed(transaction)
        .where('id', taskId)
        .where('project_id', projectId)
        .first()
      if (!row) {
        throw new ResourceNotFoundException('任务不存在')
      }

      const deletedAtRaw = row.deleted_at as string | Date | null
      if (!deletedAtRaw) {
        throw new ValidationException('任务未被删除，无需恢复', {
          status: 422,
          code: '422',
        } as never)
      }

      const deletedAt = this.parseDatabaseDate(deletedAtRaw)
      const elapsedDays = DateTime.now().diff(deletedAt, 'days').days
      if (elapsedDays > SOFT_DELETE_RESTORE_WINDOW_DAYS) {
        throw new ValidationException('软删除已超过 30 天，无法恢复', {
          status: 422,
          code: '422',
        } as never)
      }

      await Task.queryWithTrashed(transaction)
        .where('id', taskId)
        .where('project_id', projectId)
        .update({ deleted_at: null })

      const restoredTask = await this.getMutable(organizationId, projectId, taskId, transaction)
      await this.audit.log({
        event: AuditEvent.TASK_RESTORED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: taskId,
        requestId: ctx.requestId ?? null,
        client: transaction,
        strict: true,
      })
      await this.recalculateProjectProgress(projectId, transaction)

      return restoredTask
    })
    return client ? restored : this.get(organizationId, projectId, taskId)
  }

  async listRecycleBin(
    organizationId: number,
    projectId: number,
    filters: RecycleBinFilters = {},
  ): Promise<{
    data: RecycleBinTaskRow[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))
    const cutoff = DateTime.now().minus({ days: SOFT_DELETE_RESTORE_WINDOW_DAYS }).toSQL()
    let query = Task.queryOnlyTrashed()
      .where('project_id', projectId)
      .where('deleted_at', '>=', cutoff!)

    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query = query.whereILike('name', keyword)
    }

    const sort = filters.sort ?? '-deletedAt'
    const sortColumn = sort.endsWith('name') ? 'name' : 'deleted_at'
    const sortDirection = sort.startsWith('-') ? 'desc' : 'asc'
    query = query.orderBy(sortColumn, sortDirection).orderBy('id', 'asc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all().map((row) => ({
        id: Number(row.id),
        projectId: Number(row.project_id),
        name: String(row.name),
        status: String(row.status),
        priority: String(row.priority),
        assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
        deletedAt: this.parseDatabaseDate(row.deleted_at as string | Date).toISO()!,
      })),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  // ---------------- 内部辅助 ----------------

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
  }

  private parseDatabaseDate(value: string | Date): DateTime {
    if (value instanceof Date) return DateTime.fromJSDate(value)
    const sql = DateTime.fromSQL(value)
    return sql.isValid ? sql : DateTime.fromISO(value)
  }

  private async getMutable(
    organizationId: number,
    projectId: number,
    taskId: number,
    client: TransactionClientContract,
  ): Promise<Task> {
    await this.projectOrFail(organizationId, projectId, client)
    const task = await Task.query({ client })
      .where('id', taskId)
      .where('project_id', projectId)
      .first()
    if (!task) {
      throw new ResourceNotFoundException('任务不存在')
    }
    return task
  }

  private applyStatusSideEffects(
    task: Task,
    from: TaskStatus,
    to: TaskStatus,
    actorUserId?: number,
    note?: string | null,
  ): void {
    // 转 completed：回填 actual_end_date（若空），进度记 100%（否则甘特条 / 汇总进度仍显示 0）
    if (to === 'completed') {
      if (!task.actualEndDate) task.actualEndDate = DateTime.now()
      task.progressPercent = 100
    }
    // 重开 / 退回未开始：进度不能停在 100%（状态与进度自相矛盾）
    if (from === 'completed' && to !== 'completed') task.progressPercent = 0
    if (to === 'not_started') {
      task.progressPercent = 0
      // 退回待处理 = 还没开工，实际开始日一并清掉
      task.actualStartDate = null
    }
    // 阻塞原因：进入阻塞时记下原因 / 时间 / 标记人，离开阻塞时清掉
    const fields = { ...((task.customFields as Record<string, unknown> | null) ?? {}) }
    if (to === 'blocked') {
      fields.blockedReason = note?.trim() || null
      fields.blockedAt = DateTime.now().toISO()
      fields.blockedBy = actorUserId ?? null
      task.customFields = fields
    } else if (from === 'blocked') {
      delete fields.blockedReason
      delete fields.blockedAt
      delete fields.blockedBy
      task.customFields = Object.keys(fields).length ? fields : null
    }
    // 首 转 in_progress：回填 actual_start_date（若空）
    if (to === 'in_progress' && !task.actualStartDate) {
      task.actualStartDate = DateTime.now()
    }
    // completed → in_progress（重开）：清自动回填的 actual_end_date
    if (from === 'completed' && to === 'in_progress') {
      task.actualEndDate = null
    }
  }

  /**
   * 状态变化触发的「往前拉」（排期引擎只顺延不提前的对称补充）：
   * - 提前完成：实际完成日早于计划完成日，未开工的后续任务拉到依赖允许的最早开工日；
   * - 退回待处理 / 重开：锚点与下游未开工任务回滚到最早可行日期（撤销此前被顺延的排期）。
   * 与 cascadeScheduleChange 同一事务内落库、写审计并通知项目管理者。
   */
  private async pullForwardOnStatusChange(
    organizationId: number,
    projectId: number,
    task: Task,
    from: TaskStatus,
    to: TaskStatus,
    planned: { startDate: string | null; endDate: string | null; durationDays: number | null },
    actorUserId: number,
    transaction: TransactionClientContract,
    ctx: AuthContext,
  ): Promise<void> {
    const completion = to === 'completed'
    const reopen = to === 'not_started' || (from === 'completed' && to === 'in_progress')
    if (!completion && !reopen) return

    let effectiveEnd: string | null = null
    if (completion) {
      // 用状态变更前的计划结束日：syncWithStatus 会把提前完成的任务结束日缩成实际完成日，
      // 此时再读 task.endDate 永远等于 actualEnd，往前拉永远不会触发。
      const plannedEnd = planned.endDate
      const actualEnd = task.actualEndDate?.toISODate()
      // 按期或延期完成没有可提前的空间
      if (!plannedEnd || !actualEnd || actualEnd >= plannedEnd) return
      effectiveEnd = actualEnd
    }
    const pull = await this.scheduling.pullForwardFromTask(
      organizationId,
      projectId,
      task.id,
      {
        effectiveEnd,
        // 提前完成时库里的锚点排期已被 syncWithStatus 缩成实际完成日，引擎须以变更前的
        // 计划排期为基准，才能判断下游约束「因锚点提前而改善」。
        anchorPlanned: completion ? planned : null,
        moveAnchor: reopen,
        source: completion ? 'completion_pull_forward' : 'reopen_rollback',
      },
      actorUserId,
      transaction,
      ctx,
    )
    if (pull.skipped) this.addWarning(task.id, pull.skipped)
    if (!pull.changes.length) return
    const action = completion ? '提前完成' : '退回重排'
    this.addWarning(task.id, `已按依赖把 ${pull.changes.length} 个任务的开工日往前拉（${action}）`)
    const managers = await this.projectManagerIds(projectId, transaction)
    await this.notifyUsers(
      [...managers, task.assigneeId],
      actorUserId,
      {
        organizationId,
        type: 'task_schedule_changed',
        title: `「${task.name}」${action}：${pull.changes.length} 个任务提前开工`,
        body: pull.changes
          .slice(0, 5)
          .map(
            (change) =>
              `「${change.taskName}」${change.before.startDate} → ${change.after.startDate}`,
          )
          .join('；'),
        severity: 'info',
        projectId,
        targetType: 'task',
        targetId: task.id,
        metadata: { taskName: task.name, projectId, pulled: pull.changes.length },
      },
      transaction,
    )
  }

  /**
   * 状态变更后的协同动作（事务内）：
   * - 开工时前置任务未完成 → 提示操作者并通知项目管理者（不硬拦，现实中常有提前开工）；
   * - 阻塞 → 通知项目管理者（附原因）；
   * - 完成 → 通知项目管理者。
   */
  private async afterStatusChanged(
    organizationId: number,
    projectId: number,
    task: Task,
    from: TaskStatus,
    to: TaskStatus,
    actorUserId: number,
    note: string | null,
    transaction: TransactionClientContract,
  ): Promise<void> {
    const base = { organizationId, projectId, targetType: 'task', targetId: task.id }
    if (to === 'in_progress' && from === 'not_started') {
      const pending = await TaskDependency.query({ client: transaction })
        .where('successor_id', task.id)
        .whereHas('predecessor', (q) => q.whereNull('deleted_at').whereNot('status', 'completed'))
        .preload('predecessor')
      if (pending.length) {
        const names = pending.map((d) => `「${d.predecessor.name}」`).join('、')
        // 说清是哪个任务、为什么提醒、接下来怎么办（原文「已按你的操作开工」用户看不懂）
        this.addWarning(
          task.id,
          `「${task.name}」已改为进行中，但它依赖的 ${names} 还没完成。系统没有拦你（现实中常有提前开工），已通知项目经理；如果是误操作，把它拖回「待处理」即可。`,
        )
        await this.notifyUsers(
          await this.projectManagerIds(projectId, transaction),
          actorUserId,
          {
            ...base,
            type: 'task_predecessor_pending',
            title: `「${task.name}」在前置任务未完成时开工`,
            body: `未完成的前置：${names}`,
            severity: 'warning',
            metadata: {
              taskName: task.name,
              projectId,
              predecessorIds: pending.map((d) => d.predecessorId),
            },
          },
          transaction,
        )
      }
    }
    if (to === 'blocked') {
      await this.notifyUsers(
        await this.projectManagerIds(projectId, transaction),
        actorUserId,
        {
          ...base,
          type: 'task_blocked',
          title: `任务受阻：「${task.name}」`,
          body: note?.trim() ? `原因：${note.trim()}` : '未填写阻塞原因',
          severity: 'warning',
          metadata: { taskName: task.name, projectId, reason: note?.trim() || null },
        },
        transaction,
      )
    }
    if (to === 'completed') {
      await this.notifyUsers(
        await this.projectManagerIds(projectId, transaction),
        actorUserId,
        {
          ...base,
          type: 'task_completed',
          title: `任务已完成：「${task.name}」`,
          body: null,
          severity: 'info',
          metadata: { taskName: task.name, projectId },
        },
        transaction,
      )
    }
  }

  private assertDatesValid(start: string | null, end: string | null): void {
    if (start && end && end < start) {
      throw new ValidationException('结束日期不能早于开始日期', {
        status: 422,
        code: '422',
        details: { startDate: start, endDate: end },
      } as never)
    }
  }

  /**
   * 校验父任务：存在 + 同项目 + 深度不超 3 + 不构成环（改父时）。
   * 返回父任务深度（用于审计/调试）。
   */
  private async assertParentValid(
    projectId: number,
    parentTaskId: number,
    selfId: number | null,
    client?: TransactionClientContract,
  ): Promise<number> {
    let parentQuery = Task.query().where('id', parentTaskId).where('project_id', projectId)
    if (client) parentQuery = parentQuery.useTransaction(client)
    const parent = await parentQuery.first()

    if (!parent) {
      throw new ResourceNotFoundException('父任务不存在', {
        status: 422,
        code: PARENT_NOT_FOUND_CODE,
      } as never)
    }

    // 上溯计深度并检测环
    let depth = 1
    let current: Task | null = parent
    const visited = new Set<number>()
    while (current !== null) {
      const currentParentId = current.parentTaskId
      if (currentParentId === null) break
      const pid: number = Number(currentParentId)
      if (selfId !== null && pid === selfId) {
        throw new ValidationException('不能将任务挂载到自身或其子任务下（会构成环）', {
          status: 422,
          code: '422',
        } as never)
      }
      if (visited.has(pid)) break
      visited.add(pid)
      depth++

      let nextQuery = Task.query().where('id', pid).where('project_id', projectId)
      if (client) nextQuery = nextQuery.useTransaction(client)
      const next: Task | null = await nextQuery.first()
      current = next
    }

    // 新子任务深度 = parent 深度 + 1
    if (depth + 1 > MAX_TASK_DEPTH) {
      throw new ValidationException(`子任务嵌套深度不能超过 ${MAX_TASK_DEPTH} 级`, {
        status: 422,
        code: '422',
      } as never)
    }
    return depth
  }

  private async assertUserActiveProjectMember(
    projectId: number,
    userId: number,
    organizationId: number,
    client?: TransactionClientContract,
  ): Promise<void> {
    let memberQuery = ProjectMember.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .where('is_active', true)
    if (client) memberQuery = memberQuery.useTransaction(client)
    const member = await memberQuery.first()
    if (member) return

    // 项目创建者默认具 Owner 成员身份（即便 project_members 行缺失也放行）
    let projectQuery = Project.query().where('id', projectId)
    if (client) projectQuery = projectQuery.useTransaction(client)
    const project = await projectQuery.first()
    if (project && Number(project.createdBy) === userId) return

    // 属于同组织的活跃用户也接受（sec08.3.1 成员语义对齐组织成员）
    const orgMember = await (client ?? db)
      .from('organization_members')
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .first()
    if (orgMember) return

    throw new ValidationException('被指派者必须是本项目的活跃成员', {
      status: 422,
      code: '422',
    } as never)
  }

  /**
   * RACI 咨询/知会人校验（W3.6）：人员必须是当前组织有效成员
   * （组织成员行或组织所有者；owner 可能没有 organization_members 行）。
   * 组织边界在 Service 层再兜底一次，防跨租户用户 ID 注入（RL-05）。
   */
  private async assertRaciUsersBelongOrg(
    organizationId: number,
    userIds: number[],
    client?: TransactionClientContract,
  ): Promise<void> {
    if (userIds.length === 0) return
    let memberQuery = OrganizationMember.query()
      .where('organization_id', organizationId)
      .whereIn('user_id', userIds)
      .select('user_id')
    if (client) memberQuery = memberQuery.useTransaction(client)
    const memberRows = await memberQuery
    const found = new Set(memberRows.map((row) => Number(row.userId)))

    if (found.size < userIds.length) {
      let orgQuery = Organization.query()
        .where('id', organizationId)
        .whereIn('owner_id', userIds)
        .select('owner_id')
      if (client) orgQuery = orgQuery.useTransaction(client)
      const owned = await orgQuery.first()
      if (owned) found.add(Number(owned.ownerId))
    }

    for (const userId of userIds) {
      if (!found.has(userId)) {
        throw new ValidationException('RACI 指派人员必须属于当前组织的有效成员', {
          status: 422,
          code: '422',
        } as never)
      }
    }
  }

  /** RACI 用户 ID 数组规范化：null/undefined → []，去重并强制正整数。 */
  private normalizeUserIdList(value: number[] | null | undefined, fieldName: string): number[] {
    if (value === null || value === undefined) return []
    if (!Array.isArray(value)) {
      throw new ValidationException(`${fieldName} 必须是用户 ID 数组`, {
        status: 422,
        code: '422',
      } as never)
    }
    const seen = new Set<number>()
    const ids: number[] = []
    for (const entry of value) {
      const id = Number(entry)
      if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationException(`${fieldName} 必须全部为正整数`, {
          status: 422,
          code: '422',
        } as never)
      }
      if (!seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    return ids
  }

  /** 可选字符串字段规范化：null/undefined/空串 → null。 */
  /** 建任务审计里的来源：customFields.source（如 calendar-quick-create）与 AI 补的字段。 */
  private creationSourceAudit(customFields: unknown): Record<string, unknown> {
    if (!customFields || typeof customFields !== 'object') return {}
    const fields = customFields as Record<string, unknown>
    const source = typeof fields.source === 'string' ? fields.source.slice(0, 64) : null
    if (!source) return {}
    const aiFields = Array.isArray(fields.aiFields)
      ? fields.aiFields.filter((item): item is string => typeof item === 'string').slice(0, 10)
      : []
    return { source, ...(aiFields.length > 0 ? { aiFields } : {}) }
  }

  private normalizeOptionalString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  private async projectOrFail(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<Project> {
    let query = Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (client) query = query.useTransaction(client)
    const project = await query.first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
    return project
  }

  private parseSortField(sort: string): { column: string; direction: 'asc' | 'desc' } {
    const direction = sort.startsWith('-') ? 'desc' : 'asc'
    const field = sort.replace(/^[+-]/, '')
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      status: 'status',
      priority: 'priority',
      startDate: 'start_date',
      endDate: 'end_date',
      dueDate: 'end_date',
    }
    return { column: columnMap[field] ?? 'created_at', direction }
  }

  /**
   * 批量附加列表项的 subtask_count / dependency_count 聚合（避免 N+1，design D8）。
   * dependency_count 对 task_dependencies 只读计（T015 前 始终为 0）。
   */
  private async attachListAggregates(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return
    const ids = tasks.map((t) => t.id)

    const subtaskRows = await db
      .from('tasks')
      .whereIn('parent_task_id', ids)
      .whereNull('deleted_at')
      .select('parent_task_id')
      .count('* as total')
      .groupBy('parent_task_id')

    const depRows = await db
      .from('task_dependencies as dependency')
      .join('tasks as predecessor', 'predecessor.id', 'dependency.predecessor_id')
      .join('tasks as successor', 'successor.id', 'dependency.successor_id')
      .where((query) =>
        query.whereIn('dependency.predecessor_id', ids).orWhereIn('dependency.successor_id', ids),
      )
      .whereNull('predecessor.deleted_at')
      .whereNull('successor.deleted_at')
      .select('dependency.predecessor_id', 'dependency.successor_id')

    const subtaskMap = new Map<number, number>()
    for (const row of subtaskRows) subtaskMap.set(Number(row.parent_task_id), Number(row.total))
    const depMap = new Map<number, number>()
    for (const row of depRows) {
      const predecessorId = Number(row.predecessor_id)
      const successorId = Number(row.successor_id)
      depMap.set(predecessorId, (depMap.get(predecessorId) ?? 0) + 1)
      depMap.set(successorId, (depMap.get(successorId) ?? 0) + 1)
    }

    for (const task of tasks) {
      task.$extras = {
        ...task.$extras,
        subtaskCount: subtaskMap.get(task.id) ?? 0,
        dependencyCount: depMap.get(task.id) ?? 0,
      }
    }
  }
}
