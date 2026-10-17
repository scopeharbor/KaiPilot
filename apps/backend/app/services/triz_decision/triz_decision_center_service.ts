/**
 * v3-triz-decision-center —— TRIZ 决策中心 Service（tasks 3.1–3.7）。
 *
 * 核心业务逻辑：
 * - 从既有来源 adapter 派生 summary、queue item、detail context 和 Draft readiness
 * - 组织 + 项目双隔离 + 来源二次鉴权
 * - 低敏摘要（不存完整 prompt/模型输出/artifact payload/token/secret）
 * - 只读操作无副作用（不创建/刷新/运行任何东西）
 */
import { inject } from '@adonisjs/core'
import TrizDecisionLog from '#models/triz_decision_log'
import ProjectContradiction from '#models/project_contradiction'
import TrizDecisionLogService from '#services/triz_decision/triz_decision_log_service'
import {
  TrizDecisionAiDraftService,
  type AiDraftInput,
} from '#services/triz_decision/triz_decision_ai_draft_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import logger from '@adonisjs/core/services/logger'
import {
  computeDecisionCenterItemId,
  computeDecisionCenterSummary,
  sortDecisionCenterItems,
  filterDecisionCenterItems,
  redactSensitiveItemData,
  type TrizDecisionCenterItem,
  type TrizDecisionCenterSummary,
  type TrizDecisionCenterDetail,
  type TrizDecisionCenterSourceDigest,
  type TrizDecisionCenterQueueStatus,
  type TrizDecisionCenterSourceKind,
  type TrizDecisionCenterWarning,
  type TrizDecisionCenterTimelineEvent,
  type TrizDecisionCenterDraftBlockerInfo,
  requiresExplicitConfirmation,
  validateConfirmation,
  canEnterDraftReview,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Source adapter 接口（tasks 3.1）
// ---------------------------------------------------------------------------

/**
 * 决策中心 source adapter 接口。
 * 每个 adapter 返回低敏摘要，绝不返回完整 payload。
 */
export interface TrizDecisionCenterSourceAdapter {
  /** adapter 名称（用于审计） */
  readonly name: string
  /** 来源种类 */
  readonly sourceKind: TrizDecisionCenterSourceKind
  /**
   * 获取该来源的所有 items（组织 + 项目 + 用户限定）。
   * 返回低敏摘要列表，不包含完整 payload。
   * 失败时返回空数组（不影响其他来源）。
   */
  getItems(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<TrizDecisionCenterItem[]>
}

// ---------------------------------------------------------------------------
// 适配器实现（tasks 3.2–3.3）
// ---------------------------------------------------------------------------

/**
 * 决策日志 source adapter（tasks 3.2）。
 * 从 TrizDecisionLog 模型提取队列项。
 */
class DecisionLogSourceAdapter implements TrizDecisionCenterSourceAdapter {
  readonly name = 'DecisionLogSourceAdapter'
  readonly sourceKind: TrizDecisionCenterSourceKind = 'decision_log'

  async getItems(
    organizationId: number,
    projectId: number,
    _userId: number,
  ): Promise<TrizDecisionCenterItem[]> {
    const logs = await TrizDecisionLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')
      .limit(50)

    return logs.map((log) => this.toItem(log, organizationId, projectId))
  }

  private toItem(
    log: TrizDecisionLog,
    organizationId: number,
    projectId: number,
  ): TrizDecisionCenterItem {
    const sourceHash = log.reasonHash || `dl-${log.id}`
    const id = computeDecisionCenterItemId(this.sourceKind, String(log.id), sourceHash)
    const queueStatus: TrizDecisionCenterQueueStatus =
      log.decisionStatus === 'active' ? 'recently_decided' : 'pending_decision'

    // 决策日志本身是已落库证据；active 决策可进入 Draft 审查（advisory），
    // pending 决策需先记录。allowedActions 受 canEnterDraftReview 二次校验约束。
    const allowedActions: TrizDecisionCenterItem['allowedActions'] =
      log.decisionStatus === 'active'
        ? ['view_detail', 'supersede', 'start_draft_review']
        : ['view_detail', 'supplement', 'generate_reason_draft']

    return {
      id,
      projectId,
      organizationId,
      queueStatus,
      source: {
        sourceKind: this.sourceKind,
        sourceId: String(log.id),
        sourceHash,
        title: `决策 #${log.id}: ${log.decisionType}`,
        summary: log.reasonSummary?.slice(0, 200) ?? null,
        navigationRef: `/projects/${projectId}/triz-decision-logs/${log.id}`,
        accessible: true,
      },
      subjectSummary: log.reasonSummary?.slice(0, 150) ?? '',
      priority: queueStatus === 'recently_decided' ? 1 : 7,
      warnings: [],
      relatedDecisionLogIds: [log.id],
      readiness: log.decisionStatus === 'active' ? 'ready' : 'not_ready',
      allowedActions,
      createdAt: log.createdAt.toISO()!,
      updatedAt: log.updatedAt?.toISO() ?? log.createdAt.toISO()!,
      hasAccess: true,
    }
  }
}

/**
 * 矛盾 source adapter（tasks 3.3）。
 * 从既有的 ProjectContradiction 模型提取。
 */
class ContradictionSourceAdapter implements TrizDecisionCenterSourceAdapter {
  readonly name = 'ContradictionSourceAdapter'
  readonly sourceKind: TrizDecisionCenterSourceKind = 'contradiction'

  async getItems(
    organizationId: number,
    projectId: number,
    _userId: number,
  ): Promise<TrizDecisionCenterItem[]> {
    try {
      const contradictions = await ProjectContradiction.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .orderBy('updated_at', 'desc')
        .limit(30)

      return contradictions.map((c) => this.toItem(c, projectId, organizationId))
    } catch {
      // 模型/表不存在时返回空，不影响其他来源
      return []
    }
  }

  private toItem(
    c: ProjectContradiction,
    projectId: number,
    organizationId: number,
  ): TrizDecisionCenterItem {
    const sourceHash = (c as any).outputHash || (c as any).inputSignature || `contra-${c.id}`
    const id = computeDecisionCenterItemId(this.sourceKind, String(c.id), sourceHash)
    const status = (c as any).status || 'candidate'
    const queueStatus: TrizDecisionCenterQueueStatus =
      status === 'confirmed' || status === 'dismissed' ? 'recently_decided' : 'pending_decision'

    const warnings: TrizDecisionCenterWarning[] = []
    if ((c as any).stale) {
      warnings.push({
        code: 'TRIZ_DC_STALE_SOURCE_HASH',
        message: '矛盾数据可能已过期',
      })
    }

    const title = (c as any).title || `矛盾 #${c.id}`

    return {
      id,
      projectId,
      organizationId,
      queueStatus,
      source: {
        sourceKind: this.sourceKind,
        sourceId: String(c.id),
        sourceHash,
        title,
        summary: (c as any).contradictionSummary || null,
        navigationRef: `/projects/${projectId}/contradictions/${c.id}`,
        accessible: true,
      },
      subjectSummary: title,
      priority: status === 'candidate' ? 7 : 1,
      warnings,
      relatedDecisionLogIds: [],
      readiness: status === 'confirmed' ? 'ready' : 'not_ready',
      allowedActions:
        status === 'candidate'
          ? ['adopt', 'reject', 'view_detail', 'generate_reason_draft']
          : ['view_detail', 'supersede', 'start_draft_review'],
      createdAt: c.createdAt.toISO()!,
      updatedAt: c.updatedAt?.toISO() ?? c.createdAt.toISO()!,
      hasAccess: true,
    }
  }
}

/**
 * Draft blocker source adapter（tasks 3.3）。
 * 从 Draft Layer 阻断模型提取。当前通过决策日志适配器间接暴露，
 * 真实 Draft blocker 模型存在时可在此查询。
 */
class DraftBlockerSourceAdapter implements TrizDecisionCenterSourceAdapter {
  readonly name = 'DraftBlockerSourceAdapter'
  readonly sourceKind: TrizDecisionCenterSourceKind = 'draft_blocker'

  async getItems(
    _organizationId: number,
    _projectId: number,
    _userId: number,
  ): Promise<TrizDecisionCenterItem[]> {
    // 安全默认：返回空，等待后续 wire 真实 Draft blocker 模型
    return []
  }
}

/**
 * 通用 fixture source adapter（tasks 3.3）。
 * 为尚未完全 wire 的来源提供安全的空数据。
 */
class FixtureSourceAdapter implements TrizDecisionCenterSourceAdapter {
  readonly name: string
  readonly sourceKind: TrizDecisionCenterSourceKind

  constructor(sourceKind: TrizDecisionCenterSourceKind) {
    this.sourceKind = sourceKind
    this.name = `FixtureSourceAdapter[${sourceKind}]`
  }

  async getItems(
    _organizationId: number,
    _projectId: number,
    _userId: number,
  ): Promise<TrizDecisionCenterItem[]> {
    // 安全默认：返回空，等待后续 wire 真实适配器
    return []
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface ListOptions {
  status?: string
  sourceKind?: string
  warning?: string
  priority?: number
  search?: string
  page?: number
  perPage?: number
  sort?: string
}

@inject()
export default class TrizDecisionCenterService {
  private adapters: TrizDecisionCenterSourceAdapter[] = []
  private aiDraftService: TrizDecisionAiDraftService

  constructor(
    private decisionLogService?: TrizDecisionLogService,
    private audit?: AuditService,
  ) {
    this.aiDraftService = new TrizDecisionAiDraftService()
    // 初始化所有 source adapter
    this.adapters = [
      new ContradictionSourceAdapter(),
      new DecisionLogSourceAdapter(),
      new DraftBlockerSourceAdapter(),
      // 尚未完全 wire 的来源使用 fixture adapter
      new FixtureSourceAdapter('compiler_triz_analysis'),
      new FixtureSourceAdapter('recommendation_rationale'),
      new FixtureSourceAdapter('innovation_workbench'),
    ]
  }

  // ── Summary ──────────────────────────────────────────────────────────

  /**
   * 返回决策中心摘要：各队列计数、来源计数、warning 聚合、近期关键决策。
   */
  async summary(
    organizationId: number,
    projectId: number,
  ): Promise<{ data: TrizDecisionCenterSummary }> {
    const allItems = await this.collectAllItems(organizationId, projectId, 0)

    const stats = computeDecisionCenterSummary(allItems)

    // 取最近关键决策（priority >= 7，最多 5 条）
    const recentKeyDecisions = allItems
      .filter((i) => i.priority >= 7)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((i) => redactSensitiveItemData(i))

    const readyForDraftCount = allItems.filter(
      (i) =>
        i.readiness === 'ready' && !i.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH'),
    ).length

    const blockedCount = allItems.filter((i) => i.readiness === 'blocked').length

    return {
      data: {
        ...stats,
        recentKeyDecisions,
        readyForDraftCount,
        blockedCount,
      },
    }
  }

  // ── List ─────────────────────────────────────────────────────────────

  /**
   * 返回可过滤、分页、排序的决策中心队列列表。
   */
  async list(
    organizationId: number,
    projectId: number,
    options: ListOptions = {},
  ): Promise<{ data: TrizDecisionCenterItem[]; meta: any }> {
    const allItems = await this.collectAllItems(organizationId, projectId, 0)

    // 过滤
    let items = filterDecisionCenterItems(allItems, {
      status: options.status as TrizDecisionCenterQueueStatus | undefined,
      sourceKind: options.sourceKind as TrizDecisionCenterSourceKind | undefined,
      warning: options.warning as any | undefined,
      priority: options.priority,
      search: options.search,
    })

    // 排序
    if (options.sort) {
      const parts = options.sort.split(':')
      const field = parts[0] as any
      const dir = parts[1] === 'desc' ? 'desc' : 'asc'
      items = sortDecisionCenterItems(items, field, dir)
    } else {
      items = sortDecisionCenterItems(items, 'priority', 'desc')
    }

    // 分页
    const page = options.page ?? 1
    const perPage = Math.min(options.perPage ?? 20, 100)
    const total = items.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    const paged = items.slice(start, start + perPage)

    return {
      data: paged.map((i) => redactSensitiveItemData(i)),
      meta: { total, page, perPage, totalPages },
    }
  }

  // ── Detail ───────────────────────────────────────────────────────────

  /**
   * 返回单个决策中心项的详情，包含证据链和决策时间线。
   */
  async detail(
    organizationId: number,
    projectId: number,
    itemId: string,
  ): Promise<{ data: TrizDecisionCenterDetail }> {
    const allItems = await this.collectAllItems(organizationId, projectId, 0)
    const item = allItems.find((i) => i.id === itemId)

    if (!item) {
      throw new ResourceNotFoundException('决策中心项未找到')
    }

    // 证据链：收集相关来源摘要
    const evidenceChain: TrizDecisionCenterSourceDigest[] = [item.source]

    // 决策时间线：查询关联的决策日志
    const decisionTimeline: TrizDecisionCenterTimelineEvent[] = []
    if (item.relatedDecisionLogIds.length > 0) {
      const logs = await TrizDecisionLog.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('id', item.relatedDecisionLogIds)
        .orderBy('created_at', 'desc')
        .limit(20)

      for (const log of logs) {
        decisionTimeline.push({
          id: log.id,
          decisionType: log.decisionType,
          reasonSummary: log.reasonSummary?.slice(0, 200) ?? '',
          createdBy: log.createdBy,
          createdAt: log.createdAt.toISO()!,
          hasAccess: true,
        })
      }
    }

    // Draft 阻断信息
    const draftBlockerInfo: TrizDecisionCenterDraftBlockerInfo = {
      blocked: item.readiness === 'blocked',
      reason: item.readiness === 'blocked' ? '此项目缺少关联决策日志或来源已过期' : null,
      requiredDecisionTypes: item.readiness === 'blocked' ? ['adopt', 'reject'] : [],
      draftCandidateId: null,
    }

    return {
      data: {
        item: redactSensitiveItemData(item),
        evidenceChain,
        decisionTimeline,
        draftBlockerInfo: item.readiness === 'blocked' ? draftBlockerInfo : null,
        rationaleSummary: item.source.summary,
        workbenchSchemeSummary:
          item.source.sourceKind === 'innovation_workbench' ? item.source.summary : null,
      },
    }
  }

  // ── Readiness ────────────────────────────────────────────────────────

  /**
   * 返回 Draft readiness 分组结果。
   */
  async readiness(organizationId: number, projectId: number): Promise<{ data: any }> {
    const allItems = await this.collectAllItems(organizationId, projectId, 0)

    const readyItems = allItems.filter(
      (i) =>
        i.readiness === 'ready' && !i.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH'),
    )
    const blockedItems = allItems.filter((i) => i.readiness === 'blocked')
    const staleItems = allItems.filter((i) =>
      i.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH'),
    )

    const recommendations: string[] = []
    if (blockedItems.length > 0) {
      recommendations.push('有阻塞项需要人工决策后才能进入 Draft 审查')
    }
    if (staleItems.length > 0) {
      recommendations.push('有过期来源需要刷新后再审查')
    }
    if (readyItems.length > 0) {
      recommendations.push('有可进入 Draft 审查的项，建议优先处理')
    }

    return {
      data: {
        readyItems: readyItems.map((i) => redactSensitiveItemData(i)),
        blockedItems: blockedItems.map((i) => redactSensitiveItemData(i)),
        staleItems: staleItems.map((i) => redactSensitiveItemData(i)),
        summary: {
          totalReady: readyItems.length,
          totalBlocked: blockedItems.length,
          totalStale: staleItems.length,
          recommendations,
        },
      },
    }
  }

  // ── Review Actions (tasks 5.1–5.4) ───────────────────────────────────

  /**
   * 记录决策动作（tasks 5.1, 5.2）。
   *
   * 写动作必须复用既有 TrizDecisionLogService 的追加式语义，
   * 不得直接修改来源对象。需显式确认元数据，否则拒绝。
   */
  async recordAction(
    organizationId: number,
    projectId: number,
    userId: number,
    action: any,
    request: any,
  ): Promise<any> {
    // 5.2: 显式确认元数据校验
    if (requiresExplicitConfirmation(action)) {
      const confirmationResult = validateConfirmation(request.confirmation)
      if (!confirmationResult.valid) {
        throw new ValidationException('缺少显式确认元数据: ' + confirmationResult.errors.join('; '))
      }

      // 校验 sourceHashes 与当前来源 hash 一致（stale 阻断）
      const allItems = await this.collectAllItems(organizationId, projectId, userId)
      const item = allItems.find((i) => i.id === request.itemId)
      if (item) {
        // 5.2/Requirement 3：用 isSourceHashStale 比对确认中记录的 hash 与当前来源 hash
        const confirmationHashes: string[] = (request.confirmation?.sourceHashes as string[]) ?? []
        const currentHash = item.source.sourceHash
        const hashMismatch = confirmationHashes.some((recordedHash) => recordedHash !== currentHash)
        const isStale =
          hashMismatch || item.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH')
        if (isStale) {
          // 审计 stale 阻断（低敏：含 status/warning，不含敏感 payload）
          await this.audit!.log({
            event: AuditEvent.TRIZ_DECISION_CENTER_STALE_SOURCE_BLOCKED,
            userId,
            organizationId,
            projectId,
            entityType: 'triz_decision_center',
            entityId: 0,
            metadata: {
              action,
              status: 'blocked',
              itemId: request.itemId,
              sourceKind: item.source.sourceKind,
              warningCodes: item.warnings.map((w) => w.code),
            },
          }).catch((err) => {
            logger.error({ err }, 'TRIZ decision center stale block audit failed')
          })
          throw new ValidationException('来源已过期，需刷新后再记录决策')
        }
      }
    }

    // 5.1: 映射到既有决策日志创建/废止语义
    const decisionType = this.mapActionToDecisionType(action)
    if (!this.decisionLogService) {
      throw new ValidationException('决策日志服务不可用')
    }

    // request_clarification：记录一条 clarification_requested 类型决策日志（不修改来源）
    if (action === 'request_clarification') {
      const result = await this.decisionLogService.create(organizationId, projectId, userId, {
        decisionType,
        subjectRefs: request.subjectRefs || [],
        sourceRefs: request.sourceRefs || [],
        artifactHashes: request.artifactHashes || [],
        reasonSummary: request.reasonSummary,
        alternativeSummary: request.alternativeSummary,
      })
      return { data: result }
    }

    if (action === 'supersede' && request.supersedesDecisionLogId) {
      // 废止旧决策：复用 supersede 语义
      const result = await this.decisionLogService.supersede(
        organizationId,
        projectId,
        userId,
        request.supersedesDecisionLogId,
        {
          decisionType,
          subjectRefs: request.subjectRefs || [],
          sourceRefs: request.sourceRefs || [],
          artifactHashes: request.artifactHashes || [],
          reasonSummary: request.reasonSummary,
          alternativeSummary: request.alternativeSummary,
        },
      )
      return { data: result }
    }

    // 创建决策日志（adopt/reject/partial_accept/modified_accept/supplement）
    const result = await this.decisionLogService.create(organizationId, projectId, userId, {
      decisionType,
      subjectRefs: request.subjectRefs || [],
      sourceRefs: request.sourceRefs || [],
      artifactHashes: request.artifactHashes || [],
      reasonSummary: request.reasonSummary,
      alternativeSummary: request.alternativeSummary,
    })

    return { data: result }
  }

  /**
   * 生成 AI 理由草稿（tasks 5.3）。
   *
   * 默认走确定性 fallback（零 AI 成本），不自动保存。
   * 草稿仅返回给前端供用户编辑/确认。
   */
  async generateReasonDraft(
    organizationId: number,
    projectId: number,
    userId: number,
    request: any,
  ): Promise<any> {
    const input: AiDraftInput = {
      subjectRefs: request.subjectRefs || [],
      sourceRefs: request.sourceRefs || [],
      decisionType: request.decisionType || 'adopt',
    }

    // 默认走确定性 fallback（不调用真实模型）
    const result = this.aiDraftService.generateWithFallback(input)

    // 审计 AI 草稿生成（低敏：含 status/warning，不含 prompt/输出）
    await this.audit!.log({
      event: AuditEvent.TRIZ_DECISION_CENTER_AI_DRAFT_REASON,
      userId,
      organizationId,
      projectId,
      entityType: 'triz_decision_center',
      entityId: 0,
      metadata: {
        action: 'generate_reason_draft',
        status: result.isFallback ? 'fallback' : 'ok',
        isFallback: result.isFallback,
        warningCount: result.warnings.length,
        warningCodes: result.warnings.map((w) => w.code),
      },
    }).catch((err) => {
      logger.error({ err }, 'TRIZ decision center AI draft audit failed')
    })

    return {
      data: {
        draftReason: result.draftReason,
        warnings: result.warnings,
        costSummary: result.costSummary,
        isFallback: result.isFallback,
      },
    }
  }

  /**
   * 进入 Draft 审查（tasks 5.4）。
   *
   * 仅创建 Draft 候选输入/导航，绝不执行正式 Apply。
   */
  async startDraftReview(
    organizationId: number,
    projectId: number,
    userId: number,
    itemId: string,
  ): Promise<any> {
    const allItems = await this.collectAllItems(organizationId, projectId, userId)
    const item = allItems.find((i) => i.id === itemId)

    if (!item) {
      throw new ResourceNotFoundException('决策中心项未找到')
    }

    // 5.4: readiness 仍为 advisory，stale 不可进入
    if (!canEnterDraftReview(item)) {
      // 审计阻断（低敏：含 status/warning，不含敏感 payload）
      await this.audit!.log({
        event: AuditEvent.TRIZ_DECISION_CENTER_STALE_SOURCE_BLOCKED,
        userId,
        organizationId,
        projectId,
        entityType: 'triz_decision_center',
        entityId: 0,
        metadata: {
          action: 'start_draft_review_blocked',
          status: 'blocked',
          itemId,
          sourceKind: item.source.sourceKind,
          readiness: item.readiness,
          warningCodes: item.warnings.map((w) => w.code),
        },
      }).catch((err) => {
        logger.error({ err }, 'TRIZ decision center draft review block audit failed')
      })

      return {
        data: {
          allowed: false,
          reason: '该项不满足 Draft 审查条件（readiness 非 ready 或来源已过期）',
          draftCandidateId: null,
        },
      }
    }

    // 创建 Draft 候选（仅候选，不 Apply）
    await this.audit!.log({
      event: AuditEvent.TRIZ_DECISION_CENTER_DRAFT_CANDIDATE_HANDOFF,
      userId,
      organizationId,
      projectId,
      entityType: 'triz_decision_center',
      entityId: 0,
      metadata: {
        action: 'start_draft_review',
        status: 'allowed',
        itemId,
        sourceKind: item.source.sourceKind,
        readiness: item.readiness,
      },
    }).catch((err) => {
      logger.error({ err }, 'TRIZ decision center draft handoff audit failed')
    })

    return {
      data: {
        allowed: true,
        reason: null,
        draftCandidateId: `draft-candidate-${itemId}`,
        navigationRef: item.source.navigationRef,
        // 显式提示：Apply 仍需重新校验
        advisoryNotice:
          'Draft readiness 仅为建议；Draft Layer Apply 仍需重新校验决策 refs 与 hashes。',
      },
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * 映射 Decision Center action 到决策日志 decisionType。
   */
  private mapActionToDecisionType(action: string): any {
    const map: Record<string, string> = {
      adopt: 'adopt',
      reject: 'reject',
      partial_accept: 'partial_accept',
      modified_accept: 'modified_accept',
      supplement: 'adopt', // 补充理由视为新增采纳性记录
      supersede: 'supersede',
      // 请求补充说明 → clarification_requested。枚举事实源是共享契约
      // TRIZ_DECISION_TYPES 与 triz_decision_logs 的 CHECK 约束，二者都只认
      // clarification_requested；此前写成 request_info，落库即撞 CHECK 约束。
      request_clarification: 'clarification_requested',
    }
    return map[action] ?? 'adopt'
  }

  /**
   * 从所有 adapter 收集 items。
   * 每来源数量上限（adapter 内部限制），防止大量数据。
   * 单个 adapter 失败不影响其他来源。
   */
  private async collectAllItems(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<TrizDecisionCenterItem[]> {
    const results: TrizDecisionCenterItem[] = []

    for (const adapter of this.adapters) {
      try {
        const items = await adapter.getItems(organizationId, projectId, userId)
        results.push(...items)
      } catch {
        // 单个 adapter 失败不影响其他来源
        continue
      }
    }

    // 来源二次鉴权后处理（Requirement 3）：不可访问 target 只留 generic ref kind + warning，
    // 不泄露 title/evidence/目标详情。accessible=false 的项加 INACCESSIBLE_TARGET warning，
    // 隐藏 navigationRef 与 summary（redactSensitiveItemData 已置 summary=null）。
    return results.map((item) => {
      if (!item.source.accessible) {
        const hasWarning = item.warnings.some((w) => w.code === 'TRIZ_DC_INACCESSIBLE_TARGET')
        if (!hasWarning) {
          item.warnings.push({
            code: 'TRIZ_DC_INACCESSIBLE_TARGET',
            message: '关联目标不可访问，仅保留来源种类',
          })
        }
        return {
          ...item,
          source: {
            ...item.source,
            summary: null,
            navigationRef: null,
            title: item.source.sourceKind, // 只留 generic ref kind
          },
          hasAccess: false,
        }
      }
      return item
    })
  }
}
