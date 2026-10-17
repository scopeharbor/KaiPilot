import Risk from '#models/risk'
import RiskResponsePlan from '#models/risk_response_plan'
import RiskSignalCandidate from '#models/risk_signal_candidate'
import RiskKnowledgeTemplate from '#models/risk_knowledge_template'
import RiskPolicy from '#policies/risk_policy'
import RiskService from '#services/risk_service'
import RiskReviewService from '#services/risk_review_service'
import RiskResponsePlanService from '#services/risk_response_plan_service'
import RiskHistoryService from '#services/risk_history_service'
import RiskMatrixConfigService from '#services/risk_matrix_config_service'
import RiskWorkbenchService from '#services/risk_workbench_service'
import RiskRuleRegistry, { RiskSignalEvaluator } from '#services/risk_signal_evaluator'
import AuditService, { AuditEvent } from '#services/audit_service'
import db from '@adonisjs/lucid/services/db'
import {
  createRiskMatrixConfigValidator,
  createResponsePlanValidator,
  updateResponsePlanValidator,
  reviewRiskValidator,
  acceptCandidateValidator,
  createKnowledgeTemplateValidator,
} from '#validators/risk'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { DateTime } from 'luxon'

@inject()
export default class RiskV2Controller {
  constructor(
    private riskService: RiskService,
    private reviewService: RiskReviewService,
    private responsePlanService: RiskResponsePlanService,
    private riskHistory: RiskHistoryService,
    private matrixConfig: RiskMatrixConfigService,
    private workbench: RiskWorkbenchService,
    private policy: RiskPolicy,
    private audit: AuditService,
    private ruleRegistry: RiskRuleRegistry,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /** 4.1 风险工作台摘要 */
  async summary(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const result = await this.workbench.getSummary(ctx.tenant!.organizationId, projectId)
    return ctx.response.ok({ data: result })
  }

  /** 4.1 风险趋势 */
  async trend(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const days = Math.min(Number(ctx.request.qs().days) || 30, 365)
    const result = await this.workbench.getTrend(ctx.tenant!.organizationId, projectId, days)
    return ctx.response.ok({ data: result })
  }

  /** 4.1 复查队列 */
  async reviewQueue(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const result = await this.workbench.getReviewQueue(ctx.tenant!.organizationId, projectId)
    return ctx.response.ok({ data: result })
  }

  /** 4.1 获取矩阵配置 */
  async getMatrixConfig(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const config = await this.matrixConfig.get(ctx.tenant!.organizationId, projectId)
    if (config) return ctx.response.ok({ data: config })
    return ctx.response.ok({ data: this.matrixConfig.getDefaultConfig() })
  }

  /** 4.1 更新矩阵配置 */
  async updateMatrixConfig(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createRiskMatrixConfigValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, ctx.tenant!.organizationId, projectId)
    const config = await this.matrixConfig.upsert(
      ctx.tenant!.organizationId,
      projectId,
      input,
      user.id,
    )
    return ctx.response.ok({ data: config })
  }

  /** 4.1 列出应对计划 */
  async listResponsePlans(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const riskId = Number(ctx.params.riskId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const plans = await this.responsePlanService.list(ctx.tenant!.organizationId, projectId, riskId)
    return ctx.response.ok({ data: plans })
  }

  /** 4.1 创建应对计划 */
  async createResponsePlan(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createResponsePlanValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const riskId = Number(ctx.params.riskId)
    await this.policy.authorizeManage(user, ctx.tenant!.organizationId, projectId)
    const plan = await this.responsePlanService.create(
      ctx.tenant!.organizationId,
      projectId,
      riskId,
      input,
      user.id,
    )
    return ctx.response.created({ data: plan })
  }

  /** 4.1 更新应对计划 */
  async updateResponsePlan(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateResponsePlanValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const planId = Number(ctx.params.planId)
    await this.policy.authorizeManage(user, ctx.tenant!.organizationId, projectId)
    const plan = await this.responsePlanService.update(
      ctx.tenant!.organizationId,
      projectId,
      planId,
      input,
      user.id,
    )
    return ctx.response.ok({ data: plan })
  }

  /** 4.1 删除应对计划 */
  async deleteResponsePlan(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const planId = Number(ctx.params.planId)
    await this.policy.authorizeManage(user, ctx.tenant!.organizationId, projectId)
    await this.responsePlanService.softDelete(
      ctx.tenant!.organizationId,
      projectId,
      planId,
      user.id,
    )
    return ctx.response.noContent()
  }

  /** 4.1 提交复查 */
  async review(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(reviewRiskValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const riskId = Number(ctx.params.riskId)
    await this.policy.authorizeManage(user, ctx.tenant!.organizationId, projectId)
    const risk = await this.reviewService.review(
      ctx.tenant!.organizationId,
      projectId,
      riskId,
      input,
      user.id,
    )
    return ctx.response.ok({ data: risk })
  }

  /** 4.1 风险历史 */
  async history(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const riskId = Number(ctx.params.riskId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)
    const page = Number(ctx.request.qs().page) || 1
    const perPage = Math.min(Number(ctx.request.qs().perPage) || 20, 100)
    const result = await this.riskHistory.list(
      ctx.tenant!.organizationId,
      projectId,
      riskId,
      page,
      perPage,
    )
    return ctx.response.ok(result)
  }

  /** 3.3/4.1 评估规则候选 */
  async evaluateCandidates(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeView(user, organizationId, projectId)

    // 构造输入：从项目各事实源读取
    const evaluator = new RiskSignalEvaluator(this.ruleRegistry)

    // 简单实现：收集基本数据
    const overdueTasks = await this.collectOverdueTasks(organizationId, projectId)
    const overdueReviews = await this.collectOverdueReviews(organizationId, projectId)
    const incompletePlans = await this.collectIncompletePlans(organizationId, projectId)

    const input = {
      projectId,
      organizationId,
      overdueTasks,
      criticalPathTasks: [],
      resourceOverloads: [],
      overdueReviews,
      incompleteResponsePlans: incompletePlans,
      upcomingMilestones: [],
    }

    const candidates = evaluator.evaluate(input)
    return ctx.response.ok({ data: candidates })
  }

  /** 3.5/4.1 采纳候选 */
  async acceptCandidate(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(acceptCandidateValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const candidateId = Number(ctx.params.candidateId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeManage(user, organizationId, projectId)

    const candidate = await RiskSignalCandidate.query()
      .where('id', candidateId)
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .where('status', 'pending')
      .first()
    if (!candidate)
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '候选不存在或已处理' },
      })

    // 通过 RiskService.create 创建正式风险
    const risk = await this.riskService.create(
      organizationId,
      projectId,
      {
        title: input.title ?? candidate.recommendedAction.slice(0, 255),
        description: `来源：规则候选 (${candidate.ruleId})\n${candidate.recommendedAction}`,
        category: input.category ?? 'other',
        probability: input.probability ?? 3,
        impact: input.impact ?? 3,
        ownerId: input.ownerId ?? null,
      },
      user.id,
    )

    // 更新候选状态
    candidate.status = 'accepted'
    candidate.resolvedBy = user.id
    candidate.resolvedAt = DateTime.now()
    candidate.acceptedRiskId = risk.id
    await candidate.save()

    await this.audit.log({
      event: AuditEvent.RISK_CREATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'risk_signal_candidate',
      entityId: candidate.id,
      metadata: { action: 'candidate_accepted', ruleId: candidate.ruleId, riskId: risk.id },
    })

    return ctx.response.created({ data: risk })
  }

  /** 3.6/4.1 拒绝候选 */
  async rejectCandidate(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const candidateId = Number(ctx.params.candidateId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeManage(user, organizationId, projectId)

    const candidate = await RiskSignalCandidate.query()
      .where('id', candidateId)
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .where('status', 'pending')
      .first()
    if (!candidate)
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '候选不存在或已处理' },
      })

    candidate.status = 'rejected'
    candidate.resolvedBy = user.id
    candidate.resolvedAt = DateTime.now()
    await candidate.save()

    await this.audit.log({
      event: AuditEvent.RISK_AI_REJECTED,
      userId: user.id,
      organizationId,
      projectId,
      metadata: {
        action: 'candidate_rejected',
        ruleId: candidate.ruleId,
        candidateId: candidate.id,
      },
    })

    return ctx.response.ok({ data: { rejected: true } })
  }

  /** 3.10/4.1 列出知识库模板 */
  async listTemplates(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeView(user, organizationId, projectId)

    const templates = await RiskKnowledgeTemplate.query()
      .where((q) => {
        q.whereNull('organization_id').orWhere('organization_id', organizationId)
      })
      .where('is_active', true)
      .orderBy('template_type', 'asc')
      .orderBy('created_at', 'desc')

    return ctx.response.ok({ data: templates })
  }

  /** 3.10/4.1 创建知识库模板 */
  async createTemplate(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createKnowledgeTemplateValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId
    await this.policy.authorizeManage(user, organizationId, projectId)

    const template = await RiskKnowledgeTemplate.create({
      organizationId,
      title: input.title,
      description: input.description,
      category: input.category,
      applicableProjectTypes: input.applicableProjectTypes ?? null,
      triggerConditions: input.triggerConditions ?? null,
      suggestedProbability: input.suggestedProbability ?? null,
      suggestedImpact: input.suggestedImpact ?? null,
      suggestedResponse: input.suggestedResponse ?? null,
      source: input.source ?? 'organization',
      isActive: true,
      templateType: 'organization',
      createdBy: user.id,
      updatedBy: user.id,
    })

    return ctx.response.created({ data: template })
  }

  // ---- 私有辅助方法 ----

  private async collectOverdueTasks(_organizationId: number, projectId: number) {
    const rows = await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotIn('status', ['completed', 'cancelled'])
      .whereNotNull('end_date')
      .select('id', 'name as title', 'end_date', 'priority')

    const now = new Date()
    return rows
      .filter((r: { end_date: string | null }) => r.end_date && new Date(r.end_date) < now)
      .map((r: { id: number; title: string; end_date: string; priority: string }) => ({
        id: r.id,
        title: r.title,
        daysOverdue: Math.ceil(
          (now.getTime() - new Date(r.end_date).getTime()) / (1000 * 60 * 60 * 24),
        ),
        isCritical: r.priority === 'critical',
      }))
  }

  private async collectOverdueReviews(organizationId: number, projectId: number) {
    const risks = await Risk.query()
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .whereNotNull('next_review_at')
      .whereIn('status', ['identified', 'analyzing', 'mitigating'])
      .select('id', 'title', 'next_review_at')

    const now = new Date()
    return risks
      .filter((r) => r.nextReviewAt && new Date(r.nextReviewAt.toJSDate()) < now)
      .map((r) => ({
        riskId: r.id,
        title: r.title,
        daysOverdue: Math.ceil(
          (now.getTime() - new Date(r.nextReviewAt!.toJSDate()).getTime()) / (1000 * 60 * 60 * 24),
        ),
      }))
  }

  private async collectIncompletePlans(organizationId: number, projectId: number) {
    const plans = await RiskResponsePlan.query()
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .whereNotNull('target_date')
      .whereNotIn('status', ['completed', 'cancelled'])
      .select('id', 'risk_id', 'target_date')

    const now = new Date()
    return plans
      .filter((p) => p.targetDate && new Date(p.targetDate.toJSDate()) < now)
      .map((p) => ({
        riskId: p.riskId,
        planId: p.id,
        daysPastDue: Math.ceil(
          (now.getTime() - new Date(p.targetDate!.toJSDate()).getTime()) / (1000 * 60 * 60 * 24),
        ),
      }))
  }
}
