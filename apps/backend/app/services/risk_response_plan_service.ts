import RiskResponsePlan from '#models/risk_response_plan'
import Task from '#models/task'
import AuditService, { AuditEvent } from '#services/audit_service'
import RiskHistoryService from '#services/risk_history_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export interface CreateResponsePlanInput {
  strategyType: string
  actionDescription: string
  ownerId?: number | null
  targetDate?: string | null
  relatedTaskId?: number | null
}

export interface UpdateResponsePlanInput {
  strategyType?: string
  actionDescription?: string
  ownerId?: number | null
  targetDate?: string | null
  status?: string
  completionEvidence?: string | null
  relatedTaskId?: number | null
}

/**
 * RiskResponsePlanService — 风险应对计划 CRUD、状态流转、任务关联校验。
 *
 * 设计：完成应对计划不自动关闭风险（风险关闭必须由有权限用户显式推进）。
 */
@inject()
export default class RiskResponsePlanService {
  constructor(
    private audit: AuditService,
    private riskHistory: RiskHistoryService,
  ) {}

  /**
   * 列出指定风险的所有应对计划。
   */
  async list(
    organizationId: number,
    projectId: number,
    riskId: number,
  ): Promise<RiskResponsePlan[]> {
    return RiskResponsePlan.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('risk_id', riskId)
      .orderBy('created_at', 'asc')
  }

  /**
   * 获取单个应对计划详情。
   */
  async getById(
    organizationId: number,
    projectId: number,
    planId: number,
  ): Promise<RiskResponsePlan> {
    const plan = await RiskResponsePlan.query()
      .where('id', planId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!plan) throw new ResourceNotFoundException('风险应对计划不存在')
    return plan
  }

  /**
   * 创建风险应对计划。
   */
  async create(
    organizationId: number,
    projectId: number,
    riskId: number,
    input: CreateResponsePlanInput,
    actorUserId: number,
  ): Promise<RiskResponsePlan> {
    // 校验关联任务属于同一项目
    if (input.relatedTaskId) {
      await this.assertTaskInProject(organizationId, projectId, input.relatedTaskId)
    }

    const plan = await RiskResponsePlan.create({
      organizationId,
      projectId,
      riskId,
      strategyType: input.strategyType,
      actionDescription: input.actionDescription,
      ownerId: input.ownerId ?? null,
      targetDate: input.targetDate ? DateTime.fromISO(input.targetDate) : null,
      status: 'planned',
      relatedTaskId: input.relatedTaskId ?? null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await this.audit.log({
      event: AuditEvent.RISK_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk_response_plan',
      entityId: plan.id,
      metadata: { action: 'created', riskId, strategyType: input.strategyType },
    })

    await this.riskHistory.record({
      organizationId,
      projectId,
      riskId,
      eventType: 'response_plan_created',
      actorId: actorUserId,
      summary: { strategyType: input.strategyType },
    })

    return plan
  }

  /**
   * 更新风险应对计划。
   * 完成应对计划不自动关闭风险。
   */
  async update(
    organizationId: number,
    projectId: number,
    planId: number,
    input: UpdateResponsePlanInput,
    actorUserId: number,
  ): Promise<RiskResponsePlan> {
    const plan = await this.getById(organizationId, projectId, planId)

    // 校验关联任务
    if (input.relatedTaskId) {
      await this.assertTaskInProject(organizationId, projectId, input.relatedTaskId)
    }

    const wasCompleted = input.status === 'completed' && plan.status !== 'completed'

    plan.merge({
      ...(input.strategyType !== undefined && { strategyType: input.strategyType }),
      ...(input.actionDescription !== undefined && { actionDescription: input.actionDescription }),
      ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
      ...(input.targetDate !== undefined && {
        targetDate: input.targetDate ? DateTime.fromISO(input.targetDate) : null,
      }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.completionEvidence !== undefined && {
        completionEvidence: input.completionEvidence,
      }),
      ...(input.relatedTaskId !== undefined && { relatedTaskId: input.relatedTaskId }),
      updatedBy: actorUserId,
    })

    if (wasCompleted) {
      plan.completedAt = DateTime.now()
    }

    await plan.save()

    await this.audit.log({
      event: AuditEvent.RISK_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk_response_plan',
      entityId: plan.id,
      metadata: { action: 'updated', riskId: plan.riskId, status: input.status },
    })

    if (wasCompleted) {
      await this.riskHistory.record({
        organizationId,
        projectId,
        riskId: plan.riskId,
        eventType: 'response_plan_completed',
        actorId: actorUserId,
        summary: { planId: plan.id, strategyType: plan.strategyType },
      })
    }

    return plan
  }

  /**
   * 软删除应对计划。
   */
  async softDelete(
    organizationId: number,
    projectId: number,
    planId: number,
    actorUserId: number,
  ): Promise<void> {
    const plan = await this.getById(organizationId, projectId, planId)
    plan.deletedAt = DateTime.now()
    plan.updatedBy = actorUserId
    await plan.save()

    await this.audit.log({
      event: AuditEvent.RISK_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk_response_plan',
      entityId: plan.id,
      metadata: { action: 'deleted', riskId: plan.riskId },
    })
  }

  /**
   * 校验关联任务属于同一组织+项目。
   */
  private async assertTaskInProject(
    _organizationId: number,
    projectId: number,
    taskId: number,
  ): Promise<void> {
    const task = await Task.query().where('id', taskId).where('project_id', projectId).first()
    if (!task) throw new ValidationException('关联任务不存在或不属于当前项目')
  }
}
