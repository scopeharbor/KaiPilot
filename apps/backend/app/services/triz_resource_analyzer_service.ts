import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  ResourceAnalysisRunStatus,
  ResourceOpportunityStatus,
  ResourceAnalysisRun,
  ResourceSnapshot,
  ResourceOpportunityCandidate,
  ResourceOpportunityAiExplanation,
  ResourceOpportunityConfirmationPreview,
  ResourceOpportunityHandoffPreview,
  ResourceAnalysisCost,
  ListResourceAnalysesQuery,
  ListResourceAnalysesResponse,
  ListResourceSnapshotsQuery,
  ListResourceSnapshotsResponse,
  ListResourceOpportunitiesQuery,
  ListResourceOpportunitiesResponse,
  CreateResourceAnalysisRequest,
  ReviewResourceOpportunityRequest,
} from '@aiproj/types'
import {
  computeResourceAnalysisInputSignature,
  computeResourceAnalysisIdempotencyKey,
  computeResourceOpportunitiesOutputHash,
  computeResourceSnapshotsOutputHash,
  compareResourceOpportunity,
  compareResourceSnapshot,
  RESOURCE_RULESET_VERSION,
  RESOURCE_TAXONOMY_VERSION,
} from '@aiproj/types'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import TrizResourceAnalysisInputCollector from './triz_resource_analysis_input_collector.js'
import TrizResourceOpportunityRuleEngine from './triz_resource_opportunity_rule_engine.js'
import TrizResourceAnalysisRunModel from '#models/triz_resource_analysis_run'
import TrizResourceAnalysisItemModel from '#models/triz_resource_analysis_item'
import TrizResourceOpportunityCandidateModel from '#models/triz_resource_opportunity_candidate'
import { AuditEvent } from './audit_service.js'
import AuditService from './audit_service.js'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'

/** 可选说明 provider 的结构化输出契约（§6.1）。 */
export interface ResourceExplanationProviderOutput {
  narrative: string
  referencedResourceKeys: string[]
  provider?: string | null
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  latencyMs?: number | null
}

/** 说明 provider 端口；默认不注入，故默认零模型调用。 */
export interface ResourceExplanationProvider {
  generate(input: {
    promptSummary: string
    allowedResourceHashes: string[]
  }): Promise<ResourceExplanationProviderOutput | null>
}

/** 单次说明的估算成本与硬上限（与既有 AI 草稿服务同量级）。 */
const RESOURCE_AI_ESTIMATED_COST_USD = 0.01

/** 硬上限按调用时读取环境变量，便于按部署与测试调整。 */
function resourceAiBudgetHardLimitUsd(): number {
  const raw = Number(process.env.AIPROJ_TRIZ_RESOURCE_AI_BUDGET_USD ?? '1')
  return Number.isFinite(raw) ? raw : 1
}

/**
 * TRIZ 资源分析器服务（v3-triz-resource-analyzer §4.6–§4.9、§6.1–§6.3）。
 *
 * 事务外收集、确定性规则运行、短事务持久化、幂等复用、stale 标记。
 * 不修改正式资源/任务/风险/计划/文件数据。
 */
@inject()
export default class TrizResourceAnalyzerService {
  constructor(
    private collector: TrizResourceAnalysisInputCollector,
    private ruleEngine: TrizResourceOpportunityRuleEngine,
    private auditService: AuditService,
  ) {}

  // ── createRun ──
  async createRun(
    orgId: number,
    projectId: number,
    actorId: number,
    req: CreateResourceAnalysisRequest,
  ): Promise<{
    run: ResourceAnalysisRun
    resources: ResourceSnapshot[]
    opportunities: ResourceOpportunityCandidate[]
  }> {
    // 事务外收集
    const collected = await this.collector.collect({
      organizationId: orgId,
      projectId,
      actorId,
      userContext: req.userContext,
      manualResourceDrafts: req.manualResourceDrafts,
      idempotencyKey: req.idempotencyKey,
    })

    // 确定性计算
    const inputSignature = computeResourceAnalysisInputSignature(collected)
    const idempotencyKey = computeResourceAnalysisIdempotencyKey(
      orgId,
      projectId,
      actorId,
      inputSignature,
      req.idempotencyKey,
    )

    // 检查幂等复用
    // 同一 idempotency key 可能存在多行（用户显式传 key 且输入变化时旧行被标 stale），
    // 取最新一行判定，避免每次都命中最老的 stale 行反复重建。
    const existing = await TrizResourceAnalysisRunModel.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .orderBy('id', 'desc')
      .first()

    if (existing) {
      if (existing.inputSignature !== inputSignature) {
        await this.markRunStale(existing)
      } else {
        // 从既有 run 重建结果
        return this.loadRunResult(existing, orgId, projectId)
      }
    }

    // 规则引擎运行
    const result = this.ruleEngine.evaluate(collected)
    const outputHash = computeResourceOpportunitiesOutputHash(result.opportunities)
    const snapshotsHash = computeResourceSnapshotsOutputHash(result.resources)
    const status: ResourceAnalysisRunStatus =
      collected.warnings.length > 0 ? 'completed_with_warnings' : 'completed'

    // 短事务持久化
    let run: TrizResourceAnalysisRunModel
    await db.transaction(async (trx) => {
      run = await TrizResourceAnalysisRunModel.create(
        {
          organizationId: orgId,
          projectId,
          actorId,
          status,
          inputSignature,
          outputHash,
          ruleVersion: RESOURCE_RULESET_VERSION,
          taxonomyVersion: RESOURCE_TAXONOMY_VERSION,
          idempotencyKey,
          sourceSummaryJson: collected.sourceHashes
            ? Object.fromEntries(
                Object.entries(collected.sourceHashes).map(([k, v]) => [k, { count: 1, hash: v }]),
              )
            : {},
          warningSummaryJson: collected.warnings.map((w) => ({
            code: w.code,
            message: w.message,
          })),
          resourceCount: result.resources.length,
          opportunityCount: result.opportunities.length,
          costSummaryJson: null,
          completedAt: DateTime.now(),
        },
        { client: trx as TransactionClientContract },
      )

      for (const snap of result.resources) {
        await TrizResourceAnalysisItemModel.create(
          {
            runId: run.id,
            organizationId: orgId,
            projectId,
            resourceKey: snap.resourceKey,
            label: snap.label,
            resourceKind: snap.resourceKind,
            systemScope: snap.systemScope,
            origin: snap.origin,
            availability: snap.availability,
            utilizationState: snap.utilizationState,
            utilizationRate: snap.utilizationRate,
            accessibility: snap.accessibility,
            costRating: snap.costRating,
            capacity: snap.capacity,
            sourceRefsJson: snap.sourceRefs,
            sourceHashesJson: snap.sourceHashes,
            metricsJson: snap.metrics,
            constraintCodesJson: snap.constraintCodes,
            warningCodesJson: snap.warningCodes,
          },
          { client: trx as TransactionClientContract },
        )
      }

      for (const opp of result.opportunities) {
        await TrizResourceOpportunityCandidateModel.create(
          {
            runId: run.id,
            organizationId: orgId,
            projectId,
            opportunityKey: opp.opportunityKey,
            opportunityType: opp.opportunityType,
            ruleId: opp.ruleId,
            status: opp.status,
            severity: opp.severity,
            confidence: opp.confidence,
            impactScore: opp.impactScore,
            title: opp.title,
            rationaleSummary: opp.rationaleSummary,
            resourceRefsJson: opp.resourceRefs,
            targetRefsJson: opp.targetRefs,
            suggestedActionsJson: opp.suggestedActions,
            sourceHashesJson: opp.sourceHashes,
            warningCodesJson: opp.warningCodes,
            aiExplanationRefJson: null,
            outputHash: `${opp.opportunityKey}-${snapshotsHash}`,
            reviewedBy: null,
            reviewedAt: null,
          },
          { client: trx as TransactionClientContract },
        )
      }
    })

    // 事务外审计
    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_ANALYSIS_RUN,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_analysis_run',
      entityId: run!.id,
      metadata: {
        resourceCount: result.resources.length,
        opportunityCount: result.opportunities.length,
        status,
        outputHash: outputHash ?? '',
        warningCodes: collected.warnings.map((w) => w.code),
      },
    })

    // 回读持久化行：候选带上数据库 id 与真实 outputHash，前端 review/preview 依赖 id
    return this.loadRunResult(run!, orgId, projectId)
  }

  /** 读取某次运行的资源快照与机会候选（统一 DTO 出口，候选带持久化 id）。 */
  private async loadRunResult(
    run: TrizResourceAnalysisRunModel,
    orgId: number,
    projectId: number,
  ): Promise<{
    run: ResourceAnalysisRun
    resources: ResourceSnapshot[]
    opportunities: ResourceOpportunityCandidate[]
  }> {
    const items = await TrizResourceAnalysisItemModel.query()
      .where('run_id', run.id)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    const opps = await TrizResourceOpportunityCandidateModel.query()
      .where('run_id', run.id)
      .where('organization_id', orgId)
      .where('project_id', projectId)

    return {
      run: this.toRunDTO(run),
      resources: items.map((i) => this.toSnapshotDTO(i)).sort(compareResourceSnapshot),
      opportunities: opps.map((o) => this.toOpportunityDTO(o)).sort(compareResourceOpportunity),
    }
  }

  // ── listRuns ──
  async listRuns(
    orgId: number,
    projectId: number,
    query: ListResourceAnalysesQuery,
  ): Promise<ListResourceAnalysesResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let q = TrizResourceAnalysisRunModel.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (query.status) {
      q = q.where('status', query.status)
    }

    const total = await q.clone().clearOrder().count('* as total')
    const totalCount = Number((total[0] as any).$extras?.total ?? (total[0] as any).total ?? 0)
    const rows = await q.offset((page - 1) * perPage).limit(perPage)

    return {
      data: rows.map((r) => this.toRunDTO(r)),
      meta: { total: totalCount, page, perPage, totalPages: Math.ceil(totalCount / perPage) },
    }
  }

  // ── getRun ──
  async getRun(
    orgId: number,
    projectId: number,
    runId: number,
  ): Promise<ResourceAnalysisRun | null> {
    const run = await TrizResourceAnalysisRunModel.query()
      .where('id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    return run ? this.toRunDTO(run) : null
  }

  // ── listResources ──
  async listResources(
    orgId: number,
    projectId: number,
    runId: number,
    query: ListResourceSnapshotsQuery,
  ): Promise<ListResourceSnapshotsResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 50
    let q = TrizResourceAnalysisItemModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)

    if (query.resourceKind) q = q.where('resource_kind', query.resourceKind)
    if (query.systemScope) q = q.where('system_scope', query.systemScope)
    if (query.origin) q = q.where('origin', query.origin)

    const total = await q.clone().count('* as total')
    const totalCount = Number((total[0] as any).$extras?.total ?? (total[0] as any).total ?? 0)
    const rows = await q.offset((page - 1) * perPage).limit(perPage)

    return {
      data: rows.map((r) => this.toSnapshotDTO(r)).sort(compareResourceSnapshot),
      meta: { total: totalCount, page, perPage, totalPages: Math.ceil(totalCount / perPage) },
    }
  }

  // ── listOpportunities ──
  async listOpportunities(
    orgId: number,
    projectId: number,
    runId: number,
    query: ListResourceOpportunitiesQuery,
  ): Promise<ListResourceOpportunitiesResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let q = TrizResourceOpportunityCandidateModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)

    if (query.status) q = q.where('status', query.status)
    if (query.opportunityType) q = q.where('opportunity_type', query.opportunityType)
    if (query.severity) q = q.where('severity', query.severity)
    if (query.stale !== undefined) {
      // stale 过滤：检查 status = blocked_stale
      if (query.stale) q = q.where('status', 'blocked_stale')
      else q = q.whereNot('status', 'blocked_stale')
    }

    const total = await q.clone().count('* as total')
    const totalCount = Number((total[0] as any).$extras?.total ?? (total[0] as any).total ?? 0)
    const rows = await q.offset((page - 1) * perPage).limit(perPage)

    return {
      data: rows.map((o) => this.toOpportunityDTO(o)).sort(compareResourceOpportunity),
      meta: { total: totalCount, page, perPage, totalPages: Math.ceil(totalCount / perPage) },
    }
  }

  // ── getOpportunity ──
  async getOpportunity(
    orgId: number,
    projectId: number,
    runId: number,
    opportunityId: number,
  ): Promise<ResourceOpportunityCandidate | null> {
    const opp = await TrizResourceOpportunityCandidateModel.query()
      .where('id', opportunityId)
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    return opp ? this.toOpportunityDTO(opp) : null
  }

  // ── reviewOpportunity ──
  async reviewOpportunity(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
    req: ReviewResourceOpportunityRequest,
  ): Promise<ResourceOpportunityCandidate> {
    const opp = await TrizResourceOpportunityCandidateModel.query()
      .where('id', opportunityId)
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()

    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    if (opp.status === 'blocked_stale') {
      throw new ValidationException('机会候选来源已过期，请重新运行分析')
    }

    const newStatus: ResourceOpportunityStatus =
      req.action === 'mark_reviewed'
        ? 'reviewed'
        : req.action === 'mark_unreviewed'
          ? 'unreviewed'
          : 'dismissed'

    opp.status = newStatus
    opp.reviewedBy = actorId
    opp.reviewedAt = DateTime.now()
    await opp.save()

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_REVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opp.id,
      metadata: { opportunityKey: opp.opportunityKey, status: newStatus },
    })

    return this.toOpportunityDTO(opp)
  }

  // ── explainOpportunity（可选模型说明 + 确定性 fallback，§6.1–§6.3）──
  //
  // 默认无 provider 注入 → 直接走确定性 fallback，不产生任何模型调用。
  // 注入 provider 后依次经过：预算守卫 → 紧凑低敏 Context Packet → 结构化输出
  // 校验 → 反幻觉校验（引用 hash 必须来自本候选已授权 source ref）。任一环节
  // 失败都降级为确定性说明，且**任何情况下都不改写确定性事实**（资源分类、
  // 机会 key、评分、排序、source hash、状态都不受模型输出影响）。
  async explainOpportunity(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
  ): Promise<{ opportunityKey: string; explanation: ResourceOpportunityAiExplanation }> {
    const opp = await this.getOpportunity(orgId, projectId, runId, opportunityId)
    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    const provider = this.explanationProvider
    if (!provider) {
      return {
        opportunityKey: opp.opportunityKey,
        explanation: await this.fallbackExplanation(
          opp,
          orgId,
          projectId,
          actorId,
          opportunityId,
          '默认不使用真实模型；待用户明确授权后可通过 AI gateway 调用',
        ),
      }
    }

    // 预算守卫：超过硬上限直接阻断，不发起调用
    if (RESOURCE_AI_ESTIMATED_COST_USD > resourceAiBudgetHardLimitUsd()) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_AI_EXPLANATION_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_resource_opportunity_candidate',
        entityId: opportunityId,
        metadata: { opportunityKey: opp.opportunityKey, reason: 'budget_hard_blocked' },
      })
      return {
        opportunityKey: opp.opportunityKey,
        explanation: await this.fallbackExplanation(
          opp,
          orgId,
          projectId,
          actorId,
          opportunityId,
          'AI 预算硬上限已触发，已降级为确定性说明',
        ),
      }
    }

    const allowedHashes = opp.resourceRefs.map((r) => r.hash)
    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_AI_EXPLANATION_ATTEMPT,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey, refCount: allowedHashes.length },
    })

    let output: ResourceExplanationProviderOutput | null = null
    try {
      output = await provider.generate({
        promptSummary: this.buildLowSensitivityPrompt(opp),
        allowedResourceHashes: allowedHashes,
      })
    } catch {
      output = null
    }

    // 结构化输出校验
    if (
      !output ||
      typeof output.narrative !== 'string' ||
      output.narrative.trim().length === 0 ||
      !Array.isArray(output.referencedResourceKeys)
    ) {
      return {
        opportunityKey: opp.opportunityKey,
        explanation: await this.fallbackExplanation(
          opp,
          orgId,
          projectId,
          actorId,
          opportunityId,
          '模型输出不符合结构化契约，已降级为确定性说明',
        ),
      }
    }

    // 反幻觉校验：不得引用授权 source ref 之外的资源
    const unauthorized = output.referencedResourceKeys.filter((k) => !allowedHashes.includes(k))
    if (unauthorized.length > 0) {
      return {
        opportunityKey: opp.opportunityKey,
        explanation: await this.fallbackExplanation(
          opp,
          orgId,
          projectId,
          actorId,
          opportunityId,
          '模型引用了未授权来源，反幻觉校验未通过，已降级为确定性说明',
        ),
      }
    }

    const cost: ResourceAnalysisCost = {
      provider: output.provider ?? null,
      model: output.model ?? null,
      promptTokens: output.promptTokens ?? null,
      completionTokens: output.completionTokens ?? null,
      estimatedCost: RESOURCE_AI_ESTIMATED_COST_USD,
      latencyMs: output.latencyMs ?? null,
    }

    return {
      opportunityKey: opp.opportunityKey,
      explanation: {
        narrative: output.narrative,
        isFallback: false,
        hallucinationChecked: true,
        degradedReason: null,
        // 引用集合始终以确定性事实为准，模型无法新增 resource key
        referencedResourceKeys: output.referencedResourceKeys,
        confidence: opp.confidence,
        provider: cost.provider,
        model: cost.model,
        cost,
      },
    }
  }

  /** 可选说明 provider；默认 null（零模型调用）。授权接入或测试时注入。 */
  private explanationProvider: ResourceExplanationProvider | null = null

  setExplanationProvider(provider: ResourceExplanationProvider | null): void {
    this.explanationProvider = provider
  }

  /** 确定性降级说明；同时写 fallback 审计。 */
  private async fallbackExplanation(
    opp: ResourceOpportunityCandidate,
    orgId: number,
    projectId: number,
    actorId: number,
    opportunityId: number,
    degradedReason: string,
  ): Promise<ResourceOpportunityAiExplanation> {
    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_AI_EXPLANATION_FALLBACK,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey, isFallback: true, degradedReason },
    })

    return {
      narrative: this.buildFallbackNarrative(opp),
      isFallback: true,
      hallucinationChecked: true,
      degradedReason,
      referencedResourceKeys: opp.resourceRefs.map((r) => r.hash),
      confidence: opp.confidence,
      provider: null,
      model: null,
      cost: null,
    }
  }

  /** 紧凑低敏 Context Packet：只带类型/严重度/理由摘要与 hash，不带标签或成员信息。 */
  private buildLowSensitivityPrompt(opp: ResourceOpportunityCandidate): string {
    return [
      `机会类型：${opp.opportunityType}`,
      `严重度：${opp.severity}`,
      `置信度：${opp.confidence}`,
      `理由摘要：${opp.rationaleSummary}`,
      `授权来源 hash：${opp.resourceRefs.map((r) => r.hash).join(',')}`,
    ].join('\n')
  }

  // ── workbenchPreview ──
  async workbenchPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
  ): Promise<ResourceOpportunityConfirmationPreview> {
    const opp = await this.getOpportunity(orgId, projectId, runId, opportunityId)
    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    const stale = this.checkStale(opp)
    if (stale) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_resource_opportunity_candidate',
        entityId: opportunityId,
        metadata: { opportunityKey: opp.opportunityKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_WORKBENCH_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey },
    })

    return {
      opportunityKey: opp.opportunityKey,
      opportunityType: opp.opportunityType,
      projectedTitle: opp.title,
      projectedResourceRefs: opp.resourceRefs,
      projectedSuggestedActions: opp.suggestedActions,
      sourceHashes: opp.sourceHashes,
      warnings: opp.warningCodes,
      stale: false,
      requiresUserConfirmation: true,
    }
  }

  // ── decisionPreview ──
  async decisionPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
  ): Promise<ResourceOpportunityConfirmationPreview> {
    const opp = await this.getOpportunity(orgId, projectId, runId, opportunityId)
    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    const stale = this.checkStale(opp)
    if (stale) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_resource_opportunity_candidate',
        entityId: opportunityId,
        metadata: { opportunityKey: opp.opportunityKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_DECISION_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey },
    })

    return {
      opportunityKey: opp.opportunityKey,
      opportunityType: opp.opportunityType,
      projectedTitle: opp.title,
      projectedResourceRefs: opp.resourceRefs,
      projectedSuggestedActions: opp.suggestedActions,
      sourceHashes: opp.sourceHashes,
      warnings: opp.warningCodes,
      stale: false,
      requiresUserConfirmation: true,
    }
  }

  // ── draftPreview ──
  async draftPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
  ): Promise<ResourceOpportunityHandoffPreview> {
    const opp = await this.getOpportunity(orgId, projectId, runId, opportunityId)
    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    const stale = this.checkStale(opp)
    if (stale) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_resource_opportunity_candidate',
        entityId: opportunityId,
        metadata: { opportunityKey: opp.opportunityKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_DRAFT_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey },
    })

    return {
      opportunityKey: opp.opportunityKey,
      targetType: 'draft_layer',
      targetPreview: {
        title: opp.title,
        rationaleSummary: opp.rationaleSummary,
        resourceRefs: opp.resourceRefs,
        suggestedActions: opp.suggestedActions,
        idempotencyKey: opp.opportunityKey,
      },
      sourceHashes: opp.sourceHashes,
      stale: false,
      blockingWarnings: [],
    }
  }

  // ── resourcePreview ──
  async resourcePreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    opportunityId: number,
  ): Promise<ResourceOpportunityHandoffPreview> {
    const opp = await this.getOpportunity(orgId, projectId, runId, opportunityId)
    if (!opp) throw new ResourceNotFoundException('机会候选不存在')

    const stale = this.checkStale(opp)
    if (stale) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_resource_opportunity_candidate',
        entityId: opportunityId,
        metadata: { opportunityKey: opp.opportunityKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_RESOURCE_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_resource_opportunity_candidate',
      entityId: opportunityId,
      metadata: { opportunityKey: opp.opportunityKey },
    })

    return {
      opportunityKey: opp.opportunityKey,
      targetType: 'resource_preview',
      targetPreview: {
        title: opp.title,
        rationaleSummary: opp.rationaleSummary,
        resourceRefs: opp.resourceRefs,
        suggestedActions: opp.suggestedActions,
        idempotencyKey: opp.opportunityKey,
      },
      sourceHashes: opp.sourceHashes,
      stale: false,
      blockingWarnings: [],
    }
  }

  // ── 辅助 ──
  private async markRunStale(run: TrizResourceAnalysisRunModel): Promise<void> {
    run.status = 'stale'
    await run.save()
    await TrizResourceOpportunityCandidateModel.query()
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })
  }

  private checkStale(opp: ResourceOpportunityCandidate): boolean {
    return opp.status === 'blocked_stale'
  }

  private buildFallbackNarrative(opp: ResourceOpportunityCandidate): string {
    const typeLabels: Record<string, string> = {
      idle_capacity: '闲置能力',
      substitute_resource: '替代资源',
      reuse_existing_asset: '复用现有资产',
      external_low_cost_resource: '外部低成本资源',
      information_gap: '信息资源缺口',
      automation_opportunity: '自动化机会',
      overload_relief: '过载缓解',
      environmental_resource: '环境资源',
      constraint_as_resource: '约束转用',
    }
    const typeLabel = typeLabels[opp.opportunityType] ?? opp.opportunityType
    return `【${typeLabel}】${opp.rationaleSummary}\n\n建议操作：${opp.suggestedActions.join('、')}。\n（本说明为确定性生成，仅供参考，不自动执行。）`
  }

  // DTO 转换
  private toRunDTO(model: TrizResourceAnalysisRunModel): ResourceAnalysisRun {
    return {
      id: model.id,
      organizationId: model.organizationId,
      projectId: model.projectId,
      actorId: model.actorId,
      status: model.status as ResourceAnalysisRunStatus,
      inputSignature: model.inputSignature,
      outputHash: model.outputHash ?? '',
      ruleVersion: model.ruleVersion,
      taxonomyVersion: model.taxonomyVersion,
      idempotencyKey: model.idempotencyKey,
      sourceSummary: model.sourceSummaryJson ?? {},
      warningSummary: (model.warningSummaryJson ?? []) as any,
      resourceCount: model.resourceCount,
      opportunityCount: model.opportunityCount,
      costSummary: model.costSummaryJson as ResourceAnalysisCost | null,
      createdAt: model.createdAt?.toISO() ?? '',
      updatedAt: model.updatedAt?.toISO() ?? null,
      completedAt: model.completedAt?.toISO() ?? null,
      archivedAt: model.archivedAt?.toISO() ?? null,
    }
  }

  private toSnapshotDTO(model: TrizResourceAnalysisItemModel): ResourceSnapshot {
    return {
      resourceKey: model.resourceKey,
      label: model.label,
      resourceKind: model.resourceKind as any,
      systemScope: model.systemScope as any,
      origin: model.origin as any,
      availability: model.availability as any,
      utilizationState: model.utilizationState as any,
      utilizationRate: model.utilizationRate,
      accessibility: model.accessibility,
      costRating: (model.costRating ?? 'unknown') as 'low' | 'medium' | 'high' | 'unknown',
      capacity: model.capacity,
      sourceRefs: (model.sourceRefsJson ?? []) as any,
      sourceHashes: (model.sourceHashesJson ?? {}) as Record<string, string>,
      constraintCodes: (model.constraintCodesJson ?? []) as any,
      warningCodes: (model.warningCodesJson ?? []) as any,
      metrics: (model.metricsJson ?? {}) as Record<string, number | string | null>,
    }
  }

  private toOpportunityDTO(
    model: TrizResourceOpportunityCandidateModel,
  ): ResourceOpportunityCandidate {
    return {
      id: model.id,
      opportunityKey: model.opportunityKey,
      opportunityType: model.opportunityType as any,
      ruleId: model.ruleId,
      status: model.status as ResourceOpportunityStatus,
      severity: model.severity as any,
      confidence: model.confidence,
      impactScore: model.impactScore,
      title: model.title,
      rationaleSummary: model.rationaleSummary,
      resourceRefs: (model.resourceRefsJson ?? []) as any,
      targetRefs: (model.targetRefsJson ?? []) as any,
      suggestedActions: (model.suggestedActionsJson ?? []) as string[],
      sourceHashes: (model.sourceHashesJson ?? {}) as Record<string, string>,
      warningCodes: (model.warningCodesJson ?? []) as any,
      aiExplanationRef: null,
      reviewedBy: model.reviewedBy,
      reviewedAt: model.reviewedAt?.toISO() ?? null,
      outputHash: model.outputHash,
      createdAt: model.createdAt?.toISO() ?? '',
      updatedAt: model.updatedAt?.toISO() ?? null,
    }
  }
}
