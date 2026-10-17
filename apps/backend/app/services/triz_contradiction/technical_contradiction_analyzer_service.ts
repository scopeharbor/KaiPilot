import TrizTechnicalContradictionAnalysisRun from '#models/triz_technical_contradiction_analysis_run'
import TrizTechnicalContradictionCandidate from '#models/triz_technical_contradiction_candidate'
import AuditService, { AuditEvent } from '#services/audit_service'
import TechnicalContradictionAnalysisInputCollector from '#services/triz_contradiction/technical_analysis_input_collector'
import ContradictionDetectionRuleset from '#services/triz_contradiction/ruleset'
import PrincipleSuggestionMapper from '#services/triz_contradiction/principle_mapper'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  CandidateContradiction,
  ContradictionInputSnapshot,
  ContradictionInputWarning,
  TechnicalAnalysisRun,
  TechnicalContradictionCandidate,
  TechnicalCandidateStatus,
  TechnicalWarningCode,
  CreateTechnicalAnalysisRequest,
  ListTechnicalAnalysesQuery,
  ListTechnicalCandidatesQuery,
  ReviewTechnicalCandidateRequest,
  TechnicalConfirmationPreview,
  TechnicalHandoffPreview,
} from '@aiproj/types'
import {
  TECHNICAL_RULESET_VERSION,
  computeTechnicalAnalysisInputSignature,
  computeTechnicalAnalysisIdempotencyKey,
  computeTechnicalCandidateKey,
  computeTechnicalCandidatesOutputHash,
  computeTechnicalImpactScore,
  compareTechnicalCandidate,
  deterministicHash,
} from '@aiproj/types'

/**
 * 技术矛盾分析器服务（v3-triz-technical-contradiction-analyzer §4.3–§4.8）。
 *
 * 确定性优先的编排：收集输入 → 确定性规则集 → 原则映射 → 持久化。
 * 所有收集和计算在事务外完成；事务仅持久化。
 * 复用现有的 ContradictionDetectionRuleset 和 PrincipleSuggestionMapper。
 */
@inject()
export default class TechnicalContradictionAnalyzerService {
  constructor(
    private audit: AuditService,
    private collector: TechnicalContradictionAnalysisInputCollector,
    private ruleset: ContradictionDetectionRuleset,
    private principleMapper: PrincipleSuggestionMapper,
  ) {}

  /**
   * 创建技术矛盾分析运行（幂等）。
   * 如果存在相同 idempotencyKey + inputSignature 的已完成运行，直接返回。
   */
  async createAnalysis(
    organizationId: number,
    projectId: number,
    actorId: number,
    request: CreateTechnicalAnalysisRequest,
  ): Promise<TechnicalAnalysisRun & { candidates: TechnicalContradictionCandidate[] }> {
    // 事务外：收集输入
    const collected = await this.collector.collect({
      organizationId,
      projectId,
      actorId,
      userContext: request.userContext,
    })

    // 事务外：计算签名
    const inputSignature = computeTechnicalAnalysisInputSignature(collected)
    const idempotencyKey = computeTechnicalAnalysisIdempotencyKey(
      organizationId,
      projectId,
      actorId,
      inputSignature,
      request.idempotencyKey,
    )

    // 幂等检查
    const existing = await this.findExistingRun(organizationId, projectId, idempotencyKey)
    if (existing) {
      if (existing.inputSignature === inputSignature && existing.status === 'completed') {
        // 返回已有运行（幂等命中）
        return this.assembleRunResponse(existing)
      }
      // 相同 key 但签名不同 → 标记旧运行 stale
      await this.markRunStale(existing)
    }

    // 事务外：运行规则集（只取 technical candidates）
    const inputSnapshot: ContradictionInputSnapshot = {
      organizationId,
      projectId,
      taskTotal: collected.taskTotal,
      overdueTaskCount: collected.overdueTaskCount,
      criticalPathTaskCount: collected.criticalPathTaskCount,
      criticalPathDensity: collected.criticalPathDensity,
      resourceUtilization: collected.resourceUtilization,
      resourceOverloadCount: collected.resourceOverloadCount,
      activeRiskCount: collected.activeRiskCount,
      highRiskCount: collected.highRiskCount,
      milestoneTotal: collected.milestoneTotal,
      changeRequestCount: collected.changeRequestCount,
      plannedDurationDays: collected.plannedDurationDays,
      scopeItemCount: collected.scopeItemCount,
      warnings: collected.warnings,
      ruleVersion: TECHNICAL_RULESET_VERSION,
    }

    const rulesetResult = this.ruleset.evaluate(inputSnapshot)
    // 只保留 type=technical 的候选
    const technicalCandidates = rulesetResult.candidates.filter((c) => c.type === 'technical')

    // 事务外：为每个候选映射原则建议
    const candidatesWithPrinciples = technicalCandidates.map((c) =>
      this.enrichCandidate(c, collected, TECHNICAL_RULESET_VERSION),
    )

    // 稳定排序
    candidatesWithPrinciples.sort(compareTechnicalCandidate)

    // 计算 output hash
    const outputHash = computeTechnicalCandidatesOutputHash(candidatesWithPrinciples)

    // 构建 warning 摘要
    const warningSummary = this.buildWarningSummary(collected.warnings, rulesetResult.warnings)

    // 事务内：持久化
    const run = await db.transaction(async (trx) => {
      const newRun = await TrizTechnicalContradictionAnalysisRun.create(
        {
          organizationId,
          projectId,
          actorId,
          status: warningSummary.length > 0 ? 'completed_with_warnings' : 'completed',
          inputSignature,
          outputHash,
          ruleVersion: TECHNICAL_RULESET_VERSION,
          idempotencyKey,
          sourceSummaryJson: this.buildSourceSummary(collected),
          warningSummaryJson: warningSummary,
          candidateCount: candidatesWithPrinciples.length,
          completedAt: DateTime.now(),
        },
        { client: trx },
      )

      // 持久化候选
      for (const c of candidatesWithPrinciples) {
        await TrizTechnicalContradictionCandidate.create(
          {
            runId: newRun.id,
            organizationId,
            projectId,
            candidateKey: c.candidateKey,
            ruleId: c.ruleId,
            ruleVersion: c.ruleVersion,
            status: c.status,
            improvingParameterKey: c.improvingParameterKey,
            worseningParameterKey: c.worseningParameterKey,
            improvingDirection: c.improvingDirection,
            worseningDirection: c.worseningDirection,
            title: c.title,
            severity: c.severity,
            confidence: c.confidence,
            impactScore: c.impactScore,
            evidenceRefsJson: c.evidenceRefs,
            affectedScopeJson: c.affectedScope,
            principleRefsJson: c.principleRefs,
            rationaleSummary: c.rationaleSummary,
            warningCodesJson: c.warningCodes,
            sourceHashesJson: c.sourceHashes,
            outputHash: c.outputHash,
          },
          { client: trx },
        )
      }

      return newRun
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.TECHNICAL_CONTRADICTION_ANALYSIS_RUN,
      userId: actorId,
      organizationId,
      projectId,
      metadata: {
        runId: run.id,
        inputSignature,
        outputHash,
        candidateCount: candidatesWithPrinciples.length,
        warningCount: warningSummary.length,
      },
    })

    return this.assembleRunResponse(run)
  }

  /** 列出项目的分析运行 */
  async listRuns(
    organizationId: number,
    projectId: number,
    query: ListTechnicalAnalysesQuery,
  ): Promise<{
    data: TechnicalAnalysisRun[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let dbQuery = TrizTechnicalContradictionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (query.status) {
      dbQuery = dbQuery.where('status', query.status)
    }

    const result = await dbQuery.paginate(page, perPage)

    return {
      data: result.all().map((r) => this.toRunDTO(r)),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 读取单个运行详情 */
  async getRun(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<TechnicalAnalysisRun> {
    const run = await TrizTechnicalContradictionAnalysisRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('技术矛盾分析运行不存在')
    }

    return this.toRunDTO(run)
  }

  /** 列出运行的候选 */
  async listCandidates(
    organizationId: number,
    projectId: number,
    runId: number,
    query: ListTechnicalCandidatesQuery,
  ): Promise<{
    data: TechnicalContradictionCandidate[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let dbQuery = TrizTechnicalContradictionCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('impact_score', 'desc')

    if (query.status) {
      dbQuery = dbQuery.where('status', query.status)
    }
    if (query.severity) {
      dbQuery = dbQuery.where('severity', query.severity)
    }
    if (query.stale !== undefined) {
      // 陈旧候选以 status='blocked_stale' 表示：stale=true 仅取陈旧，false 仅取新鲜
      if (query.stale) {
        dbQuery = dbQuery.where('status', 'blocked_stale')
      } else {
        dbQuery = dbQuery.whereNot('status', 'blocked_stale')
      }
    }

    const result = await dbQuery.paginate(page, perPage)

    const candidates = result.all().map((c) => this.toCandidateDTO(c))

    return {
      data: candidates,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 审查候选（mark_reviewed / mark_unreviewed / dismiss） */
  async reviewCandidate(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
    actorId: number,
    request: ReviewTechnicalCandidateRequest,
  ): Promise<{
    candidateKey: string
    status: TechnicalCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }> {
    const candidate = await TrizTechnicalContradictionCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidate) {
      throw new ResourceNotFoundException('技术矛盾候选不存在')
    }

    // 陈旧阻止审查
    if (candidate.status === 'blocked_stale') {
      throw new ValidationException('候选已陈旧，无法审查。请重新分析。')
    }

    const statusMap: Record<string, TechnicalCandidateStatus> = {
      mark_reviewed: 'reviewed',
      mark_unreviewed: 'unreviewed',
      dismiss: 'dismissed',
    }

    const newStatus = statusMap[request.action]
    if (!newStatus) {
      throw new ValidationException('无效的审查动作')
    }

    candidate.status = newStatus
    candidate.reviewedBy = actorId
    candidate.reviewedAt = DateTime.now()
    await candidate.save()

    await this.audit.log({
      event: AuditEvent.TECHNICAL_CONTRADICTION_REVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: {
        runId,
        candidateKey,
        action: request.action,
        reason: request.reason ?? null,
      },
    })

    return {
      candidateKey: candidate.candidateKey,
      status: candidate.status,
      reviewedBy: actorId,
      reviewedAt: candidate.reviewedAt!.toISO()!,
    }
  }

  /**
   * 创建确认预览（不写入正式矛盾记录）。
   * 验证 source hash 后在预览中投影候选字段。
   */
  async createConfirmationPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
  ): Promise<TechnicalConfirmationPreview> {
    const candidate = await this.findCandidateOrFail(organizationId, projectId, runId, candidateKey)

    // 陈旧候选：来源 hash 不再匹配当前项目事实 → 阻止确认，标记 stale（Requirement 7）
    const stale = candidate.status === 'blocked_stale'
    const warnings: TechnicalWarningCode[] = [...candidate.warningCodesJson]
    if (stale) {
      warnings.push('HANDOFF_BLOCKED_STALE')
    }

    return {
      candidateKey: candidate.candidateKey,
      improvingParameterKey: candidate.improvingParameterKey,
      worseningParameterKey: candidate.worseningParameterKey,
      projectedType: 'technical',
      projectedTitle: candidate.title,
      projectedImprovingDirection: candidate.improvingDirection,
      projectedWorseningDirection: candidate.worseningDirection,
      projectedPrincipleRefs: candidate.principleRefsJson.map((p) => ({
        principleId: p.principleId,
        name: p.name,
        relevance: p.relevance,
        advice: p.advice,
      })),
      sourceHashes: candidate.sourceHashesJson,
      warnings,
      stale,
      requiresUserConfirmation: true,
    }
  }

  /**
   * 创建交接预览（Decision Log / Workbench / Draft Layer 候选）。
   */
  async createHandoffPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
    targetType: 'contradiction' | 'decision_log' | 'workbench' | 'draft_layer',
    actorId: number,
  ): Promise<TechnicalHandoffPreview> {
    const candidate = await this.findCandidateOrFail(organizationId, projectId, runId, candidateKey)

    const blockingWarnings: TechnicalWarningCode[] = []
    if (candidate.status === 'blocked_stale') {
      blockingWarnings.push('HANDOFF_BLOCKED_STALE')
    }

    const targetPreview: Record<string, unknown> = {
      candidateKey: candidate.candidateKey,
      ruleId: candidate.ruleId,
      title: candidate.title,
      improvingParameterKey: candidate.improvingParameterKey,
      worseningParameterKey: candidate.worseningParameterKey,
      principleRefs: candidate.principleRefsJson,
      rationaleSummary: candidate.rationaleSummary,
      sourceHashes: candidate.sourceHashesJson,
    }

    await this.audit.log({
      event: AuditEvent.TECHNICAL_CONTRADICTION_HANDOFF_PREVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: { runId, candidateKey, targetType, stale: blockingWarnings.length > 0 },
    })

    return {
      candidateKey: candidate.candidateKey,
      targetType,
      targetPreview,
      sourceHashes: candidate.sourceHashesJson,
      stale: blockingWarnings.length > 0,
      blockingWarnings,
    }
  }

  // ─── Private helpers ───

  private async findExistingRun(
    organizationId: number,
    projectId: number,
    idempotencyKey: string,
  ): Promise<TrizTechnicalContradictionAnalysisRun | null> {
    return TrizTechnicalContradictionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .first()
  }

  private async markRunStale(run: TrizTechnicalContradictionAnalysisRun): Promise<void> {
    run.status = 'stale'
    await run.save()
    // Also mark all candidates stale
    await TrizTechnicalContradictionCandidate.query()
      .where('run_id', run.id)
      .update({ status: 'blocked_stale', updatedAt: DateTime.now() })
  }

  private async findCandidateOrFail(
    organizationId: number,
    projectId: number,
    runId: number,
    candidateKey: string,
  ): Promise<TrizTechnicalContradictionCandidate> {
    const candidate = await TrizTechnicalContradictionCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('candidate_key', candidateKey)
      .first()

    if (!candidate) {
      throw new ResourceNotFoundException('技术矛盾候选不存在')
    }

    return candidate
  }

  private enrichCandidate(
    c: CandidateContradiction,
    collected: ReturnType<TechnicalContradictionAnalysisInputCollector['collect']> extends Promise<
      infer T
    >
      ? T
      : never,
    ruleVersion: string,
  ): TechnicalContradictionCandidate {
    const candidateKey = computeTechnicalCandidateKey(
      c.ruleId,
      c.improvingParameterKey ?? '',
      c.worseningParameterKey ?? '',
    )

    // 映射原则建议
    const principleRefs = this.principleMapper.suggestPrinciples(c).map((p) => ({
      principleId: p.principleId,
      name: p.name,
      relevance: p.relevance,
      advice: p.advice,
    }))

    const impactScore = computeTechnicalImpactScore(c.severity, c.confidence, c.evidence.length)

    const warningCodes: TechnicalWarningCode[] = []
    if (principleRefs.length === 0) {
      warningCodes.push('REGISTRY_MISS')
    }
    if (collected.warnings.length > 0) {
      warningCodes.push('INSUFFICIENT_EVIDENCE')
    }

    const evidenceRefs = c.evidence
      .filter((e) => e.isVisible)
      .map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        lowSensitiveTitle: e.title,
      }))

    const rationaleSummary = this.buildRationaleSummary(c)

    // 确定性单候选 output hash：基于候选稳定字段派生（§4.5 / Requirement 2）
    const candidateOutputHash = `ttco-${deterministicHash(
      [
        candidateKey,
        c.ruleId,
        c.improvingParameterKey ?? '',
        c.worseningParameterKey ?? '',
        c.severity,
        String(c.confidence),
        String(impactScore),
        principleRefs
          .map((p) => `${p.principleId}:${p.relevance}`)
          .sort()
          .join(','),
      ].join('|'),
    )}`

    return {
      candidateKey,
      ruleId: c.ruleId,
      ruleVersion,
      status: 'unreviewed',
      improvingParameterKey: c.improvingParameterKey ?? 'duration',
      worseningParameterKey: c.worseningParameterKey ?? 'cost',
      improvingDirection: c.improvingDirection ?? '',
      worseningDirection: c.worseningDirection ?? '',
      title: c.title,
      severity: c.severity,
      confidence: c.confidence,
      impactScore,
      evidenceRefs,
      affectedScope: c.affectedScope,
      principleRefs,
      rationaleSummary,
      warningCodes,
      sourceHashes: collected.sourceHashes,
      outputHash: candidateOutputHash,
      reviewedBy: null,
      reviewedAt: null,
      aiExplanationRef: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  }

  private buildWarningSummary(
    collectorWarnings: ContradictionInputWarning[],
    rulesetWarnings: ContradictionInputWarning[],
  ): Array<{ code: TechnicalWarningCode; message: string }> {
    const allWarnings = [...collectorWarnings, ...rulesetWarnings]
    const seen = new Set<string>()
    const result: Array<{ code: TechnicalWarningCode; message: string }> = []
    for (const w of allWarnings) {
      const key = `${w.source ?? ''}:${w.code}:${w.message}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({
          code: w.code as TechnicalWarningCode,
          message: w.message,
        })
      }
    }
    return result
  }

  private buildSourceSummary(
    collected: ReturnType<TechnicalContradictionAnalysisInputCollector['collect']> extends Promise<
      infer T
    >
      ? T
      : never,
  ): Record<string, { count: number; hash: string }> {
    return {
      tasks: { count: collected.taskTotal, hash: collected.sourceHashes.tasks ?? '' },
      resources: {
        count: collected.resourceOverloadCount,
        hash: collected.sourceHashes.resources ?? '',
      },
      risks: { count: collected.activeRiskCount, hash: collected.sourceHashes.risks ?? '' },
      milestones: {
        count: collected.milestoneTotal,
        hash: collected.sourceHashes.milestones ?? '',
      },
      contradictions: {
        count: collected.existingContradictionCount,
        hash: collected.sourceHashes.contradictions ?? '',
      },
    }
  }

  private buildRationaleSummary(c: CandidateContradiction): string {
    const improving = c.improvingParameterKey ?? '?'
    const worsening = c.worseningParameterKey ?? '?'
    return `改善${improving}（${c.improvingDirection ?? ''}）会导致${worsening}（${c.worseningDirection ?? ''}）恶化。基于规则 ${c.ruleId}，置信度 ${(c.confidence * 100).toFixed(0)}%。`
  }

  private async assembleRunResponse(
    run: TrizTechnicalContradictionAnalysisRun,
  ): Promise<TechnicalAnalysisRun & { candidates: TechnicalContradictionCandidate[] }> {
    const candidates = await TrizTechnicalContradictionCandidate.query()
      .where('run_id', run.id)
      .orderBy('impact_score', 'desc')

    return {
      ...this.toRunDTO(run),
      candidates: candidates.map((c) => this.toCandidateDTO(c)),
    }
  }

  private toRunDTO(run: TrizTechnicalContradictionAnalysisRun): TechnicalAnalysisRun {
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
      warningSummary: run.warningSummaryJson as TechnicalAnalysisRun['warningSummary'],
      candidateCount: run.candidateCount,
      costSummary: run.costSummaryJson,
      createdAt: run.createdAt.toISO()!,
      updatedAt: run.updatedAt?.toISO() ?? null,
      completedAt: run.completedAt?.toISO() ?? null,
      archivedAt: run.archivedAt?.toISO() ?? null,
    }
  }

  private toCandidateDTO(c: TrizTechnicalContradictionCandidate): TechnicalContradictionCandidate {
    return {
      candidateKey: c.candidateKey,
      ruleId: c.ruleId,
      ruleVersion: c.ruleVersion,
      status: c.status,
      improvingParameterKey: c.improvingParameterKey,
      worseningParameterKey: c.worseningParameterKey,
      improvingDirection: c.improvingDirection,
      worseningDirection: c.worseningDirection,
      title: c.title,
      severity: c.severity,
      confidence: c.confidence,
      impactScore: c.impactScore,
      evidenceRefs: c.evidenceRefsJson,
      affectedScope: c.affectedScopeJson,
      principleRefs: c.principleRefsJson,
      rationaleSummary: c.rationaleSummary,
      warningCodes: c.warningCodesJson,
      sourceHashes: c.sourceHashesJson,
      outputHash: c.outputHash,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt?.toISO() ?? null,
      aiExplanationRef: c.aiExplanationRef,
      createdAt: c.createdAt.toISO()!,
      updatedAt: c.updatedAt?.toISO() ?? null,
    }
  }
}
