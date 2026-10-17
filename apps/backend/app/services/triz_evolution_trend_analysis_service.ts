import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  EvolutionTrendRunStatus,
  TrendRiskStatus,
  EvolutionTrendAnalysisRun,
  EvolutionTrendScore,
  EvolutionTrendRiskCandidate,
  EvolutionTrendHistoryComparison,
  EvolutionTrendAiExplanation,
  EvolutionTrendHandoffPreview,
  EvolutionTrendAnalysisCost,
  ListEvolutionTrendAnalysesQuery,
  ListEvolutionTrendAnalysesResponse,
  ListEvolutionTrendScoresQuery,
  ListEvolutionTrendScoresResponse,
  ListEvolutionTrendRisksQuery,
  ListEvolutionTrendRisksResponse,
  CreateEvolutionTrendAnalysisRequest,
  ReviewEvolutionTrendRiskRequest,
  EvolutionTrendHistoryQuery,
} from '@aiproj/types'
import {
  computeEvolutionTrendInputSignature,
  computeEvolutionTrendIdempotencyKey,
  computeTrendScoresOutputHash,
  computeTrendRisksOutputHash,
  computeTrendDeltas,
  computeTrendRiskDeltaSummary,
  compareSourceHashes,
  compareTrendRiskCandidate,
  compareTrendScore,
  shouldSuppressForecast,
  isTrendRiskStale,
  EVOLUTION_TREND_SORT_FIELDS,
  EVOLUTION_TREND_RULESET_VERSION,
  EVOLUTION_TREND_TAXONOMY_VERSION,
} from '@aiproj/types'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import TrizEvolutionTrendInputCollector from './triz_evolution_trend_input_collector.js'
import TrizEvolutionTrendRuleEngine from './triz_evolution_trend_rule_engine.js'
import TrizEvolutionTrendAnalysisRunModel from '#models/triz_evolution_trend_analysis_run'
import TrizEvolutionTrendScoreModel from '#models/triz_evolution_trend_score'
import TrizEvolutionTrendRiskCandidateModel from '#models/triz_evolution_trend_risk_candidate'
import TrizEvolutionTrendHistorySnapshotModel from '#models/triz_evolution_trend_history_snapshot'
import { AuditEvent } from './audit_service.js'
import AuditService from './audit_service.js'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'

export interface EvolutionTrendExplanationProviderOutput {
  narrative: string
  referencedTrendKeys: string[]
  referencedRiskKeys: string[]
  provider?: string | null
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  latencyMs?: number | null
}

export interface EvolutionTrendExplanationProvider {
  generate(input: {
    promptSummary: string
    allowedSourceHashes: string[]
  }): Promise<EvolutionTrendExplanationProviderOutput | null>
}

const EVOLUTION_TREND_AI_ESTIMATED_COST_USD = 0.01

function evolutionTrendAiBudgetHardLimitUsd(): number {
  const raw = Number(process.env.AIPROJ_TRIZ_EVOLUTION_TREND_AI_BUDGET_USD ?? '1')
  return Number.isFinite(raw) ? raw : 1
}

@inject()
export default class TrizEvolutionTrendAnalysisService {
  constructor(
    private collector: TrizEvolutionTrendInputCollector,
    private ruleEngine: TrizEvolutionTrendRuleEngine,
    private auditService: AuditService,
  ) {}

  // ── createRun ──
  async createRun(
    orgId: number,
    projectId: number,
    actorId: number,
    req: CreateEvolutionTrendAnalysisRequest,
  ): Promise<{
    run: EvolutionTrendAnalysisRun
    trends: EvolutionTrendScore[]
    risks: EvolutionTrendRiskCandidate[]
  }> {
    const collected = await this.collector.collect({
      organizationId: orgId,
      projectId,
      actorId,
      scopeType: req.scopeType,
      userContext: req.userContext,
      manualTrendSignals: req.manualTrendSignals,
      idempotencyKey: req.idempotencyKey,
    })

    const inputSignature = computeEvolutionTrendInputSignature(collected)
    const idempotencyKey = computeEvolutionTrendIdempotencyKey(
      orgId,
      projectId,
      actorId,
      inputSignature,
      req.idempotencyKey,
    )

    const existing = await TrizEvolutionTrendAnalysisRunModel.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .orderBy('id', 'desc')
      .first()

    if (existing) {
      if (existing.inputSignature !== inputSignature) {
        await this.markRunStale(existing)
      } else {
        return this.loadRunResult(existing, orgId, projectId)
      }
    }

    const result = this.ruleEngine.evaluate(collected)
    const trendsHash = computeTrendScoresOutputHash(result.trends)
    const risksHash = computeTrendRisksOutputHash(result.risks)
    const outputHash = `${trendsHash}|${risksHash}`
    const status: EvolutionTrendRunStatus =
      collected.warnings.length > 0 ? 'completed_with_warnings' : 'completed'

    let run: TrizEvolutionTrendAnalysisRunModel
    await db.transaction(async (trx) => {
      run = await TrizEvolutionTrendAnalysisRunModel.create(
        {
          organizationId: orgId,
          projectId,
          actorId,
          status,
          scopeType: collected.scopeType,
          inputSignature,
          outputHash,
          ruleVersion: EVOLUTION_TREND_RULESET_VERSION,
          taxonomyVersion: EVOLUTION_TREND_TAXONOMY_VERSION,
          idempotencyKey,
          sourceSummaryJson: collected.sourceHashes
            ? Object.fromEntries(
                Object.entries(collected.sourceHashes).map(([k, v]) => [k, { count: 1, hash: v }]),
              )
            : {},
          warningSummaryJson: collected.warnings.map((w) => ({ code: w.code, message: w.message })),
          trendCount: result.trends.length,
          riskCount: result.risks.length,
          costSummaryJson: null,
          completedAt: DateTime.now(),
        },
        { client: trx as TransactionClientContract },
      )

      for (const t of result.trends) {
        await TrizEvolutionTrendScoreModel.create(
          {
            runId: run.id,
            organizationId: orgId,
            projectId,
            trendKey: t.trendKey,
            trendId: t.trendId,
            stage: t.stage,
            score: t.score,
            confidence: t.confidence,
            severity: t.severity,
            direction: t.direction,
            sourceRefsJson: t.sourceRefs,
            sourceHashesJson: t.sourceHashes,
            metricsJson: t.metrics,
            warningCodesJson: t.warningCodes,
          },
          { client: trx as TransactionClientContract },
        )
      }

      for (const r of result.risks) {
        await TrizEvolutionTrendRiskCandidateModel.create(
          {
            runId: run.id,
            organizationId: orgId,
            projectId,
            riskKey: r.riskKey,
            trendId: r.trendId,
            riskType: r.riskType,
            ruleId: r.ruleId,
            status: r.status,
            severity: r.severity,
            confidence: r.confidence,
            impactScore: r.impactScore,
            title: r.title,
            rationaleSummary: r.rationaleSummary,
            trendRefsJson: r.trendRefs,
            targetRefsJson: r.targetRefs,
            suggestedActionsJson: r.suggestedActions,
            sourceHashesJson: r.sourceHashes,
            warningCodesJson: r.warningCodes,
            aiExplanationRefJson: null,
            outputHash: r.outputHash,
            reviewedBy: null,
            reviewedAt: null,
          },
          { client: trx as TransactionClientContract },
        )
      }
    })

    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_ANALYSIS_RUN,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_analysis_run',
      entityId: run!.id,
      metadata: {
        trendCount: result.trends.length,
        riskCount: result.risks.length,
        status,
        outputHash,
      },
    })

    return this.loadRunResult(run!, orgId, projectId)
  }

  private async loadRunResult(
    run: TrizEvolutionTrendAnalysisRunModel,
    orgId: number,
    projectId: number,
  ): Promise<{
    run: EvolutionTrendAnalysisRun
    trends: EvolutionTrendScore[]
    risks: EvolutionTrendRiskCandidate[]
  }> {
    const trends = await TrizEvolutionTrendScoreModel.query()
      .where('run_id', run.id)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    const risks = await TrizEvolutionTrendRiskCandidateModel.query()
      .where('run_id', run.id)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    return {
      run: this.toRunDTO(run),
      trends: trends.map((t) => this.toTrendScoreDTO(t)).sort(compareTrendScore),
      risks: risks.map((r) => this.toRiskCandidateDTO(r)).sort(compareTrendRiskCandidate),
    }
  }

  // ── listRuns ──
  async listRuns(
    orgId: number,
    projectId: number,
    query: ListEvolutionTrendAnalysesQuery,
  ): Promise<ListEvolutionTrendAnalysesResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    // 解析排序：支持 `-field`（降序）/`+field`（升序）；字段须在白名单内，否则回退 createdAt desc。
    const sortRaw = (query.sort ?? '-createdAt').trim()
    const direction = sortRaw.startsWith('-') ? 'desc' : 'asc'
    const field = sortRaw
      .replace(/^[+-]/, '')
      .trim() as (typeof EVOLUTION_TREND_SORT_FIELDS)[number]
    const sortField = (EVOLUTION_TREND_SORT_FIELDS as readonly string[]).includes(field)
      ? field
      : 'createdAt'
    let q = TrizEvolutionTrendAnalysisRunModel.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .orderBy(sortField, direction)
    if (query.status) q = q.where('status', query.status)
    if (query.scopeType) q = q.where('scope_type', query.scopeType)
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
  ): Promise<EvolutionTrendAnalysisRun | null> {
    const run = await TrizEvolutionTrendAnalysisRunModel.query()
      .where('id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    return run ? this.toRunDTO(run) : null
  }

  // ── listTrends ──
  async listTrends(
    orgId: number,
    projectId: number,
    runId: number,
    query: ListEvolutionTrendScoresQuery,
  ): Promise<ListEvolutionTrendScoresResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 50
    let q = TrizEvolutionTrendScoreModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    if (query.trendId) q = q.where('trend_id', query.trendId)
    if (query.severity) q = q.where('severity', query.severity)
    const total = await q.clone().count('* as total')
    const totalCount = Number((total[0] as any).$extras?.total ?? (total[0] as any).total ?? 0)
    const rows = await q.offset((page - 1) * perPage).limit(perPage)
    return {
      data: rows.map((t) => this.toTrendScoreDTO(t)).sort(compareTrendScore),
      meta: { total: totalCount, page, perPage, totalPages: Math.ceil(totalCount / perPage) },
    }
  }

  // ── listRisks ──
  async listRisks(
    orgId: number,
    projectId: number,
    runId: number,
    query: ListEvolutionTrendRisksQuery,
  ): Promise<ListEvolutionTrendRisksResponse> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let q = TrizEvolutionTrendRiskCandidateModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    if (query.status) q = q.where('status', query.status)
    if (query.riskType) q = q.where('risk_type', query.riskType)
    if (query.trendId) q = q.where('trend_id', query.trendId)
    if (query.severity) q = q.where('severity', query.severity)
    if (query.stale !== undefined) {
      if (query.stale) q = q.where('status', 'blocked_stale')
      else q = q.whereNot('status', 'blocked_stale')
    }
    const total = await q.clone().count('* as total')
    const totalCount = Number((total[0] as any).$extras?.total ?? (total[0] as any).total ?? 0)
    const rows = await q.offset((page - 1) * perPage).limit(perPage)
    return {
      data: rows.map((r) => this.toRiskCandidateDTO(r)).sort(compareTrendRiskCandidate),
      meta: { total: totalCount, page, perPage, totalPages: Math.ceil(totalCount / perPage) },
    }
  }

  // ── getRisk ──
  async getRisk(
    orgId: number,
    projectId: number,
    runId: number,
    riskId: number,
  ): Promise<EvolutionTrendRiskCandidate | null> {
    const risk = await TrizEvolutionTrendRiskCandidateModel.query()
      .where('id', riskId)
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    return risk ? this.toRiskCandidateDTO(risk) : null
  }

  // ── reviewRisk ──
  async reviewRisk(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
    req: ReviewEvolutionTrendRiskRequest,
  ): Promise<EvolutionTrendRiskCandidate> {
    const risk = await TrizEvolutionTrendRiskCandidateModel.query()
      .where('id', riskId)
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')
    if (risk.status === 'blocked_stale')
      throw new ValidationException('风险候选来源已过期，请重新运行分析')
    const newStatus: TrendRiskStatus =
      req.action === 'mark_reviewed'
        ? 'reviewed'
        : req.action === 'mark_unreviewed'
          ? 'unreviewed'
          : 'dismissed'
    risk.status = newStatus
    risk.reviewedBy = actorId
    risk.reviewedAt = DateTime.now()
    await risk.save()
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_RISK_REVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: risk.id,
      metadata: { riskKey: risk.riskKey, status: newStatus },
    })
    return this.toRiskCandidateDTO(risk)
  }

  // ── historyComparison ──
  async historyComparison(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    query: EvolutionTrendHistoryQuery,
  ): Promise<EvolutionTrendHistoryComparison> {
    const run = await TrizEvolutionTrendAnalysisRunModel.query()
      .where('id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
      .first()
    if (!run) throw new ResourceNotFoundException('分析运行不存在')

    let baselineRun: TrizEvolutionTrendAnalysisRunModel | null = null
    if (query.baselineRunId) {
      baselineRun = await TrizEvolutionTrendAnalysisRunModel.query()
        .where('id', query.baselineRunId)
        .where('organization_id', orgId)
        .where('project_id', projectId)
        .first()
      if (!baselineRun) throw new ResourceNotFoundException('基线运行不存在')
    } else {
      baselineRun = await TrizEvolutionTrendAnalysisRunModel.query()
        .where('organization_id', orgId)
        .where('project_id', projectId)
        .where('id', '<', runId)
        .orderBy('id', 'desc')
        .first()
    }

    const currentTrends = await TrizEvolutionTrendScoreModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)
    const currentRisks = await TrizEvolutionTrendRiskCandidateModel.query()
      .where('run_id', runId)
      .where('organization_id', orgId)
      .where('project_id', projectId)

    const baselineTrends = baselineRun
      ? await TrizEvolutionTrendScoreModel.query()
          .where('run_id', baselineRun.id)
          .where('organization_id', orgId)
          .where('project_id', projectId)
      : []
    const baselineRisks = baselineRun
      ? await TrizEvolutionTrendRiskCandidateModel.query()
          .where('run_id', baselineRun.id)
          .where('organization_id', orgId)
          .where('project_id', projectId)
      : []

    const trendDeltas = computeTrendDeltas(
      currentTrends.map((t) => this.toTrendScoreDTO(t)),
      baselineTrends.map((t) => this.toTrendScoreDTO(t)),
    )
    const riskDeltaSummary = computeTrendRiskDeltaSummary(
      currentRisks.map((r) => this.toRiskCandidateDTO(r)),
      baselineRisks.map((r) => this.toRiskCandidateDTO(r)),
    )
    const hashComparison = compareSourceHashes(
      Object.fromEntries(Object.entries(run.sourceSummaryJson ?? {}).map(([k, v]) => [k, v.hash])),
      Object.fromEntries(
        Object.entries(baselineRun?.sourceSummaryJson ?? {}).map(([k, v]) => [k, v.hash]),
      ),
    )
    const stale = hashComparison.changed.length > 0 || hashComparison.removed.length > 0

    // 历史样本数：priorRunCount 记录在 collector 输出中；这里用 baseline 存在 + 1 当前 = 2 简化
    const availableSamples = baselineRun ? 2 : 1
    const forecastSuppressed = shouldSuppressForecast(availableSamples)
    const forecast = forecastSuppressed
      ? null
      : trendDeltas.map((d) => ({
          trendId: d.trendId,
          direction: d.direction,
          advisoryNote: `基于 ${availableSamples} 次样本的趋势方向提示（仅供参考，非预测事实）`,
        }))

    const snapshot = await TrizEvolutionTrendHistorySnapshotModel.create({
      runId: run.id,
      organizationId: orgId,
      projectId,
      baselineRunId: baselineRun?.id ?? null,
      comparisonMode: query.baselineRunId ? 'explicit_baseline' : 'latest_prior',
      trendDeltaJson: trendDeltas,
      riskDeltaJson: riskDeltaSummary,
      sourceHashesJson: hashComparison,
    })

    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_HISTORY_READ,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_history_snapshot',
      entityId: snapshot.id,
      metadata: { baselineRunId: baselineRun?.id ?? null, trendCount: trendDeltas.length },
    })

    const warningCodes: EvolutionTrendScore['warningCodes'] = []
    if (forecastSuppressed) warningCodes.push('INSUFFICIENT_HISTORY', 'FORECAST_SUPPRESSED')

    return {
      runId,
      baselineRunId: baselineRun?.id ?? null,
      comparisonMode: query.baselineRunId ? 'explicit_baseline' : 'latest_prior',
      scopeType: run.scopeType as any,
      trendDeltas,
      riskDeltaSummary,
      sourceHashComparison: hashComparison,
      warningChanges: { added: [], removed: [] },
      stale,
      forecastSuppressed,
      forecast,
      warningCodes,
      createdAt: new Date().toISOString(),
    }
  }

  // ── explainRisk ──
  async explainRisk(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
  ): Promise<{ riskKey: string; explanation: EvolutionTrendAiExplanation }> {
    const risk = await this.getRisk(orgId, projectId, runId, riskId)
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')

    const provider = this.explanationProvider
    if (!provider) {
      return {
        riskKey: risk.riskKey,
        explanation: await this.fallbackExplanation(
          risk,
          orgId,
          projectId,
          actorId,
          riskId,
          '默认不使用真实模型',
        ),
      }
    }

    if (EVOLUTION_TREND_AI_ESTIMATED_COST_USD > evolutionTrendAiBudgetHardLimitUsd()) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_AI_EXPLANATION_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_evolution_trend_risk_candidate',
        entityId: riskId,
        metadata: { riskKey: risk.riskKey, reason: 'budget_hard_blocked' },
      })
      return {
        riskKey: risk.riskKey,
        explanation: await this.fallbackExplanation(
          risk,
          orgId,
          projectId,
          actorId,
          riskId,
          'AI 预算硬上限已触发',
        ),
      }
    }

    const allowedHashes = Object.values(risk.sourceHashes)
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_AI_EXPLANATION_ATTEMPT,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey },
    })

    let output: EvolutionTrendExplanationProviderOutput | null = null
    try {
      output = await provider.generate({
        promptSummary: this.buildLowSensitivityPrompt(risk),
        allowedSourceHashes: allowedHashes,
      })
    } catch {
      output = null
    }

    if (!output || typeof output.narrative !== 'string' || output.narrative.trim().length === 0) {
      return {
        riskKey: risk.riskKey,
        explanation: await this.fallbackExplanation(
          risk,
          orgId,
          projectId,
          actorId,
          riskId,
          '模型输出不符合结构化契约',
        ),
      }
    }

    // 反幻觉：AI 引用的 riskKey 必须只包含当前候选 riskKey；引用的 trendKey 必须来自本候选关联趋势。
    const allowedTrendKeys = new Set(risk.trendRefs)
    const unauthorizedRiskRefs = output.referencedRiskKeys.filter((k) => k !== risk.riskKey)
    const unauthorizedTrendRefs = output.referencedTrendKeys.filter((k) => !allowedTrendKeys.has(k))
    if (unauthorizedRiskRefs.length > 0 || unauthorizedTrendRefs.length > 0) {
      return {
        riskKey: risk.riskKey,
        explanation: await this.fallbackExplanation(
          risk,
          orgId,
          projectId,
          actorId,
          riskId,
          '模型引用了未授权来源',
        ),
      }
    }

    // 反幻觉：AI 不得新增外部事实（GitHub/GitLab、云服务商、合作伙伴、财务、市场等未授权信号）。
    const externalFactPatterns =
      /(github\.com|gitlab\.com|aws|azure|gcp|合作伙伴|供应商报价|市场份额|营收|财务报表|cloudflare|datadog|sentry)/i
    if (externalFactPatterns.test(output.narrative)) {
      return {
        riskKey: risk.riskKey,
        explanation: await this.fallbackExplanation(
          risk,
          orgId,
          projectId,
          actorId,
          riskId,
          '模型输出包含未授权外部事实',
        ),
      }
    }

    const cost: EvolutionTrendAnalysisCost = {
      provider: output.provider ?? null,
      model: output.model ?? null,
      promptTokens: output.promptTokens ?? null,
      completionTokens: output.completionTokens ?? null,
      estimatedCost: EVOLUTION_TREND_AI_ESTIMATED_COST_USD,
      latencyMs: output.latencyMs ?? null,
    }

    return {
      riskKey: risk.riskKey,
      explanation: {
        narrative: output.narrative,
        isFallback: false,
        hallucinationChecked: true,
        degradedReason: null,
        referencedTrendKeys: output.referencedTrendKeys,
        referencedRiskKeys: output.referencedRiskKeys,
        confidence: risk.confidence,
        provider: cost.provider,
        model: cost.model,
        cost,
      },
    }
  }

  private explanationProvider: EvolutionTrendExplanationProvider | null = null
  setExplanationProvider(provider: EvolutionTrendExplanationProvider | null): void {
    this.explanationProvider = provider
  }

  private async fallbackExplanation(
    risk: EvolutionTrendRiskCandidate,
    orgId: number,
    projectId: number,
    actorId: number,
    riskId: number,
    degradedReason: string,
  ): Promise<EvolutionTrendAiExplanation> {
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_AI_EXPLANATION_FALLBACK,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey, isFallback: true, degradedReason },
    })
    return {
      narrative: this.buildFallbackNarrative(risk),
      isFallback: true,
      hallucinationChecked: true,
      degradedReason,
      referencedTrendKeys: risk.trendRefs,
      referencedRiskKeys: [risk.riskKey],
      confidence: risk.confidence,
      provider: null,
      model: null,
      cost: null,
    }
  }

  private buildLowSensitivityPrompt(risk: EvolutionTrendRiskCandidate): string {
    return [
      `风险类型：${risk.riskType}`,
      `严重度：${risk.severity}`,
      `置信度：${risk.confidence}`,
      `理由摘要：${risk.rationaleSummary}`,
    ].join('\n')
  }

  // ── previews ──
  private checkStale(
    risk: EvolutionTrendRiskCandidate,
    currentSourceHashes?: Record<string, string>,
  ): boolean {
    if (risk.status === 'blocked_stale') return true
    if (currentSourceHashes) return isTrendRiskStale(risk.sourceHashes, currentSourceHashes)
    return false
  }

  async workbenchPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
    currentSourceHashes?: Record<string, string>,
  ): Promise<EvolutionTrendHandoffPreview> {
    const risk = await this.getRisk(orgId, projectId, runId, riskId)
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')
    if (this.checkStale(risk, currentSourceHashes)) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_evolution_trend_risk_candidate',
        entityId: riskId,
        metadata: { riskKey: risk.riskKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_WORKBENCH_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey },
    })
    return this.buildHandoffPreview(
      risk,
      runId,
      actorId,
      orgId,
      projectId,
      'workbench',
      currentSourceHashes,
    )
  }

  async decisionPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
    currentSourceHashes?: Record<string, string>,
  ): Promise<EvolutionTrendHandoffPreview> {
    const risk = await this.getRisk(orgId, projectId, runId, riskId)
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')
    if (this.checkStale(risk, currentSourceHashes)) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_evolution_trend_risk_candidate',
        entityId: riskId,
        metadata: { riskKey: risk.riskKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_DECISION_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey },
    })
    return this.buildHandoffPreview(
      risk,
      runId,
      actorId,
      orgId,
      projectId,
      'decision_log',
      currentSourceHashes,
    )
  }

  async draftPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
    currentSourceHashes?: Record<string, string>,
  ): Promise<EvolutionTrendHandoffPreview> {
    const risk = await this.getRisk(orgId, projectId, runId, riskId)
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')
    if (this.checkStale(risk, currentSourceHashes)) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_evolution_trend_risk_candidate',
        entityId: riskId,
        metadata: { riskKey: risk.riskKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_DRAFT_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey },
    })
    return this.buildHandoffPreview(
      risk,
      runId,
      actorId,
      orgId,
      projectId,
      'draft_layer',
      currentSourceHashes,
    )
  }

  async riskPreview(
    orgId: number,
    projectId: number,
    actorId: number,
    runId: number,
    riskId: number,
    currentSourceHashes?: Record<string, string>,
  ): Promise<EvolutionTrendHandoffPreview> {
    const risk = await this.getRisk(orgId, projectId, runId, riskId)
    if (!risk) throw new ResourceNotFoundException('风险候选不存在')
    if (this.checkStale(risk, currentSourceHashes)) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_STALE_BLOCKED,
        userId: actorId,
        organizationId: orgId,
        projectId,
        entityType: 'triz_evolution_trend_risk_candidate',
        entityId: riskId,
        metadata: { riskKey: risk.riskKey },
      })
      throw new ValidationException('来源已过期，请重新运行分析')
    }
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_RISK_PREVIEW,
      userId: actorId,
      organizationId: orgId,
      projectId,
      entityType: 'triz_evolution_trend_risk_candidate',
      entityId: riskId,
      metadata: { riskKey: risk.riskKey },
    })
    return this.buildHandoffPreview(
      risk,
      runId,
      actorId,
      orgId,
      projectId,
      'risk_preview',
      currentSourceHashes,
    )
  }

  private buildHandoffPreview(
    risk: EvolutionTrendRiskCandidate,
    runId: number,
    actorId: number,
    orgId: number,
    projectId: number,
    targetType: EvolutionTrendHandoffPreview['targetType'],
    currentSourceHashes?: Record<string, string>,
  ): EvolutionTrendHandoffPreview {
    const stale = currentSourceHashes
      ? isTrendRiskStale(risk.sourceHashes, currentSourceHashes)
      : false
    return {
      runId,
      riskKey: risk.riskKey,
      riskType: risk.riskType,
      targetType,
      candidateInput: {
        title: risk.title,
        rationaleSummary: risk.rationaleSummary,
        trendRefs: risk.trendRefs,
        suggestedActions: risk.suggestedActions,
      },
      trendRefs: risk.trendRefs,
      sourceHashes: risk.sourceHashes,
      warnings: risk.warningCodes,
      actorId,
      organizationId: orgId,
      projectId,
      idempotencyKey: risk.riskKey,
      stale,
      blockingWarnings: stale ? ['HANDOFF_BLOCKED_STALE'] : [],
      requiresUserConfirmation: true,
    }
  }

  // ── helpers ──
  private async markRunStale(run: TrizEvolutionTrendAnalysisRunModel): Promise<void> {
    run.status = 'stale'
    await run.save()
    await TrizEvolutionTrendRiskCandidateModel.query()
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })
  }

  private buildFallbackNarrative(risk: EvolutionTrendRiskCandidate): string {
    return `【${risk.title}】${risk.rationaleSummary}\n\n建议操作：${risk.suggestedActions.join('、')}。\n（本说明为确定性生成，仅供参考，不自动执行。）`
  }

  // ── DTOs ──
  private toRunDTO(m: TrizEvolutionTrendAnalysisRunModel): EvolutionTrendAnalysisRun {
    return {
      id: m.id,
      organizationId: m.organizationId,
      projectId: m.projectId,
      actorId: m.actorId,
      status: m.status as EvolutionTrendRunStatus,
      scopeType: m.scopeType as any,
      inputSignature: m.inputSignature,
      outputHash: m.outputHash ?? '',
      ruleVersion: m.ruleVersion,
      taxonomyVersion: m.taxonomyVersion,
      idempotencyKey: m.idempotencyKey,
      sourceSummary: m.sourceSummaryJson ?? {},
      warningSummary: (m.warningSummaryJson ?? []) as any,
      trendCount: m.trendCount,
      riskCount: m.riskCount,
      costSummary: m.costSummaryJson as EvolutionTrendAnalysisCost | null,
      createdAt: m.createdAt?.toISO() ?? '',
      updatedAt: m.updatedAt?.toISO() ?? null,
      completedAt: m.completedAt?.toISO() ?? null,
      archivedAt: m.archivedAt?.toISO() ?? null,
    }
  }

  private toTrendScoreDTO(m: TrizEvolutionTrendScoreModel): EvolutionTrendScore {
    return {
      id: m.id,
      trendKey: m.trendKey,
      trendId: m.trendId as any,
      stage: m.stage as any,
      score: m.score,
      confidence: m.confidence,
      severity: m.severity as any,
      direction: m.direction as any,
      sourceRefs: (m.sourceRefsJson ?? []) as any,
      sourceHashes: (m.sourceHashesJson ?? {}) as any,
      metrics: (m.metricsJson ?? {}) as any,
      warningCodes: (m.warningCodesJson ?? []) as any,
      createdAt: m.createdAt?.toISO() ?? '',
      updatedAt: m.updatedAt?.toISO() ?? null,
    }
  }

  private toRiskCandidateDTO(m: TrizEvolutionTrendRiskCandidateModel): EvolutionTrendRiskCandidate {
    return {
      id: m.id,
      riskKey: m.riskKey,
      riskType: m.riskType as any,
      trendId: m.trendId as any,
      ruleId: m.ruleId,
      status: m.status as TrendRiskStatus,
      severity: m.severity as any,
      confidence: m.confidence,
      impactScore: m.impactScore,
      title: m.title,
      rationaleSummary: m.rationaleSummary,
      trendRefs: (m.trendRefsJson ?? []) as string[],
      targetRefs: (m.targetRefsJson ?? []) as any,
      suggestedActions: (m.suggestedActionsJson ?? []) as string[],
      sourceHashes: (m.sourceHashesJson ?? {}) as any,
      warningCodes: (m.warningCodesJson ?? []) as any,
      aiExplanationRef: null,
      reviewedBy: m.reviewedBy,
      reviewedAt: m.reviewedAt?.toISO() ?? null,
      outputHash: m.outputHash,
      createdAt: m.createdAt?.toISO() ?? '',
      updatedAt: m.updatedAt?.toISO() ?? null,
    }
  }
}
