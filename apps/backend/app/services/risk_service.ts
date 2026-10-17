import Risk from '#models/risk'
import RiskResponsePlan from '#models/risk_response_plan'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import RiskHistoryService from '#services/risk_history_service'
import RiskInvalidationService from '#services/risk_invalidation_service'
import RiskLevelService from '#services/risk_level_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { RISK_ALLOWED_TRANSITIONS } from '@aiproj/types'
import type { AiMarker, RiskCategory, RiskStatus } from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import type { AuthContext } from '#types/auth'

export interface CreateRiskInput {
  title: string
  description: string
  category?: RiskCategory
  probability?: number
  impact?: number
  ownerId?: number | null
  mitigationStrategy?: string | null
  contingencyPlan?: string | null
  triggerEvent?: string | null
  residualProbability?: number | null
  residualImpact?: number | null
  targetResolutionDate?: string | null
  relatedTaskId?: number | null
  riskCode?: string | null
  aiMetadata?: Record<string, unknown> | null
  // V2 扩展字段
  priority?: string
  triggerCondition?: string | null
  nextReviewAt?: string | null
  source?: string
}

export interface UpdateRiskInput extends Partial<Omit<CreateRiskInput, 'aiMetadata'>> {
  closedReason?: string | null
  closedNotes?: string | null
}

export interface RiskListFilters {
  category?: RiskCategory
  status?: RiskStatus
  ownerId?: number
  minScore?: number
  maxScore?: number
  search?: string
  sort?: string
  page?: number
  perPage?: number
  // V2 筛选
  riskLevel?: string
  priority?: string
  reviewStatus?: string
  closedReason?: string
  responseStatus?: string
}

function computeScore(probability: number, impact: number): number {
  return probability * impact
}

@inject()
export default class RiskService {
  constructor(
    private audit: AuditService,
    private riskLevel: RiskLevelService,
    private riskHistory: RiskHistoryService,
    private riskInvalidation: RiskInvalidationService,
  ) {}

  async list(
    organizationId: number,
    projectId: number,
    filters: RiskListFilters = {},
  ): Promise<{
    data: Risk[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const query = Risk.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters.category) query.where('category', filters.category)
    if (filters.status) query.where('status', filters.status)
    if (filters.ownerId) query.where('owner_id', filters.ownerId)
    if (filters.minScore) query.where('score', '>=', filters.minScore)
    if (filters.maxScore) query.where('score', '<=', filters.maxScore)
    if (filters.search) {
      query.where((q) => {
        q.whereILike('title', `%${filters.search}%`).orWhereILike(
          'description',
          `%${filters.search}%`,
        )
      })
    }
    // V2 筛选
    if (filters.riskLevel) query.where('risk_level', filters.riskLevel)
    if (filters.priority) query.where('priority', filters.priority)
    if (filters.closedReason) query.where('closed_reason', filters.closedReason)
    if (filters.reviewStatus === 'overdue') {
      query.where('next_review_at', '<', DateTime.now().toSQL()!).whereNotNull('next_review_at')
    } else if (filters.reviewStatus === 'upcoming') {
      query.where('next_review_at', '>=', DateTime.now().toSQL()!).whereNotNull('next_review_at')
    } else if (filters.reviewStatus === 'none') {
      query.whereNull('next_review_at')
    }
    if (filters.responseStatus === 'has_plans') {
      query.where((q) => {
        q.whereIn(
          'risks.id',
          RiskResponsePlan.query()
            .whereNull('deleted_at')
            .whereNotIn('status', ['completed', 'cancelled'])
            .select('risk_id'),
        )
      })
    } else if (filters.responseStatus === 'no_plans') {
      query.whereNotIn(
        'risks.id',
        RiskResponsePlan.query().whereNull('deleted_at').select('risk_id'),
      )
    }

    // 排序
    const sort = filters.sort ?? '-score'
    const desc = sort.startsWith('-')
    const sortField = sort.replace(/^-/, '')
    const allowedSorts = [
      'score',
      'probability',
      'impact',
      'status',
      'category',
      'created_at',
      'updated_at',
      'risk_level',
      'priority',
      'next_review_at',
      'last_review_at',
    ]
    if (allowedSorts.includes(sortField)) {
      query.orderBy(sortField, desc ? 'desc' : 'asc')
    } else {
      query.orderBy('score', 'desc')
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  async matrix(
    organizationId: number,
    projectId: number,
    basis: 'inherent' | 'residual' = 'inherent',
  ): Promise<{
    cells: Array<{ probability: number; impact: number; count: number; topRiskIds: number[] }>
  }> {
    const query = Risk.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (basis === 'residual') {
      query.whereNotNull('residual_probability').whereNotNull('residual_impact')
    }

    const risks = await query.select(
      'id',
      'probability',
      'impact',
      'residual_probability',
      'residual_impact',
    )

    const cellMap = new Map<
      string,
      { probability: number; impact: number; count: number; topRiskIds: number[] }
    >()

    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        cellMap.set(`${p}-${i}`, { probability: p, impact: i, count: 0, topRiskIds: [] })
      }
    }

    for (const risk of risks) {
      const prob = basis === 'residual' ? risk.residualProbability! : risk.probability
      const imp = basis === 'residual' ? risk.residualImpact! : risk.impact
      const key = `${prob}-${imp}`
      const cell = cellMap.get(key)
      if (cell) {
        cell.count++
        if (cell.topRiskIds.length < 5) cell.topRiskIds.push(risk.id)
      }
    }

    return { cells: Array.from(cellMap.values()) }
  }

  async create(
    organizationId: number,
    projectId: number,
    input: CreateRiskInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Risk> {
    await this.projectOrFail(organizationId, projectId)

    const probability = input.probability ?? 3
    const impact = input.impact ?? 3

    // 计算风险等级（服务端计算，禁止前端覆盖）
    const riskLevel = await this.riskLevel.computeInherent(organizationId, projectId, {
      probability,
      impact,
      residualProbability: input.residualProbability ?? null,
      residualImpact: input.residualImpact ?? null,
    })

    const risk = await Risk.create({
      organizationId,
      projectId,
      riskCode: input.riskCode ?? null,
      title: input.title,
      description: input.description,
      category: input.category ?? 'other',
      probability,
      impact,
      score: computeScore(probability, impact),
      status: 'identified',
      riskLevel,
      priority: input.priority ?? 'normal',
      triggerCondition: input.triggerCondition ?? null,
      nextReviewAt: input.nextReviewAt ? DateTime.fromISO(input.nextReviewAt) : null,
      mitigationStrategy: input.mitigationStrategy ?? null,
      contingencyPlan: input.contingencyPlan ?? null,
      ownerId: input.ownerId ?? null,
      triggerEvent: input.triggerEvent ?? null,
      residualProbability: input.residualProbability ?? null,
      residualImpact: input.residualImpact ?? null,
      residualScore:
        input.residualProbability && input.residualImpact
          ? computeScore(input.residualProbability, input.residualImpact)
          : null,
      identifiedAt: DateTime.now(),
      targetResolutionDate: input.targetResolutionDate
        ? DateTime.fromISO(input.targetResolutionDate)
        : null,
      relatedTaskId: input.relatedTaskId ?? null,
      aiMetadata: input.aiMetadata ? JSON.stringify(input.aiMetadata) : null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await this.audit.log({
      event: AuditEvent.RISK_CREATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: {
        title: risk.title,
        category: risk.category,
        score: risk.score,
        status: risk.status,
      },
      requestId: ctx.requestId ?? null,
    })

    // V2 风险历史记录
    await this.riskHistory.record({
      organizationId,
      projectId,
      riskId: risk.id,
      eventType: 'created',
      actorId: actorUserId,
      summary: { title: risk.title, category: risk.category, score: risk.score, riskLevel },
      sourceType: input.source ?? 'manual',
    })

    // 风险写入后缓存失效广播（旁路，不影响业务写入）
    this.riskInvalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'risk_created',
      entityType: 'risk',
      entityId: risk.id,
    })

    return risk
  }

  async update(
    organizationId: number,
    projectId: number,
    riskId: number,
    input: UpdateRiskInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Risk> {
    const risk = await this.riskOrFail(organizationId, projectId, riskId)

    const probability = input.probability ?? risk.probability
    const impact = input.impact ?? risk.impact

    risk.merge({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
      ...(input.mitigationStrategy !== undefined && {
        mitigationStrategy: input.mitigationStrategy,
      }),
      ...(input.contingencyPlan !== undefined && { contingencyPlan: input.contingencyPlan }),
      ...(input.triggerEvent !== undefined && { triggerEvent: input.triggerEvent }),
      ...(input.riskCode !== undefined && { riskCode: input.riskCode }),
      ...(input.relatedTaskId !== undefined && { relatedTaskId: input.relatedTaskId }),
      ...(input.targetResolutionDate !== undefined && {
        targetResolutionDate: input.targetResolutionDate
          ? DateTime.fromISO(input.targetResolutionDate)
          : null,
      }),
      // V2 扩展字段
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.triggerCondition !== undefined && { triggerCondition: input.triggerCondition }),
      ...(input.nextReviewAt !== undefined && {
        nextReviewAt: input.nextReviewAt ? DateTime.fromISO(input.nextReviewAt) : null,
      }),
      ...(input.closedReason !== undefined && { closedReason: input.closedReason }),
      ...(input.closedNotes !== undefined && { closedNotes: input.closedNotes }),
      probability,
      impact,
      score: computeScore(probability, impact),
      updatedBy: actorUserId,
    })

    // 重新计算风险等级
    const newRiskLevel = await this.riskLevel.computeInherent(organizationId, projectId, {
      probability: risk.probability,
      impact: risk.impact,
      residualProbability: risk.residualProbability ?? null,
      residualImpact: risk.residualImpact ?? null,
    })
    risk.riskLevel = newRiskLevel

    // 残余评估：要么全空要么齐全
    if (input.residualProbability !== undefined || input.residualImpact !== undefined) {
      const rp =
        input.residualProbability !== undefined
          ? input.residualProbability
          : risk.residualProbability
      const ri = input.residualImpact !== undefined ? input.residualImpact : risk.residualImpact
      if (rp !== null && ri !== null) {
        risk.merge({
          residualProbability: rp,
          residualImpact: ri,
          residualScore: computeScore(rp, ri),
        })
      } else if (rp === null && ri === null) {
        risk.merge({
          residualProbability: null,
          residualImpact: null,
          residualScore: null,
        })
      } else {
        throw new ValidationException('残余概率与残余影响必须同时提供或同时为空')
      }
    }

    await risk.save()

    await this.audit.log({
      event: AuditEvent.RISK_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: { title: risk.title },
      requestId: ctx.requestId ?? null,
    })

    // V2 风险历史记录
    await this.riskHistory.record({
      organizationId,
      projectId,
      riskId: risk.id,
      eventType: 'field_changed',
      actorId: actorUserId,
      summary: { title: risk.title, riskLevel: risk.riskLevel },
    })

    // 风险写入后缓存失效广播（旁路，不影响业务写入）
    this.riskInvalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'risk_updated',
      entityType: 'risk',
      entityId: risk.id,
    })

    return risk
  }

  async softDelete(
    organizationId: number,
    projectId: number,
    riskId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<void> {
    const risk = await this.riskOrFail(organizationId, projectId, riskId)
    risk.deletedAt = DateTime.now()
    risk.updatedBy = actorUserId
    await risk.save()

    await this.audit.log({
      event: AuditEvent.RISK_DELETED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: { title: risk.title },
      requestId: ctx.requestId ?? null,
    })

    // 风险写入后缓存失效广播（旁路，不影响业务写入）
    this.riskInvalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'risk_deleted',
      entityType: 'risk',
      entityId: risk.id,
    })
  }

  async transitionStatus(
    organizationId: number,
    projectId: number,
    riskId: number,
    toStatus: RiskStatus,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Risk> {
    const risk = await this.riskOrFail(organizationId, projectId, riskId)
    const fromStatus = risk.status as RiskStatus

    const allowed = RISK_ALLOWED_TRANSITIONS[fromStatus]
    if (!allowed || !allowed.includes(toStatus)) {
      throw new ValidationException(`不允许从 "${fromStatus}" 转换到 "${toStatus}"`)
    }

    risk.status = toStatus
    risk.updatedBy = actorUserId
    if (toStatus === 'resolved' || toStatus === 'closed') {
      risk.resolvedAt = DateTime.now()
    }
    await risk.save()

    await this.audit.log({
      event: AuditEvent.RISK_STATUS_CHANGED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: { from: fromStatus, to: toStatus, title: risk.title },
      requestId: ctx.requestId ?? null,
    })

    // V2 风险历史
    await this.riskHistory.record({
      organizationId,
      projectId,
      riskId: risk.id,
      eventType: 'status_changed',
      actorId: actorUserId,
      summary: { from: fromStatus, to: toStatus },
    })

    // 风险写入后缓存失效广播（旁路，不影响业务写入）
    this.riskInvalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'risk_status_changed',
      entityType: 'risk',
      entityId: risk.id,
    })

    return risk
  }

  /**
   * ai-draft-generation 确认阶段批量创建风险（design D2）。
   * 在给定事务内批量创建，source = "ai_draft"；服务端二次过滤未选项。
   */
  async batchCreateFromDraft(params: {
    trx: TransactionClientContract
    organizationId: number
    projectId: number
    draftId: string
    draftVersion: number
    selectedRiskHints: Array<{
      id: string
      title: string
      description: string
      category: RiskCategory
      probability: number
      impact: number
      mitigation: string
      aiMarker: AiMarker
    }>
    actorUserId: number
  }): Promise<Risk[]> {
    const risks: Risk[] = []

    for (const hint of params.selectedRiskHints) {
      const probability = hint.probability
      const impact = hint.impact

      const risk = await Risk.create(
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          title: hint.title,
          description: hint.description,
          category: hint.category,
          probability,
          impact,
          score: computeScore(probability, impact),
          status: 'identified',
          mitigationStrategy: hint.mitigation,
          identifiedAt: DateTime.now(),
          aiMetadata: JSON.stringify({
            aiMarker: hint.aiMarker,
            sourceDraftId: params.draftId,
            sourceDraftVersion: params.draftVersion,
          }),
          createdBy: params.actorUserId,
          updatedBy: params.actorUserId,
        },
        { client: params.trx },
      )

      risks.push(risk)
    }

    if (risks.length > 0) {
      await this.audit.log({
        event: AuditEvent.RISK_CREATED,
        userId: params.actorUserId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'risk',
        metadata: {
          source: 'ai_draft',
          draftId: params.draftId,
          count: risks.length,
        },
        client: params.trx,
      })
    }

    return risks
  }

  private async projectOrFail(organizationId: number, projectId: number) {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async riskOrFail(organizationId: number, projectId: number, riskId: number) {
    const risk = await Risk.query()
      .where('id', riskId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!risk) throw new ResourceNotFoundException('风险不存在')
    return risk
  }
}
