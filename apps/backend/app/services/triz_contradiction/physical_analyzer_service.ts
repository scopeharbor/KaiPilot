import TrizPhysicalContradictionAnalysisRun from '#models/triz_physical_contradiction_analysis_run'
import TrizPhysicalContradictionCandidate from '#models/triz_physical_contradiction_candidate'
import AuditService, { AuditEvent } from '#services/audit_service'
import PhysicalContradictionAnalysisInputCollector from '#services/triz_contradiction/physical_input_collector'
import PhysicalContradictionRuleset from '#services/triz_contradiction/physical_ruleset'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  PhysicalAnalysisRun,
  PhysicalContradictionCandidate,
  PhysicalAnalysisRunStatus,
  PhysicalCandidateStatus,
  ContradictionSeverity,
  SeparationAxis,
  PhysicalConfirmationPreview,
  PhysicalHandoffPreview,
  PhysicalCandidateAiExplanation,
  PhysicalWarningCode,
} from '@aiproj/types'
import {
  PHYSICAL_RULESET_VERSION,
  computePhysicalAnalysisInputSignature,
  computePhysicalAnalysisIdempotencyKey,
  isPhysicalCandidateStale,
} from '@aiproj/types'

export interface CreateRunInput {
  organizationId: number
  projectId: number
  actorId: number
  userContext?: string
  idempotencyKey?: string
}

export interface ListRunsQuery {
  page?: number
  perPage?: number
  status?: PhysicalAnalysisRunStatus
  sort?: string
}

export interface ListCandidatesQuery {
  page?: number
  perPage?: number
  status?: PhysicalCandidateStatus
  severity?: ContradictionSeverity
  separationAxis?: SeparationAxis
  stale?: boolean
  sort?: string
}

@inject()
export default class PhysicalContradictionAnalyzerService {
  constructor(
    private audit: AuditService,
    private collector: PhysicalContradictionAnalysisInputCollector,
    private ruleset: PhysicalContradictionRuleset,
  ) {}

  // ──────── 创建/重跑分析运行 ────────

  /**
   * 幂等创建物理矛盾分析运行。
   * 事务外收集+计算，事务内持久化（规避 SQLite 自锁）。
   */
  async createRun(input: CreateRunInput): Promise<{
    run: TrizPhysicalContradictionAnalysisRun
    candidates: TrizPhysicalContradictionCandidate[]
  }> {
    const { organizationId, projectId, actorId, userContext, idempotencyKey } = input

    // 1. 事务外：收集输入
    const collected = await this.collector.collect(organizationId, projectId, actorId, userContext)

    // 2. 事务外：计算签名和幂等 key
    const inputSignature = computePhysicalAnalysisInputSignature(collected)
    const computedIdempotencyKey = computePhysicalAnalysisIdempotencyKey(
      organizationId,
      projectId,
      actorId,
      inputSignature,
      idempotencyKey,
    )

    // 3. 检查幂等：同 key 已存在则返回已有运行
    const existing = await TrizPhysicalContradictionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', computedIdempotencyKey)
      .where('status', '!=', 'archived')
      .preload('actor')
      .first()

    if (existing) {
      const existingCandidates = await TrizPhysicalContradictionCandidate.query()
        .where('run_id', existing.id)
        .where('organization_id', organizationId)
        .where('project_id', projectId)
      return { run: existing, candidates: existingCandidates }
    }

    // 4. 事务外：运行规则集
    const result = this.ruleset.evaluate(collected)

    // 5. 确定运行状态
    const hasWarnings = result.warnings.length > 0 || collected.warnings.length > 0
    const runStatus: PhysicalAnalysisRunStatus =
      result.candidates.length === 0
        ? 'failed'
        : hasWarnings
          ? 'completed_with_warnings'
          : 'completed'

    // 6. 事务内：持久化
    const now = DateTime.now()

    const trx = await db.transaction()

    try {
      const run = new TrizPhysicalContradictionAnalysisRun()
      run.organizationId = organizationId
      run.projectId = projectId
      run.actorId = actorId
      run.status = runStatus
      run.inputSignature = inputSignature
      run.outputHash = result.outputHash
      run.ruleVersion = PHYSICAL_RULESET_VERSION
      run.idempotencyKey = computedIdempotencyKey
      run.sourceSummaryJson = collected.sourceHashes
        ? Object.fromEntries(
            Object.entries(collected.sourceHashes).map(([k, v]) => [k, { count: 0, hash: v }]),
          )
        : {}
      run.warningSummaryJson = result.warnings.map((w) => ({
        code: w.code,
        message: w.message,
      }))
      run.candidateCount = result.candidates.length
      run.createdAt = now
      run.completedAt = now

      run.useTransaction(trx)
      await run.save()

      // 持久化候选
      const candidateModels: TrizPhysicalContradictionCandidate[] = []
      for (const c of result.candidates) {
        const model = new TrizPhysicalContradictionCandidate()
        model.runId = run.id
        model.organizationId = organizationId
        model.projectId = projectId
        model.candidateKey = c.candidateKey
        model.ruleId = c.ruleId
        model.ruleVersion = c.ruleVersion
        model.status = c.status
        model.parameterKey = c.parameterKey
        model.requirementAJson = c.requirementA
        model.requirementBJson = c.requirementB
        model.separationAxis = c.separationAxis
        model.contextA = c.contextA
        model.contextB = c.contextB
        model.conditionRefsJson = c.conditionRefs
        model.severity = c.severity
        model.confidence = c.confidence
        model.impactScore = c.impactScore
        model.evidenceRefsJson = c.evidenceRefs
        model.affectedScopeJson = c.affectedScope
        model.principleRefsJson = c.principleRefs
        model.rationaleSummary = c.rationaleSummary
        model.warningCodesJson = c.warningCodes
        model.sourceHashesJson = collected.sourceHashes
        model.outputHash = c.outputHash || result.outputHash
        model.createdAt = now

        model.useTransaction(trx)
        await model.save()
        candidateModels.push(model)
      }

      await trx.commit()

      // 审计（事务外）
      await this.audit.log({
        event: AuditEvent.PHYSICAL_CONTRADICTION_ANALYSIS_RUN,
        organizationId,
        projectId,
        userId: actorId,
        metadata: {
          runId: run.id,
          candidateCount: result.candidates.length,
          status: runStatus,
        },
      })

      return { run, candidates: candidateModels }
    } catch (e) {
      await trx.rollback()
      throw e
    }
  }

  // ──────── 查询 ────────

  async listRuns(
    organizationId: number,
    projectId: number,
    query: ListRunsQuery = {},
  ): Promise<{
    data: PhysicalAnalysisRun[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const q = TrizPhysicalContradictionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (query.status) q.where('status', query.status)
    q.orderBy('created_at', 'desc')

    const result = await q.paginate(page, perPage)
    return {
      data: result.all().map(this.toRunDTO),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  async getRun(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<PhysicalAnalysisRun> {
    const run = await this.findRunOrFail(organizationId, projectId, runId)
    return this.toRunDTO(run)
  }

  async listCandidates(
    organizationId: number,
    projectId: number,
    runId: number,
    query: ListCandidatesQuery = {},
  ): Promise<{
    data: PhysicalContradictionCandidate[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    // 确保 run 存在
    await this.findRunOrFail(organizationId, projectId, runId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 50
    const q = TrizPhysicalContradictionCandidate.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)

    if (query.status) q.where('status', query.status)
    if (query.severity) q.where('severity', query.severity)
    if (query.separationAxis) q.where('separation_axis', query.separationAxis)
    if (query.stale !== undefined) {
      // stale 检测在应用层
    }

    q.orderBy('severity', 'asc')
    q.orderBy('confidence', 'desc')

    const result = await q.paginate(page, perPage)
    const all = result.all()
    const candidates = all.map((m) => this.toCandidateDTO(m))

    // 应用 stale 筛选：候选标记为 blocked_stale 即视为 stale
    const filtered =
      query.stale !== undefined
        ? candidates.filter((c) => {
            const isStale = c.status === 'blocked_stale'
            return query.stale ? isStale : !isStale
          })
        : candidates

    return {
      data: filtered,
      meta: {
        total: filtered.length,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ──────── AI 解释 ────────

  /**
   * 请求对单个候选的 AI 解释（可选）。
   * 默认使用确定性回退；真实模型调用仅在明确授权时触发。
   */
  async explainCandidate(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
  ): Promise<PhysicalCandidateAiExplanation> {
    await this.findRunOrFail(organizationId, projectId, runId)
    const candidateModel = await TrizPhysicalContradictionCandidate.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidateModel) {
      throw new ResourceNotFoundException('候选不存在')
    }

    const candidate = this.toCandidateDTO(candidateModel)

    // 默认：确定性回退，不调用真实模型
    const fallback: PhysicalCandidateAiExplanation = {
      narrative: this.buildFallbackNarrative(candidate),
      isFallback: true,
      hallucinationChecked: true,
      degradedReason: '默认不使用真实模型；待用户明确授权后可通过 AI gateway 调用',
      referencedPrincipleKeys: candidate.principleRefs.map((p) => p.principleKey),
      referencedParameterKey: candidate.parameterKey,
      confidence: candidate.confidence,
      provider: null,
      model: null,
      cost: null,
    }

    await this.audit.log({
      event: AuditEvent.PHYSICAL_CONTRADICTION_AI_EXPLANATION_FALLBACK,
      organizationId,
      projectId,
      metadata: {
        runId,
        candidateKey,
      },
    })

    return fallback
  }

  // ──────── 审查 ────────

  async reviewCandidate(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
    actorId: number,
    action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss',
  ): Promise<{
    candidateKey: string
    status: PhysicalCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }> {
    await this.findRunOrFail(organizationId, projectId, runId)
    const candidateModel = await TrizPhysicalContradictionCandidate.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidateModel) {
      throw new ResourceNotFoundException('候选不存在')
    }

    const now = DateTime.now()
    let newStatus: PhysicalCandidateStatus

    switch (action) {
      case 'mark_reviewed':
        newStatus = 'reviewed'
        break
      case 'mark_unreviewed':
        newStatus = 'unreviewed'
        break
      case 'dismiss':
        newStatus = 'dismissed'
        break
    }

    candidateModel.status = newStatus
    candidateModel.reviewedBy = actorId
    candidateModel.reviewedAt = now
    await candidateModel.save()

    await this.audit.log({
      event: AuditEvent.PHYSICAL_CONTRADICTION_REVIEW,
      organizationId,
      projectId,
      userId: actorId,
      metadata: {
        runId,
        candidateKey,
        action,
        newStatus,
      },
    })

    return {
      candidateKey: candidateModel.candidateKey,
      status: candidateModel.status,
      reviewedBy: candidateModel.reviewedBy!,
      reviewedAt: candidateModel.reviewedAt!.toISO()!,
    }
  }

  // ──────── 确认预览 ────────

  async confirmationPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
  ): Promise<PhysicalConfirmationPreview> {
    await this.findRunOrFail(organizationId, projectId, runId)
    const candidateModel = await TrizPhysicalContradictionCandidate.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidateModel) {
      throw new ResourceNotFoundException('候选不存在')
    }

    // 陈旧检查：对比候选持久化的来源 hash 与当前来源 hash
    const currentHashes = await this.collectCurrentSourceHashes(organizationId, projectId)
    const isStale = isPhysicalCandidateStale(candidateModel.sourceHashesJson, currentHashes)
    if (isStale) {
      candidateModel.status = 'blocked_stale'
      await candidateModel.save()
      await this.audit.log({
        event: AuditEvent.PHYSICAL_CONTRADICTION_STALE_BLOCKED,
        organizationId,
        projectId,
        metadata: {
          runId,
          candidateKey,
          scope: 'confirmation',
        },
      })
    }

    const preview: PhysicalConfirmationPreview = {
      candidateKey: candidateModel.candidateKey,
      parameterKey: candidateModel.parameterKey,
      projectedType: 'physical',
      projectedRequirementA: candidateModel.requirementAJson.summary,
      projectedRequirementB: candidateModel.requirementBJson.summary,
      projectedSeparationAxis: candidateModel.separationAxis,
      sourceHashes: candidateModel.sourceHashesJson,
      warnings: candidateModel.warningCodesJson,
      stale: isStale,
      requiresUserConfirmation: true,
    }

    await this.audit.log({
      event: AuditEvent.PHYSICAL_CONTRADICTION_CONFIRMATION_PREVIEW,
      organizationId,
      projectId,
      metadata: {
        runId,
        candidateKey,
        stale: isStale,
      },
    })

    return preview
  }

  // ──────── 交接预览 ────────

  async handoffPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
    targetType: 'contradiction' | 'decision_log' | 'workbench' | 'draft_layer',
  ): Promise<PhysicalHandoffPreview> {
    await this.findRunOrFail(organizationId, projectId, runId)
    const candidateModel = await TrizPhysicalContradictionCandidate.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_id', runId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidateModel) {
      throw new ResourceNotFoundException('候选不存在')
    }

    const currentHashes = await this.collectCurrentSourceHashes(organizationId, projectId)
    const isStale = isPhysicalCandidateStale(candidateModel.sourceHashesJson, currentHashes)

    const blockingWarnings: PhysicalWarningCode[] = []
    if (isStale) {
      blockingWarnings.push('HANDOFF_BLOCKED_STALE')
      candidateModel.status = 'blocked_stale'
      await candidateModel.save()
      await this.audit.log({
        event: AuditEvent.PHYSICAL_CONTRADICTION_STALE_BLOCKED,
        organizationId,
        projectId,
        metadata: {
          runId,
          candidateKey,
          scope: 'handoff',
          targetType,
        },
      })
    }

    const targetPreview: Record<string, unknown> = {
      candidateKey: candidateModel.candidateKey,
      parameterKey: candidateModel.parameterKey,
      separationAxis: candidateModel.separationAxis,
      requirementA: candidateModel.requirementAJson,
      requirementB: candidateModel.requirementBJson,
      principleRefs: candidateModel.principleRefsJson,
    }

    const preview: PhysicalHandoffPreview = {
      candidateKey: candidateModel.candidateKey,
      targetType,
      targetPreview,
      sourceHashes: candidateModel.sourceHashesJson,
      stale: isStale,
      blockingWarnings,
    }

    await this.audit.log({
      event: AuditEvent.PHYSICAL_CONTRADICTION_HANDOFF_PREVIEW,
      organizationId,
      projectId,
      metadata: {
        runId,
        candidateKey,
        targetType,
        stale: isStale,
      },
    })

    return preview
  }

  /**
   * 轻量重新收集当前来源 hash（仅用于陈旧比对，不持久化、不产出候选）。
   * 复用 collector 的来源摘要逻辑，保证与创建 run 时同口径。
   */
  private async collectCurrentSourceHashes(
    organizationId: number,
    projectId: number,
  ): Promise<Record<string, string>> {
    const collected = await this.collector.collect(organizationId, projectId, 0)
    return collected.sourceHashes
  }

  // ──────── 私有工具 ────────

  private async findRunOrFail(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<TrizPhysicalContradictionAnalysisRun> {
    const run = await TrizPhysicalContradictionAnalysisRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!run) throw new ResourceNotFoundException('分析运行不存在')
    return run
  }

  private toRunDTO(run: TrizPhysicalContradictionAnalysisRun): PhysicalAnalysisRun {
    return {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      actorId: run.actorId,
      status: run.status,
      inputSignature: run.inputSignature,
      outputHash: run.outputHash ?? '',
      ruleVersion: run.ruleVersion,
      idempotencyKey: run.idempotencyKey,
      sourceSummary: run.sourceSummaryJson,
      warningSummary: run.warningSummaryJson,
      candidateCount: run.candidateCount,
      costSummary: run.costSummaryJson,
      createdAt: run.createdAt.toISO()!,
      updatedAt: run.updatedAt?.toISO() ?? null,
      completedAt: run.completedAt?.toISO() ?? null,
      archivedAt: run.archivedAt?.toISO() ?? null,
    }
  }

  private toCandidateDTO(m: TrizPhysicalContradictionCandidate): PhysicalContradictionCandidate {
    return {
      candidateKey: m.candidateKey,
      ruleId: m.ruleId,
      ruleVersion: m.ruleVersion,
      status: m.status,
      parameterKey: m.parameterKey,
      requirementA: m.requirementAJson,
      requirementB: m.requirementBJson,
      separationAxis: m.separationAxis,
      contextA: m.contextA,
      contextB: m.contextB,
      conditionRefs: m.conditionRefsJson,
      severity: m.severity,
      confidence: m.confidence,
      impactScore: m.impactScore,
      evidenceRefs: m.evidenceRefsJson,
      affectedScope: m.affectedScopeJson,
      principleRefs: m.principleRefsJson,
      rationaleSummary: m.rationaleSummary,
      warningCodes: m.warningCodesJson,
      sourceHashes: m.sourceHashesJson,
      outputHash: m.outputHash,
      reviewedBy: m.reviewedBy,
      reviewedAt: m.reviewedAt?.toISO() ?? null,
      aiExplanationRef: m.aiExplanationRef,
      createdAt: m.createdAt.toISO()!,
      updatedAt: m.updatedAt?.toISO() ?? null,
    }
  }

  private buildFallbackNarrative(candidate: PhysicalContradictionCandidate): string {
    return `【确定性分析】项目中${candidate.parameterKey}参数存在物理矛盾：${candidate.requirementA.summary}，同时${candidate.requirementB.summary}。建议通过${candidate.separationAxis}分离来满足这两个要求。分离原则建议：${candidate.principleRefs.map((p) => p.name).join('、')}。此为规则生成的确定性摘要，非 AI 生成，仅供参考。`
  }
}
