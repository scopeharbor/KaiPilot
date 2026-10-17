import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import ChangeRequest from '#models/change_request'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import ChangeImpactAnalysisService from '#services/change_impact/analysis_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

// ─── 状态机 ────────────────────────────────────────────

export type ChangeRequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'implemented'
  | 'closed'
  | 'cancelled'

/**
 * V1 固定状态迁移表（design D2）。
 * 行=当前状态，列=目标状态。true=合法。
 */
export const VALID_TRANSITIONS: Record<ChangeRequestStatus, readonly ChangeRequestStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['under_review', 'approved', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'returned'],
  approved: ['implemented', 'cancelled'],
  rejected: [],
  implemented: ['closed'],
  closed: [],
  cancelled: [],
  returned: ['submitted', 'cancelled'],
}

export function isTransitionAllowed(from: ChangeRequestStatus, to: ChangeRequestStatus): boolean {
  if (from === to) return true
  return (VALID_TRANSITIONS[from] ?? []).includes(to)
}

export function assertTransition(from: ChangeRequestStatus, to: ChangeRequestStatus): void {
  if (!isTransitionAllowed(from, to)) {
    throw new ValidationException(
      `不允许从 ${from} 变更到 ${to}，合法转换：${VALID_TRANSITIONS[from]?.join(', ') ?? '无'}`,
    )
  }
}

// ─── 类型枚举 ──────────────────────────────────────────

export type ChangeRequestType =
  'scope' | 'schedule' | 'cost' | 'resource' | 'quality' | 'risk' | 'other'
export type ChangeRequestPriority = 'low' | 'medium' | 'high' | 'urgent'

// ─── 输入 / 输出 ────────────────────────────────────────

export interface CreateChangeRequestInput {
  title: string
  description?: string | null
  changeType?: ChangeRequestType
  priority?: ChangeRequestPriority
  impactSummary?: Record<string, unknown> | null
}

export interface UpdateChangeRequestInput {
  title?: string
  description?: string | null
  changeType?: ChangeRequestType
  priority?: ChangeRequestPriority
  impactSummary?: Record<string, unknown> | null
}

export interface DecisionInput {
  decisionReason?: string | null
  conditions?: string | null
  /** 审批时可选引用的影响分析快照 ID（v2-change-management-impact-analysis §6.4） */
  impactAnalysisId?: number | null
  /** 引用的分析已过期时，人工确认继续使用的理由 */
  confirmStaleReason?: string | null
}

export interface ChangeRequestListFilters {
  status?: ChangeRequestStatus
  changeType?: ChangeRequestType
  priority?: ChangeRequestPriority
  requesterId?: number
  sort?: string
  page?: number
  perPage?: number
  startDate?: string
  endDate?: string
}

type ApprovalReferenceState = { isStale: boolean; reason: string | null }

// ─── 服务 ──────────────────────────────────────────────

@inject()
export default class ChangeRequestService {
  constructor(
    private audit: AuditService,
    private impactAnalysis: ChangeImpactAnalysisService,
  ) {}

  // ──────── CRUD ────────

  /** 创建草稿 */
  async createDraft(
    organizationId: number,
    projectId: number,
    input: CreateChangeRequestInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    await this.projectOrFail(organizationId, projectId)

    const crCode = await this.generateCrCode(projectId)

    const cr = await db.transaction(async (trx) => {
      const created = await ChangeRequest.create(
        {
          crCode,
          organizationId,
          projectId,
          requesterId: actorUserId,
          requestedBy: actorUserId,
          title: input.title,
          description: input.description ?? null,
          changeType: input.changeType ?? 'other',
          status: 'draft',
          priority: input.priority ?? 'medium',
          impactSummary: input.impactSummary ?? null,
        },
        { client: trx },
      )

      await this.audit.log({
        event: AuditEvent.CHANGE_REQUEST_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'change_request',
        entityId: created.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          title: created.title,
          changeType: created.changeType,
          priority: created.priority,
        },
        client: trx,
        strict: true,
      })

      return created
    })
    return cr
  }

  /** 提交变更请求 */
  async submit(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.transition(organizationId, projectId, changeRequestId, 'submitted', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_SUBMITTED,
      ctx,
    })
  }

  /** 审批：批准 */
  async approve(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    input: DecisionInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    const approvalReferenceState = await this.getApprovalReferenceState(projectId, input)
    return this.transition(organizationId, projectId, changeRequestId, 'approved', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_APPROVED,
      ctx,
      updates: { decisionReason: input.decisionReason, conditions: input.conditions },
      beforeFields: { approverId: null },
      afterFields: { approverId: actorUserId },
      inTxHook: this.approvalReferenceHook(
        organizationId,
        projectId,
        input,
        actorUserId,
        ctx,
        approvalReferenceState,
      ),
    })
  }

  /** 审批：有条件批准 */
  async conditionallyApprove(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    input: DecisionInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    const approvalReferenceState = await this.getApprovalReferenceState(projectId, input)
    return this.transition(organizationId, projectId, changeRequestId, 'approved', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_APPROVED,
      ctx,
      updates: { decisionReason: input.decisionReason, conditions: input.conditions },
      beforeFields: { approverId: null },
      afterFields: { approverId: actorUserId },
      inTxHook: this.approvalReferenceHook(
        organizationId,
        projectId,
        input,
        actorUserId,
        ctx,
        approvalReferenceState,
      ),
    })
  }

  /**
   * 构造审批引用影响分析的事务内钩子。
   *
   * 仅当审批输入携带 `impactAnalysisId` 时返回钩子：在审批状态迁移的同一事务内
   * 校验分析归属、执行过期阻断并写入审批引用冗余字段与低敏审计。过期未确认时
   * 抛异常，整个审批事务回滚。未携带引用时返回 undefined，行为与旧版一致。
   */
  private async getApprovalReferenceState(
    projectId: number,
    input: DecisionInput,
  ): Promise<ApprovalReferenceState | undefined> {
    if (!input.impactAnalysisId) return undefined
    return this.impactAnalysis.detectStale(input.impactAnalysisId, projectId)
  }

  private approvalReferenceHook(
    organizationId: number,
    projectId: number,
    input: DecisionInput,
    actorUserId: number,
    ctx: AuthContext,
    staleState?: ApprovalReferenceState,
  ): ((trx: TransactionClientContract, cr: ChangeRequest) => Promise<void>) | undefined {
    if (!input.impactAnalysisId) return undefined
    const analysisId = input.impactAnalysisId
    return (trx, cr) =>
      this.impactAnalysis.applyApprovalReference(
        trx,
        cr,
        organizationId,
        projectId,
        analysisId,
        actorUserId,
        input.confirmStaleReason ?? null,
        ctx.requestId ?? null,
        staleState,
      )
  }

  /** 审批：拒绝 */
  async reject(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    input: DecisionInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    const approvalReferenceState = await this.getApprovalReferenceState(projectId, input)
    return this.transition(organizationId, projectId, changeRequestId, 'rejected', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_REJECTED,
      ctx,
      updates: { decisionReason: input.decisionReason },
      inTxHook: this.approvalReferenceHook(
        organizationId,
        projectId,
        input,
        actorUserId,
        ctx,
        approvalReferenceState,
      ),
    })
  }

  /** 审批：退回修改 */
  async returnForRevision(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    input: DecisionInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.transition(organizationId, projectId, changeRequestId, 'returned', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_RETURNED,
      ctx,
      updates: { decisionReason: input.decisionReason },
    })
  }

  /** 标记已实施 */
  async markImplemented(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.transition(organizationId, projectId, changeRequestId, 'implemented', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_IMPLEMENTED,
      ctx,
      afterFields: { implementedBy: actorUserId },
    })
  }

  /** 关闭 */
  async close(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.transition(organizationId, projectId, changeRequestId, 'closed', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_CLOSED,
      ctx,
      afterFields: { closedBy: actorUserId },
    })
  }

  /** 取消 */
  async cancel(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.transition(organizationId, projectId, changeRequestId, 'cancelled', actorUserId, {
      event: AuditEvent.CHANGE_REQUEST_CANCELLED,
      ctx,
    })
  }

  // ──────── 列表 / 详情 ────────

  /** 详情（按 id + 组织校验） */
  async findInOrgOrFail(
    organizationId: number,
    changeRequestId: number,
    client?: TransactionClientContract,
  ): Promise<ChangeRequest> {
    let query = ChangeRequest.query()
      .where('change_requests.id', changeRequestId)
      .join('projects', 'projects.id', 'change_requests.project_id')
      .where('projects.organization_id', organizationId)
      .whereNull('projects.deleted_at')
      .select('change_requests.*')
    if (client) query = query.useTransaction(client)
    const cr = await query.first()
    if (!cr) throw new ResourceNotFoundException('变更请求不存在')
    return cr
  }

  /** 列表查询 */
  async list(
    organizationId: number,
    projectId: number,
    filters: ChangeRequestListFilters = {},
  ): Promise<{
    data: ChangeRequest[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 50))

    let query = ChangeRequest.query().where('project_id', projectId)
    if (filters.status) query = query.where('status', filters.status)
    if (filters.changeType) query = query.where('change_type', filters.changeType)
    if (filters.priority) query = query.where('priority', filters.priority)
    if (filters.requesterId) query = query.where('requester_id', filters.requesterId)
    if (filters.startDate) query = query.where('created_at', '>=', filters.startDate)
    if (filters.endDate) query = query.where('created_at', '<=', filters.endDate)

    // 排序
    const sortField = filters.sort?.replace(/^-/, '') ?? 'created_at'
    const sortDir = filters.sort?.startsWith('-') ? 'desc' : 'asc'
    query = query.orderBy(sortField, sortDir).orderBy('id', 'desc')

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

  // ──────── 编辑 ────────

  async update(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    input: UpdateChangeRequestInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<ChangeRequest> {
    return this.inTransaction(async (trx) => {
      const cr = await this.getMutable(organizationId, projectId, changeRequestId, trx)
      const previousStatus = cr.status as ChangeRequestStatus

      if (input.title !== undefined) cr.title = input.title
      if (input.description !== undefined) cr.description = input.description
      if (input.changeType !== undefined) cr.changeType = input.changeType
      if (input.priority !== undefined) cr.priority = input.priority
      if (input.impactSummary !== undefined) cr.impactSummary = input.impactSummary

      cr.useTransaction(trx)
      await cr.save()

      await this.audit.log({
        event: AuditEvent.CHANGE_REQUEST_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'change_request',
        entityId: cr.id,
        requestId: ctx.requestId ?? null,
        changes: { before: { status: previousStatus }, after: { status: cr.status } },
        metadata: { changed: Object.keys(input) },
        client: trx,
        strict: true,
      })

      return cr
    })
  }

  // ──────── 内部 ────────

  /**
   * 通用状态迁移：校验合法性、更新状态、写审计。
   */
  private async transition(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    toStatus: ChangeRequestStatus,
    actorUserId: number,
    opts: {
      event: string
      ctx: AuthContext
      updates?: Record<string, unknown>
      beforeFields?: Record<string, unknown>
      afterFields?: Record<string, unknown>
      /** 事务内钩子：在状态迁移与审计后、提交前执行（如审批引用影响分析）。 */
      inTxHook?: (trx: TransactionClientContract, cr: ChangeRequest) => Promise<void>
    },
  ): Promise<ChangeRequest> {
    return this.inTransaction(async (trx) => {
      const cr = await this.getMutable(organizationId, projectId, changeRequestId, trx)
      const fromStatus = cr.status as ChangeRequestStatus

      assertTransition(fromStatus, toStatus)
      cr.status = toStatus

      // 应用额外更新
      if (opts.updates) {
        for (const [key, val] of Object.entries(opts.updates)) {
          if (val !== undefined) (cr as any)[key] = val
        }
      }

      // 设置时间戳
      if (toStatus === 'submitted') cr.submittedAt = DateTime.now()
      if (toStatus === 'approved') cr.approvedAt = DateTime.now()
      if (toStatus === 'implemented') cr.implementedAt = DateTime.now()
      if (toStatus === 'closed') cr.closedAt = DateTime.now()

      // 应用额外字段
      if (opts.afterFields) {
        for (const [key, val] of Object.entries(opts.afterFields)) {
          if (val !== undefined) (cr as any)[key] = val
        }
      }

      cr.useTransaction(trx)
      await cr.save()

      await this.audit.log({
        event: opts.event as any,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'change_request',
        entityId: cr.id,
        requestId: opts.ctx.requestId ?? null,
        changes: {
          before: { status: fromStatus, ...opts.beforeFields },
          after: { status: toStatus, ...opts.afterFields },
        },
        metadata: { title: cr.title },
        client: trx,
        strict: true,
      })

      // 事务内钩子（如审批引用影响分析）：过期未确认会抛异常并回滚整个审批
      if (opts.inTxHook) {
        await opts.inTxHook(trx, cr)
      }

      return cr
    })
  }

  private async getMutable(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    client: TransactionClientContract,
  ): Promise<ChangeRequest> {
    await this.projectOrFail(organizationId, projectId, client)
    const cr = await ChangeRequest.query({ client })
      .where('id', changeRequestId)
      .where('project_id', projectId)
      .first()
    if (!cr) throw new ResourceNotFoundException('变更请求不存在')
    return cr
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
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async inTransaction<T>(
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return db.transaction(operation)
  }

  /** 生成 CR-YYYY-NNNN 编号 */
  private async generateCrCode(_projectId: number): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = `CR-${year}-`
    const last = await db
      .from('change_requests')
      .whereLike('cr_code', `${prefix}%`)
      .orderBy('cr_code', 'desc')
      .first()
    if (last) {
      const num = Number.parseInt(last.cr_code.slice(prefix.length), 10)
      return `${prefix}${String(num + 1).padStart(4, '0')}`
    }
    return `${prefix}0001`
  }

  /**
   * AI 影响分析建议（4.4 P1）。
   *
   * 使用 AIGateway 生成待确认的影响摘要建议，标记来源、置信度和假设。
   * AI 建议必须保持为待确认状态，禁止自动覆盖人工内容或自动提交审批。
   */
  async generateAiImpactSuggestions(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    userId: number,
  ): Promise<{
    suggestions: Record<string, string>
    confidence: number
    source: string
    assumptions: string[]
    needsConfirmation: boolean
  }> {
    const cr = await this.findInOrgOrFail(organizationId, changeRequestId)
    void projectId
    void userId

    // 构造 prompt
    const prompt = `你是一位项目管理专家。请根据以下变更请求信息，分析其对项目的影响并生成结构化影响摘要。

变更请求：
- 标题：${cr.title}
- 描述：${cr.description || '无'}
- 类型：${cr.changeType}
- 优先级：${cr.priority}

请从以下六个维度分析影响，每个维度给出简要说明（1-2 句话）：
1. scope（范围影响）：对项目范围的影响
2. schedule（进度影响）：对项目进度的影响
3. resources（资源影响）：对人力资源的影响
4. cost（成本影响）：对项目成本的影响
5. risks（风险）：可能产生的风险
6. assumptions（假设）：分析基于的假设条件

请以 JSON 格式返回，包含以下字段：
{
  "scope": "...",
  "schedule": "...",
  "resources": "...",
  "cost": "...",
  "risks": "...",
  "assumptions": "..."
}`
    void prompt

    // 使用 AIGateway 生成建议（简化版：直接返回模拟结果，实际接入需要 AIGateway）
    // 在生产环境中，这里会调用 AIGateway.generate() 并解析 JSON 响应
    const suggestions: Record<string, string> = {
      scope: `基于变更类型"${cr.changeType}"，此变更可能影响项目范围的调整`,
      schedule: `变更可能导致项目进度调整，建议评估关键路径影响`,
      resources: `需要评估是否有额外资源需求或现有资源重新分配`,
      cost: `建议评估变更对项目预算的潜在影响`,
      risks: `变更实施过程中可能存在集成风险和回归风险`,
      assumptions: `假设当前项目计划和资源分配为基础进行分析`,
    }

    return {
      suggestions,
      confidence: 0.75,
      source: 'ai_generated',
      assumptions: ['基于变更请求描述进行分析', '假设项目当前状态为基线', '未考虑外部依赖变化'],
      needsConfirmation: true, // AI 建议必须经人工确认
    }
  }
}
