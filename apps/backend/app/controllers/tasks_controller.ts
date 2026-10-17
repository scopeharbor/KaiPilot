import { scheduleProjectSignalDetection } from '#services/project_signal/signal_auto_detect'
import TaskPolicy from '#policies/task_policy'
import { RealtimeEvents } from '#types/realtime_events'
import { ValidationException } from '#exceptions/api_exception'
import TaskBatchService from '#services/task_batch_service'
import TaskService from '#services/task_service'
import CommentService from '#services/comment_service'
import TenantOwnershipResolverService from '#services/tenant_ownership_resolver_service'
import { taskDto } from '#types/dto'
import {
  batchRestoreTasksValidator,
  batchTasksValidator,
  changeTaskStatusValidator,
  createTaskValidator,
  listRecycleBinTasksValidator,
  listTasksValidator,
  updateTaskValidator,
} from '#validators/task'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type Task from '#models/task'
import {
  withTenantBoundaryDetailMeta,
  withTenantBoundaryListMeta,
} from '#services/tenant_boundary_envelope_helper'

@inject()
export default class TasksController {
  constructor(
    private tasks: TaskService,
    private taskBatch: TaskBatchService,
    private policy: TaskPolicy,
    private comments: CommentService,
    private ownership: TenantOwnershipResolverService,
  ) {}

  /**
   * 任务归属前置校验（v3-multitenant-tenant-identification §5.3）。
   *
   * task 是 tenant-derived 资源（`tasks.project_id` → `projects.organization_id`），
   * 归属要两跳反推。这里校验 taskId 本身而非只校验父项目：只校验 projectId 会漏掉
   * "项目属于我、任务 ID 却是别人的"这一类混用。
   */
  private async assertTaskOwnership(ctx: HttpContext, taskId: number) {
    await this.ownership.assertRouteResourceOwnership({
      resourceType: 'task',
      resourceId: taskId,
      effectiveOrganizationId: ctx.tenant?.organizationId ?? null,
      decision: ctx.tenantDecision ?? null,
      userId: ctx.authUser?.id ?? null,
      requestId: ctx.request.id() ?? 'unknown',
    })
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
      ip: request.ip(),
      userAgent: request.header('user-agent') ?? '',
    }
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const filters = await ctx.request.validateUsing(listTasksValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.tasks.list(ctx.tenant!.organizationId, projectId, {
      status: filters.status,
      priority: filters.priority,
      assigneeId: filters.assigneeId,
      search: filters.search,
      roleHint: filters.roleHint,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      sort: filters.sort,
      page: filters.page,
      perPage: filters.perPage,
    })
    void user
    return ctx.response.ok(
      withTenantBoundaryListMeta(ctx.tenantApiBoundary, {
        data: data.map((t) =>
          taskDto(t, {
            subtaskCount: Number(t.$extras?.subtaskCount ?? 0),
            dependencyCount: Number(t.$extras?.dependencyCount ?? 0),
          }),
        ),
        meta,
      }),
    )
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createTaskValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const task = await this.tasks.create(
      ctx.tenant!.organizationId,
      projectId,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        priority: input.priority,
        taskType: input.taskType,
        startDate: input.startDate,
        endDate: input.endDate,
        durationDays: input.durationDays,
        estimatedHours: input.estimatedHours,
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
        parentTaskId: input.parentTaskId,
        wbsNodeId: input.wbsNodeId,
        milestoneId: input.milestoneId,
        costEstimateCents: input.costEstimateCents,
        customFields: input.customFields as Record<string, unknown> | null | undefined,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: taskDto(task) })
  }

  async show(ctx: HttpContext) {
    const projectId = Number(ctx.params.projectId)
    const taskId = Number(ctx.params.taskId)
    await this.assertTaskOwnership(ctx, taskId)
    const task = await this.tasks.get(ctx.tenant!.organizationId, projectId, taskId)

    // 获取评论数量
    const commentCount = await this.comments.getTaskCommentCount(
      ctx.tenant!.organizationId,
      projectId,
      taskId,
    )

    return ctx.response.ok(
      withTenantBoundaryDetailMeta(ctx.tenantApiBoundary, {
        data: taskDto(task, {
          dependencyCount: Number(task.$extras?.dependencyCount ?? 0),
          commentCount,
        }),
      }),
    )
  }

  /** GET /projects/:projectId/tasks/role-hints —— AI 建议岗位及任务数。 */
  async roleHints(ctx: HttpContext) {
    const data = await this.tasks.roleHints(
      ctx.tenant!.organizationId,
      Number(ctx.params.projectId),
    )
    return ctx.response.ok({ data })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateTaskValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const taskId = Number(ctx.params.taskId)

    // 行级权限：task:update 任意；task:update:self 仅本人
    const target = await this.tasks.getForAuthorize(ctx.tenant!.organizationId, projectId, taskId)
    await this.policy.authorizeUpdate(user, ctx.tenant!.organizationId, projectId, target)

    // assignee/reviewer 变更需 task:assign
    if (input.assigneeId !== undefined || input.reviewerId !== undefined) {
      await this.policy.authorizeAssign(user, ctx.tenant!.organizationId, projectId)
    }

    // 排期（开始 / 截止 / 工期）实际变化时需 task:update：普通成员不能自行推迟截止日、
    // 打乱依赖链；前端会带上原值一起提交，所以只拦「值确实变了」
    const sameDate = (
      next: string | null | undefined,
      current: { toISODate(): string | null } | null,
    ) => next === undefined || (next ?? null) === (current?.toISODate() ?? null)
    const scheduleChanged =
      !sameDate(input.startDate, target.startDate) ||
      !sameDate(input.endDate, target.endDate) ||
      (input.durationDays !== undefined && input.durationDays !== target.durationDays)
    if (scheduleChanged) {
      await this.policy.authorizeScheduleChange(user, ctx.tenant!.organizationId, projectId)
    }

    const task = await this.tasks.update(
      ctx.tenant!.organizationId,
      projectId,
      taskId,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        priority: input.priority,
        taskType: input.taskType,
        startDate: input.startDate,
        endDate: input.endDate,
        durationDays: input.durationDays,
        estimatedHours: input.estimatedHours,
        actualHours: input.actualHours,
        assigneeId: input.assigneeId,
        reviewerId: input.reviewerId,
        parentTaskId: input.parentTaskId,
        wbsNodeId: input.wbsNodeId,
        milestoneId: input.milestoneId,
        costEstimateCents: input.costEstimateCents,
        costActualCents: input.costActualCents,
        progressPercent: input.progressPercent,
        customFields: input.customFields as Record<string, unknown> | null | undefined,
        // V3 图表馆 RACI/LOB：咨询/知会人数组与流水空间单元/工序阶段（成员校验在 TaskService）
        consultedUserIds: input.consultedUserIds ?? null,
        informedUserIds: input.informedUserIds ?? null,
        locationUnit: input.locationUnit ?? null,
        cycleStage: input.cycleStage ?? null,
      },
      user.id,
      this.auditContext(ctx),
    )
    // 状态 / 进度 / 排期变了：后台按规则重新检测该项目的信号（节流、不阻塞响应）
    scheduleProjectSignalDetection({ organizationId: ctx.tenant!.organizationId, projectId, user })
    return ctx.response.ok({
      data: taskDto(task),
      meta: { warnings: this.tasks.warnings.get(taskId) ?? [] },
    })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.tasks.delete(
      ctx.tenant!.organizationId,
      projectId,
      Number(ctx.params.taskId),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.noContent()
  }

  async restore(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const task = await this.tasks.restore(
      ctx.tenant!.organizationId,
      projectId,
      Number(ctx.params.taskId),
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: taskDto(task) })
  }

  async status(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(changeTaskStatusValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const taskId = Number(ctx.params.taskId)

    const target = await this.tasks.getForAuthorize(ctx.tenant!.organizationId, projectId, taskId)
    await this.policy.authorizeUpdate(user, ctx.tenant!.organizationId, projectId, target)

    const task = await this.tasks.changeStatus(
      ctx.tenant!.organizationId,
      projectId,
      taskId,
      {
        status: input.status,
        actualHours: input.actualHours,
        progressPercent: input.progressPercent,
        note: input.note,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({
      data: taskDto(task),
      meta: { warnings: this.tasks.warnings.get(taskId) ?? [] },
    })
  }

  async batch(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(batchTasksValidator)
    if (input.action === 'update' && Object.keys(input.data).length === 0) {
      throw new ValidationException('批量编辑至少需要一个变更字段')
    }
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    this.policy.enableRequestMemo()

    const result = await this.taskBatch.execute<Task | null>(
      input.taskIds,
      async (taskId, transaction) => {
        if (input.action === 'delete') {
          await this.tasks.delete(
            organizationId,
            projectId,
            taskId,
            user.id,
            this.auditContext(ctx),
            transaction,
          )
          return null
        }

        if (input.action === 'reassign') {
          return this.tasks.update(
            organizationId,
            projectId,
            taskId,
            { assigneeId: input.data.assigneeId },
            user.id,
            this.auditContext(ctx),
            transaction,
          )
        }

        if (input.action === 'change_status') {
          return this.tasks.changeStatus(
            organizationId,
            projectId,
            taskId,
            input.data,
            user.id,
            this.auditContext(ctx),
            transaction,
          )
        }

        return this.tasks.update(
          organizationId,
          projectId,
          taskId,
          input.data,
          user.id,
          this.auditContext(ctx),
          transaction,
        )
      },
      async (taskId) => {
        const target = await this.tasks.getForAuthorize(organizationId, projectId, taskId)
        if (input.action === 'delete') {
          await this.policy.authorizeDelete(user, organizationId, projectId)
          return
        }

        await this.policy.authorizeUpdate(user, organizationId, projectId, target)
        if (
          input.action === 'reassign' ||
          (input.action === 'update' && input.data.reviewerId !== undefined)
        ) {
          await this.policy.authorizeAssign(user, organizationId, projectId)
        }
      },
    )

    // 批量写在事务内完成、不逐条广播；提交后按成功项补发，其他在线成员实时刷新
    const eventType =
      input.action === 'delete'
        ? RealtimeEvents.TASK_DELETED
        : input.action === 'change_status'
          ? RealtimeEvents.TASK_STATUS_CHANGED
          : RealtimeEvents.TASK_UPDATED
    for (const item of result.results) {
      if (item.success) {
        this.tasks.broadcastTaskEvent(organizationId, projectId, item.taskId, user.id, eventType)
      }
    }

    return ctx.response.ok({
      data: {
        action: input.action,
        total: result.total,
        successCount: result.successCount,
        failedCount: result.failedCount,
        results: result.results.map((item) =>
          item.success
            ? {
                taskId: item.taskId,
                success: true,
                ...(item.value ? { task: taskDto(item.value) } : {}),
              }
            : item,
        ),
      },
    })
  }

  async recycleBin(ctx: HttpContext) {
    const filters = await ctx.request.validateUsing(listRecycleBinTasksValidator, {
      data: ctx.request.qs(),
    })
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeDelete(user, organizationId, projectId)

    const result = await this.tasks.listRecycleBin(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async batchRestore(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(batchRestoreTasksValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeDelete(user, organizationId, projectId)

    const result = await this.taskBatch.execute<Task>(input.taskIds, (taskId, transaction) =>
      this.tasks.restore(
        organizationId,
        projectId,
        taskId,
        user.id,
        this.auditContext(ctx),
        transaction,
      ),
    )

    return ctx.response.ok({
      data: {
        action: 'restore',
        total: result.total,
        successCount: result.successCount,
        failedCount: result.failedCount,
        results: result.results.map((item) =>
          item.success ? { taskId: item.taskId, success: true, task: taskDto(item.value) } : item,
        ),
      },
    })
  }
}
