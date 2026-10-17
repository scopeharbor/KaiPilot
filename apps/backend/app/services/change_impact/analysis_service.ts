import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeImpactItem from '#models/change_impact_item'
import ChangeRequest from '#models/change_request'
import AuditService, { AuditEvent } from '#services/audit_service'
import ChangeImpactInputCollector from '#services/change_impact/input_collector'
import ChangeImpactRuleset, {
  computeInputSignature,
  RULESET_VERSION,
} from '#services/change_impact/ruleset'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import type {
  AnalysisScope,
  ChangeImpactAnalysisStatus,
  ChangeImpactItem as ChangeImpactItemType,
  ChangeImpactSummary,
} from '@aiproj/types'

/**
 * 变更影响分析服务（v2-change-management-impact-analysis D1,D2,D5）。
 *
 * 只读编排：读取项目事实 → 规则引擎 → 保存快照。
 * 禁止修改任务、依赖、WBS、里程碑、资源、风险或项目基线。
 */
@inject()
export default class ChangeImpactAnalysisService {
  constructor(
    private audit: AuditService,
    private collector: ChangeImpactInputCollector,
    private ruleset: ChangeImpactRuleset,
  ) {}

  // ──────── 创建分析 ────────

  /**
   * 创建影响分析快照。
   * 在事务内保存分析记录和受影响项。
   */
  async createAnalysis(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    userId: number,
    scope?: Partial<AnalysisScope>,
    requestId?: string | null,
  ): Promise<ChangeImpactAnalysis> {
    // 只读输入收集和确定性规则计算必须在写事务外完成。SQLite 测试环境通常
    // 只有单连接池，在事务内再发非事务查询会等待自身释放连接而死锁。
    const input = await this.collector.collect(organizationId, projectId, changeRequestId, scope)
    const inputSignature = computeInputSignature(input)
    const { items, summary, warnings } = this.ruleset.propagate(input)
    const outputHash = this.computeOutputHash(items, summary)

    return db.transaction(async (trx) => {
      // 保存分析快照
      const analysis = await ChangeImpactAnalysis.create(
        {
          organizationId,
          projectId,
          changeRequestId,
          ruleVersion: RULESET_VERSION,
          inputSignature,
          outputHash,
          status: 'completed' as ChangeImpactAnalysisStatus,
          scope: scope
            ? {
                dimensions:
                  scope.dimensions ?? (['scope', 'schedule', 'resource', 'risk', 'quality'] as any),
                maxPropagationDepth: scope.maxPropagationDepth ?? 5,
                includeEvidenceDetails: scope.includeEvidenceDetails ?? false,
              }
            : null,
          warnings: warnings.length > 0 ? warnings : null,
          missingInputs: input.missingInputs.length > 0 ? input.missingInputs : null,
          summary,
          createdBy: userId,
        },
        { client: trx },
      )

      // 批量创建影响项
      if (items.length > 0) {
        const itemRows = items.map((item: ChangeImpactItemType) => ({
          analysisId: analysis.id,
          entityType: item.entityType,
          entityId: item.entityId,
          dimension: item.dimension,
          severity: item.severity,
          score: item.score,
          propagationPath: item.propagationPath,
          depth: item.depth,
          ruleId: item.ruleId,
          evidence: item.evidence,
          requiresReview: item.requiresReview,
          isVisible: item.isVisible,
        }))
        await ChangeImpactItem.createMany(itemRows, { client: trx })
      }

      // 更新变更请求的当前分析引用
      const cr = await ChangeRequest.query({ client: trx })
        .where('id', changeRequestId)
        .where('project_id', projectId)
        .first()
      if (cr) {
        cr.currentImpactAnalysisId = analysis.id
        cr.useTransaction(trx)
        await cr.save()
      }

      // 审计
      await this.audit.log({
        event: AuditEvent.CHANGE_IMPACT_ANALYSIS_CREATED as any,
        userId,
        organizationId,
        projectId,
        entityType: 'change_impact_analysis',
        entityId: analysis.id,
        requestId: requestId ?? null,
        client: trx,
        metadata: {
          changeRequestId,
          ruleVersion: RULESET_VERSION,
          totalAffected: summary.totalAffected,
          severityDistribution: summary.severityDistribution,
          inputSignature,
        },
        strict: true,
      })

      return analysis
    })
  }

  // ──────── 刷新分析（创建新快照，保留旧快照）───────

  /**
   * 为同一变更请求创建新分析快照。
   * 旧快照保留用于审计和历史比较。
   */
  async refreshAnalysis(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    userId: number,
    scope?: Partial<AnalysisScope>,
    requestId?: string | null,
  ): Promise<ChangeImpactAnalysis> {
    // 创建新分析（与 createAnalysis 逻辑相同，但语义不同）
    const analysis = await this.createAnalysis(
      organizationId,
      projectId,
      changeRequestId,
      userId,
      scope,
      requestId,
    )

    // 额外审计：刷新事件
    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_ANALYSIS_REFRESHED as any,
      userId,
      organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: { changeRequestId, newAnalysisId: analysis.id },
    })

    return analysis
  }

  // ──────── 获取分析详情 ────────

  /**
   * 获取影响分析详情（含影响项列表）。
   */
  async getAnalysis(analysisId: number, projectId: number): Promise<ChangeImpactAnalysis> {
    const analysis = await ChangeImpactAnalysis.query()
      .where('id', analysisId)
      .where('project_id', projectId)
      .first()

    if (!analysis) {
      throw new ResourceNotFoundException('影响分析不存在')
    }

    return analysis
  }

  /**
   * 按组织隔离获取影响分析（扁平路由用）。
   *
   * 扁平路由 `/impact-analyses/:id` 不带 projectId，需从记录本身解析真实
   * projectId，并以 `organization_id` 强制组织隔离，避免跨组织越权。
   */
  async getAnalysisInOrg(
    analysisId: number,
    organizationId: number,
  ): Promise<ChangeImpactAnalysis> {
    const analysis = await ChangeImpactAnalysis.query()
      .where('id', analysisId)
      .where('organization_id', organizationId)
      .first()

    if (!analysis) {
      throw new ResourceNotFoundException('影响分析不存在')
    }

    return analysis
  }

  /**
   * 获取分析的影响项列表。
   */
  async getAnalysisItems(analysisId: number): Promise<ChangeImpactItemType[]> {
    return ChangeImpactItem.query()
      .where('analysis_id', analysisId)
      .orderBy('score', 'desc')
      .orderBy('entity_type')
      .orderBy('entity_id') as unknown as ChangeImpactItemType[]
  }

  // ──────── 列表 ────────

  /**
   * 列出变更请求的影响分析历史。
   */
  async listAnalyses(
    projectId: number,
    changeRequestId: number,
    page = 1,
    perPage = 20,
  ): Promise<{
    data: ChangeImpactAnalysis[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const query = ChangeImpactAnalysis.query()
      .where('project_id', projectId)
      .where('change_request_id', changeRequestId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')

    const paginator = await query.paginate(page, Math.min(100, Math.max(1, perPage)))
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

  // ──────── 过期检测 ────────

  /**
   * 检测分析是否过期（D5）。
   * 基于输入签名、源数据时间戳和规则版本。
   */
  async detectStale(
    analysisId: number,
    projectId: number,
  ): Promise<{ isStale: boolean; reason: string | null }> {
    const analysis = await this.getAnalysis(analysisId, projectId)

    // 规则版本过旧
    if (analysis.ruleVersion !== RULESET_VERSION) {
      return {
        isStale: true,
        reason: `规则版本已变更（${analysis.ruleVersion} → ${RULESET_VERSION}），需要刷新分析`,
      }
    }

    // 已完成状态且未过期
    if (analysis.status === 'stale') {
      return { isStale: true, reason: analysis.staleReason ?? '分析已标记为过期' }
    }

    try {
      const currentInput = await this.collector.collect(
        analysis.organizationId,
        analysis.projectId,
        analysis.changeRequestId,
        analysis.scope ?? undefined,
      )
      const currentSignature = computeInputSignature(currentInput)
      if (currentSignature !== analysis.inputSignature) {
        return {
          isStale: true,
          reason: '变更请求或相关项目事实已变化，需要刷新分析',
        }
      }
    } catch {
      // 如果无法读取变更请求，保守标记为 stale
      return { isStale: true, reason: '无法验证项目事实一致性' }
    }

    return { isStale: false, reason: null }
  }

  /**
   * 标记分析为过期。
   */
  async markStale(
    analysisId: number,
    projectId: number,
    reason: string,
    userId?: number | null,
    requestId?: string | null,
  ): Promise<ChangeImpactAnalysis> {
    const analysis = await this.getAnalysis(analysisId, projectId)
    analysis.status = 'stale' as ChangeImpactAnalysisStatus
    analysis.staleReason = reason
    await analysis.save()
    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_ANALYSIS_STALE_DETECTED as any,
      userId: userId ?? null,
      organizationId: analysis.organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: {
        changeRequestId: analysis.changeRequestId,
        ruleVersion: analysis.ruleVersion,
        inputSignature: analysis.inputSignature,
        staleReason: reason,
      },
    })
    return analysis
  }

  // ──────── 人工确认 ────────

  /**
   * 确认分析结果（人工确认）。
   */
  async confirmAnalysis(
    analysisId: number,
    projectId: number,
    userId: number,
    reason?: string | null,
    requestId?: string | null,
  ): Promise<ChangeImpactAnalysis> {
    const analysis = await this.getAnalysis(analysisId, projectId)
    const prevStatus = analysis.status

    analysis.confirmedBy = userId
    analysis.confirmedAt = DateTime.now()
    analysis.confirmReason = reason ?? null
    await analysis.save()

    // 审计
    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED as any,
      userId,
      organizationId: analysis.organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: { changeRequestId: analysis.changeRequestId, prevStatus },
    })

    return analysis
  }

  /**
   * 确认继续使用过期分析（审批时可引用已过期但人工确认过可用的分析）。
   */
  async confirmStaleAnalysis(
    analysisId: number,
    projectId: number,
    userId: number,
    reason: string,
    requestId?: string | null,
  ): Promise<ChangeImpactAnalysis> {
    const analysis = await this.getAnalysis(analysisId, projectId)
    const prevStatus = analysis.status

    analysis.status = 'stale' as ChangeImpactAnalysisStatus
    analysis.confirmedBy = userId
    analysis.confirmedAt = DateTime.now()
    analysis.confirmReason = reason
    await analysis.save()

    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_ANALYSIS_CONFIRMED_STALE as any,
      userId,
      organizationId: analysis.organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysis.id,
      requestId: requestId ?? null,
      metadata: { changeRequestId: analysis.changeRequestId, prevStatus, confirmReason: reason },
    })

    return analysis
  }

  // ──────── 审批引用 ────────

  /**
   * 在审批时引用影响分析快照（独立事务入口）。
   * 记录引用的分析 ID、摘要和确认状态。审批链路请优先使用 `applyApprovalReference`
   * 以复用审批事务，保证过期阻断时整个审批回滚。
   */
  async referenceForApproval(
    organizationId: number,
    projectId: number,
    changeRequestId: number,
    analysisId: number,
    userId: number,
    confirmStaleReason?: string | null,
    requestId?: string | null,
  ): Promise<void> {
    const staleState = await this.detectStale(analysisId, projectId)
    return db.transaction(async (trx) => {
      const cr = await ChangeRequest.query({ client: trx })
        .where('id', changeRequestId)
        .where('project_id', projectId)
        .first()
      if (!cr) throw new ResourceNotFoundException('变更请求不存在')

      await this.applyApprovalReference(
        trx,
        cr,
        organizationId,
        projectId,
        analysisId,
        userId,
        confirmStaleReason,
        requestId,
        staleState,
      )
    })
  }

  /**
   * 在既有事务中，把审批引用套用到已加载的变更请求实例上。
   *
   * 供 `ChangeRequestService` 审批流程内联调用：与审批状态迁移共享事务，
   * 若分析已过期且未提供继续使用理由则抛出校验异常，触发整个审批回滚。
   * 只写审批引用冗余字段，不修改任务/依赖/里程碑/资源/风险/基线。
   */
  async applyApprovalReference(
    trx: TransactionClientContract,
    cr: ChangeRequest,
    organizationId: number,
    projectId: number,
    analysisId: number,
    userId: number,
    confirmStaleReason?: string | null,
    requestId?: string | null,
    staleState?: { isStale: boolean; reason: string | null },
  ): Promise<void> {
    const analysis = await ChangeImpactAnalysis.query({ client: trx })
      .where('id', analysisId)
      .where('project_id', projectId)
      .where('organization_id', organizationId)
      .where('change_request_id', cr.id)
      .first()
    if (!analysis) throw new ResourceNotFoundException('影响分析不存在或不属于该变更请求')

    // 检查是否过期：审批事务入口会预先计算，避免在 SQLite 单连接事务内
    // 再执行非事务输入收集导致连接池自锁；独立入口则在事务外预检后传入。
    const { isStale, reason } = staleState ?? {
      isStale: analysis.status === 'stale' || analysis.ruleVersion !== RULESET_VERSION,
      reason:
        analysis.staleReason ??
        (analysis.ruleVersion !== RULESET_VERSION ? '规则版本已变更，需要刷新分析' : null),
    }
    if (isStale && !confirmStaleReason) {
      throw new ValidationException(`影响分析已过期：${reason ?? '请刷新或确认继续使用'}`)
    }

    // 更新变更请求的审批引用冗余字段（就地修改传入实例，令审批响应可见）
    cr.approveRefAnalysisId = analysisId
    cr.approveRefSummaryOverride = analysis.summary
      ? JSON.parse(JSON.stringify(analysis.summary))
      : null
    cr.impactAnalysisConfirmStatus = isStale ? 'confirmed_stale' : 'confirmed'
    cr.useTransaction(trx)
    await cr.save()

    await this.audit.log({
      event: AuditEvent.CHANGE_IMPACT_APPROVE_REFERENCED as any,
      userId,
      organizationId,
      projectId,
      entityType: 'change_impact_analysis',
      entityId: analysisId,
      requestId: requestId ?? null,
      client: trx,
      metadata: {
        changeRequestId: cr.id,
        severity: analysis.summary?.severityDistribution,
        totalAffected: analysis.summary?.totalAffected,
        isStale,
        confirmStaleReason: confirmStaleReason ?? null,
      },
    })
  }

  // ──────── 内部方法 ────────

  private computeOutputHash(items: ChangeImpactItemType[], _summary: ChangeImpactSummary): string {
    let hash = 0
    for (const item of items) {
      const str = `${item.entityType}:${item.entityId}:${item.dimension}:${item.severity}:${item.score}`
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
      }
    }
    return `out-${Math.abs(hash).toString(16).padStart(8, '0')}`
  }
}
