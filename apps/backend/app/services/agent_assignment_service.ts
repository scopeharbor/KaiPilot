/**
 * Agent 分配服务（v3-copilot-agent-as-assignee）。
 *
 * 职责：
 * - 分配 AI Agent 执行任务（assignAgent）
 * - 标记分配完成（completeAssignment）
 * - 检测逾期分配并回退（handleOverdue）
 *
 * 安全约束：
 * - 不携带 prompt/modelOutput/token/secret 等敏感数据
 * - 所有方法必须包含 organizationId 做组织隔离
 * - 分配操作者必须是项目活跃成员
 */

import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import AgentAssignment from '#models/agent_assignment'
import Task from '#models/task'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import NotificationService from '#services/notification_service'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { AuthContext } from '#types/auth'

export interface AssignAgentInput {
  /** 任务 ID */
  taskId: number
  /** 截止时间（ISO 8601 格式） */
  dueTime: string
  /** 备注（可选） */
  notes?: string | null
}

export interface AgentAssignmentFilters {
  status?: string
  projectId?: number
  page?: number
  perPage?: number
}

/**
 * Agent 分配状态枚举
 */
export const AgentAssignmentStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
  FAILED: 'failed',
} as const

export type AgentAssignmentStatusType =
  (typeof AgentAssignmentStatus)[keyof typeof AgentAssignmentStatus]

@inject()
export default class AgentAssignmentService {
  constructor(
    private audit: AuditService,
    private notifications: NotificationService,
  ) {}

  /**
   * 分配 AI Agent 执行任务。
   *
   * 校验规则：
   * 1. 必须提供截止时间（dueTime）
   * 2. 分配操作者必须是项目活跃成员
   * 3. 任务必须存在且属于指定项目/组织
   * 4. 任务不能设置 estimatedHours（Agent 分配不计工时）
   * 5. 同一任务只能有一个 pending 状态的 Agent 分配
   */
  async assignAgent(
    organizationId: number,
    projectId: number,
    input: AssignAgentInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<AgentAssignment> {
    // 校验组织/项目存在
    await this.projectOrFail(organizationId, projectId)

    // §7.2：指派 Agent 需要与指派人类相同或更高的权限——复用项目成员校验
    await this.assertActorProjectMember(projectId, actorUserId, organizationId)

    // 必须提供截止时间
    if (!input.dueTime) {
      throw new ValidationException('Agent 分配必须提供截止时间', {
        status: 422,
        code: '422',
      } as never)
    }

    const dueTime = DateTime.fromISO(input.dueTime)
    if (!dueTime.isValid) {
      throw new ValidationException('截止时间格式无效', {
        status: 422,
        code: '422',
      } as never)
    }

    // 截止时间不能是过去的
    if (dueTime < DateTime.now()) {
      throw new ValidationException('截止时间不能是过去的时间', {
        status: 422,
        code: '422',
      } as never)
    }

    // 校验任务存在
    const task = await Task.query().where('id', input.taskId).where('project_id', projectId).first()
    if (!task) {
      throw new ResourceNotFoundException('任务不存在')
    }

    // Agent 分配不能设置 estimatedHours
    if (task.estimatedHours !== null && task.estimatedHours !== undefined) {
      throw new ValidationException('Agent 分配的任务不能设置预估工时', {
        status: 422,
        code: '422',
      } as never)
    }

    // 检查是否已有 pending 的 Agent 分配
    const existingPending = await AgentAssignment.query()
      .where('task_id', input.taskId)
      .where('status', AgentAssignmentStatus.PENDING)
      .first()
    if (existingPending) {
      throw new ValidationException('该任务已有待处理的 Agent 分配', {
        status: 422,
        code: '422',
      } as never)
    }

    // 创建分配记录
    const assignment = await AgentAssignment.create({
      taskId: input.taskId,
      projectId,
      organizationId,
      assigneeType: 'agent',
      assignedBy: actorUserId,
      dueTime,
      status: AgentAssignmentStatus.PENDING,
      notes: input.notes ?? null,
    })

    // 审计日志
    await this.audit.log({
      event: AuditEvent.AGENT_ASSIGNMENT_CREATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'agent_assignment',
      entityId: assignment.id,
      requestId: ctx.requestId ?? null,
      metadata: {
        taskId: input.taskId,
        dueTime: input.dueTime,
        assigneeType: 'agent',
      },
      strict: true,
    })

    // 通知任务创建者（使用 'general' 类型，DB CHECK 约束不含 agent 专用类型）
    await this.notifications.createForUser({
      organizationId,
      recipientId: actorUserId,
      type: 'general',
      title: `AI Agent 已分配执行任务：「${task.name}」`,
      body: `AI Agent 将在 ${dueTime.toFormat('yyyy-MM-dd HH:mm')} 前执行任务「${task.name}」。`,
      severity: 'info',
      projectId,
      targetType: 'task',
      targetId: task.id,
      idempotencyKey: `agent_assignment:${assignment.id}:created:${actorUserId}`,
      metadata: {
        notificationKind: 'agent_assignment_created',
        taskName: task.name,
        projectId,
        dueTime: input.dueTime,
      },
    })

    return assignment
  }

  /**
   * 标记 Agent 分配为已完成。
   *
   * @param assignmentId 分配记录 ID
   * @param draftId 关联的 AI 草案 ID（可选）
   */
  async completeAssignment(
    assignmentId: number,
    draftId: number | null = null,
  ): Promise<AgentAssignment> {
    const assignment = await AgentAssignment.findOrFail(assignmentId)

    if (assignment.status !== AgentAssignmentStatus.PENDING) {
      throw new ValidationException('只能完成待处理的分配', {
        status: 422,
        code: '422',
      } as never)
    }

    assignment.status = AgentAssignmentStatus.COMPLETED
    assignment.draftId = draftId
    await assignment.save()

    // 审计日志
    await this.audit.log({
      event: AuditEvent.AGENT_ASSIGNMENT_COMPLETED,
      userId: assignment.assignedBy,
      organizationId: assignment.organizationId,
      projectId: assignment.projectId,
      entityType: 'agent_assignment',
      entityId: assignment.id,
      metadata: {
        taskId: assignment.taskId,
        draftId,
        completedAt: DateTime.now().toISO(),
      },
      strict: true,
    })

    // 通知分配操作者
    const task = await Task.find(assignment.taskId)
    if (task) {
      await this.notifications.createForUser({
        organizationId: assignment.organizationId,
        recipientId: assignment.assignedBy,
        type: 'general',
        title: `AI Agent 已完成任务：「${task.name}」`,
        body: `AI Agent 已完成任务「${task.name}」的执行。`,
        severity: 'info',
        projectId: assignment.projectId,
        targetType: 'task',
        targetId: task.id,
        idempotencyKey: `agent_assignment:${assignment.id}:completed`,
        metadata: {
          notificationKind: 'agent_assignment_completed',
          taskName: task.name,
          projectId: assignment.projectId,
          draftId,
        },
      })
    }

    return assignment
  }

  /**
   * 检测并处理逾期分配。
   *
   * 找到所有状态为 pending 且已超过截止时间的分配：
   * 1. 将状态更新为 overdue
   * 2. 清除任务的 assigneeId
   * 3. 创建草案占位符（返回）
   * 4. 发送通知
   * 5. 记录审计日志
   *
   * @returns 处理的逾期分配数量
   */
  async handleOverdue(): Promise<number> {
    const now = DateTime.now()

    // 查找所有逾期的 pending 分配
    const overdueAssignments = await AgentAssignment.query()
      .where('status', AgentAssignmentStatus.PENDING)
      .where('due_time', '<', now.toSQL()!)

    let processedCount = 0

    for (const assignment of overdueAssignments) {
      try {
        await db.transaction(async (trx) => {
          // 更新分配状态为 overdue
          assignment.status = AgentAssignmentStatus.OVERDUE
          assignment.useTransaction(trx)
          await assignment.save()

          // 清除任务的 assigneeId 和 assigneeType
          await Task.query({ client: trx }).where('id', assignment.taskId).update({
            assignee_id: null,
            assignee_type: 'user',
          })

          // 审计日志
          await this.audit.log({
            event: AuditEvent.AGENT_ASSIGNMENT_OVERDUE_FALLBACK,
            userId: assignment.assignedBy,
            organizationId: assignment.organizationId,
            projectId: assignment.projectId,
            entityType: 'agent_assignment',
            entityId: assignment.id,
            metadata: {
              taskId: assignment.taskId,
              dueTime: assignment.dueTime.toISO(),
              overdueAt: now.toISO(),
            },
            client: trx,
            strict: true,
          })

          // §5.2：通知分配操作者 + 项目管理者
          const task = await Task.query({ client: trx }).where('id', assignment.taskId).first()
          if (task) {
            // 通知分配操作者
            await this.notifications.createForUser({
              organizationId: assignment.organizationId,
              recipientId: assignment.assignedBy,
              type: 'general',
              title: `AI Agent 任务已逾期：「${task.name}」`,
              body: `AI Agent 未能在截止时间 ${assignment.dueTime.toFormat('yyyy-MM-dd HH:mm')} 前完成任务「${task.name}」。`,
              severity: 'warning',
              projectId: assignment.projectId,
              targetType: 'task',
              targetId: task.id,
              idempotencyKey: `agent_assignment:${assignment.id}:overdue:assigner`,
              metadata: {
                notificationKind: 'agent_assignment_overdue',
                taskName: task.name,
                projectId: assignment.projectId,
                dueTime: assignment.dueTime.toISO(),
              },
            })

            // 通知项目管理者（若与分配操作者不同）
            const proj = await Project.query({ client: trx })
              .where('id', assignment.projectId)
              .first()
            if (proj && Number(proj.createdBy) !== assignment.assignedBy) {
              await this.notifications.createForUser({
                organizationId: assignment.organizationId,
                recipientId: Number(proj.createdBy),
                type: 'general',
                title: `AI Agent 任务已逾期：「${task.name}」`,
                body: `AI Agent 未能在截止时间 ${assignment.dueTime.toFormat('yyyy-MM-dd HH:mm')} 前完成任务「${task.name}」，请指定人类负责人。`,
                severity: 'warning',
                projectId: assignment.projectId,
                targetType: 'task',
                targetId: task.id,
                idempotencyKey: `agent_assignment:${assignment.id}:overdue:pm`,
                metadata: {
                  notificationKind: 'agent_assignment_overdue',
                  taskName: task.name,
                  projectId: assignment.projectId,
                  dueTime: assignment.dueTime.toISO(),
                  recipientRole: 'project_manager',
                },
              })
            }
          }
        })

        processedCount++
      } catch (error) {
        logger.error(
          {
            assignmentId: assignment.id,
            error: error instanceof Error ? error.message : 'unknown',
          },
          '处理逾期 Agent 分配失败',
        )
      }
    }

    return processedCount
  }

  /**
   * 查询 Agent 分配列表（组织隔离）。
   */
  async list(
    organizationId: number,
    projectId: number,
    filters: AgentAssignmentFilters = {},
  ): Promise<{
    data: AgentAssignment[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    let query = AgentAssignment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters.status) {
      query = query.where('status', filters.status)
    }

    query = query.orderBy('created_at', 'desc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  /**
   * 获取单个 Agent 分配详情。
   */
  async get(
    organizationId: number,
    projectId: number,
    assignmentId: number,
  ): Promise<AgentAssignment> {
    await this.projectOrFail(organizationId, projectId)

    const assignment = await AgentAssignment.query()
      .where('id', assignmentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('task')
      .preload('assigner')
      .first()

    if (!assignment) {
      throw new ResourceNotFoundException('Agent 分配记录不存在')
    }

    return assignment
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /**
   * §7.2：校验操作者是项目的活跃成员或创建者。
   * 复用 TaskService 的既有校验逻辑，确保指派 Agent 的权限不低于指派人类。
   */
  private async assertActorProjectMember(
    projectId: number,
    actorUserId: number,
    organizationId: number,
  ): Promise<void> {
    // 项目创建者默认有权限
    const project = await Project.query().where('id', projectId).first()
    if (project && Number(project.createdBy) === actorUserId) return

    // 检查项目成员
    const member = await db
      .from('project_members')
      .where('project_id', projectId)
      .where('user_id', actorUserId)
      .where('is_active', true)
      .first()
    if (member) return

    // 检查组织成员（sec08.3.1 成员语义对齐组织成员）
    const orgMember = await db
      .from('organization_members')
      .where('organization_id', organizationId)
      .where('user_id', actorUserId)
      .first()
    if (orgMember) return

    throw new ValidationException('指派 Agent 需要项目成员或组织成员权限', {
      status: 403,
      code: '403',
    } as never)
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
}
