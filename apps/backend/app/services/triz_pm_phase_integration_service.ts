import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  PhaseIntegrationRun,
  PhaseIntegrationRunListItem,
  PhaseSnapshot,
  PhaseAiExplanation,
  PhaseHandoffPreview,
  PhaseHandoffTarget,
  PhaseReviewMetadata,
  PmSourceRef,
} from '@aiproj/types'
import {
  generatePhaseRunId,
  computePhaseRunIdempotencyKey,
  computePhaseRunOutputHash,
  computePhaseHandoffIdempotencyKey,
  isPhaseStale,
  sortPhaseWarningsBySeverity,
  simpleHash8,
} from '@aiproj/types'
import TrizPmPhaseInputCollector from './triz_pm_phase_input_collector.js'
import TrizPmPhaseMappingRuleEngine from './triz_pm_phase_mapping_rule_engine.js'
import AuditService, { AuditEvent, type AuditEventType } from './audit_service.js'
import TrizPmPhaseIntegrationRun from '#models/triz_pm_phase_integration_run'
import TrizPmPhaseSnapshot from '#models/triz_pm_phase_snapshot'
import TrizPmPhaseAction from '#models/triz_pm_phase_action'

/**
 * TRIZ-PM 阶段整合服务（v3-triz-pm-phase-integration §4.11–§4.14）。
 *
 * 编排 createRun/listRuns/getRun/listPhases/getPhase/reviewPhase
 * 流。短事务持久化、幂等、stale 检测、AI 可选说明、handoff preview。
 */
@inject()
export default class TrizPmPhaseIntegrationService {
  constructor(
    private collector: TrizPmPhaseInputCollector,
    private ruleEngine: TrizPmPhaseMappingRuleEngine,
    private auditService: AuditService,
  ) {}

  // ── Create Run ──────────────────────────────────────────────────────────

  async createRun(
    organizationId: number,
    projectId: number,
    actorId: number,
    userNotes?: string,
  ): Promise<{ run: PhaseIntegrationRun; isIdempotent: boolean }> {
    // 1. 收集输入
    const input = await this.collector.collect(organizationId, projectId, actorId, userNotes)

    const idempotencyKey = computePhaseRunIdempotencyKey(
      projectId,
      JSON.stringify(input.sourceHashes),
    )

    // 2. 幂等检查
    const existing = await TrizPmPhaseIntegrationRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .where('status', 'completed')
      .preload('snapshots')
      .first()

    if (existing) {
      const run = this.toRunDTO(existing)
      return { run, isIdempotent: true }
    }

    // 3. 映射阶段快照
    const runId = generatePhaseRunId(projectId)
    const snapshots = this.ruleEngine.mapToPhaseSnapshots(input, runId)
    const outputHash = computePhaseRunOutputHash(snapshots)
    const warningSummary = sortPhaseWarningsBySeverity(input.warnings)

    const blockedCount = snapshots.filter((s) => s.readiness === 'blocked_stale').length
    const staleCount = snapshots.filter((s) => s.stale).length
    // run 表的 source_summary_json 按「来源种类」聚合（与 function/technical 分析域口径一致），
    // 收集器给出的是 `kind:id → hash` 明细，这里按 kind 归并成 { count, hash }
    const sourceSummary = buildSourceSummary(input.sourceRefs)

    // 4. 短事务持久化
    const trx = await db.transaction()
    try {
      const run = await TrizPmPhaseIntegrationRun.create(
        {
          organizationId,
          projectId,
          actorId,
          status: 'completed',
          inputSignature: idempotencyKey,
          outputHash,
          idempotencyKey,
          sourceSummaryJson: sourceSummary,
          warningSummaryJson: warningSummary,
          costSummaryJson: null,
          phaseCount: snapshots.length,
          blockedPhaseCount: blockedCount,
          stalePhaseCount: staleCount,
          completedAt: DateTime.now(),
        },
        { client: trx },
      )

      // 持久化阶段快照
      for (const snap of snapshots) {
        await TrizPmPhaseSnapshot.create(
          {
            runId: run.id,
            organizationId,
            projectId,
            snapshotId: snap.snapshotId,
            phaseId: snap.phaseId,
            phaseLabel: snap.phaseLabel,
            sourceRefsJson: snap.sourceRefs,
            sourceHashesJson: snap.sourceHashes,
            gapsJson: snap.gaps,
            recommendationsJson: snap.recommendations,
            warningsJson: snap.warnings,
            readiness: snap.readiness,
            stale: snap.stale,
            methodologyHint: snap.methodologyHint ?? null,
          },
          { client: trx },
        )
      }

      await trx.commit()

      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_RUN,
        userId: actorId,
        organizationId,
        projectId,
        entityType: 'triz_pm_phase_integration_run',
        entityId: run.id,
        metadata: { phaseCount: snapshots.length, warningCodes: warningSummary.map((w) => w.code) },
      })

      // 重新加在关系用于 DTO
      const saved = await TrizPmPhaseIntegrationRun.query()
        .where('id', run.id)
        .preload('snapshots')
        .firstOrFail()

      return { run: this.toRunDTO(saved), isIdempotent: false }
    } catch (err) {
      await trx.rollback()
      throw err
    }
  }

  // ── List Runs ───────────────────────────────────────────────────────────

  async listRuns(
    organizationId: number,
    projectId: number,
    page: number = 1,
    perPage: number = 20,
    sort: string = '-created_at',
    statusFilter?: string,
  ): Promise<{
    data: PhaseIntegrationRunListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    let query = TrizPmPhaseIntegrationRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (statusFilter) {
      query = query.where('status', statusFilter)
    }

    // 排序
    const direction = sort.startsWith('-') ? 'desc' : 'asc'
    const field = sort.startsWith('-') || sort.startsWith('+') ? sort.slice(1) : sort
    const allowedSortFields = [
      'created_at',
      'updated_at',
      'phase_count',
      'blocked_phase_count',
      'stale_phase_count',
    ]
    if (allowedSortFields.includes(field)) {
      query = query.orderBy(field, direction)
    } else {
      query = query.orderBy('created_at', 'desc')
    }

    const result = await query.paginate(page, perPage)

    return {
      data: result.all().map((r) => ({
        runId: String(r.id),
        status: r.status,
        phaseIds: ['initiation', 'planning', 'execution', 'monitoring', 'change_control'] as any[],
        warningCount: r.warningSummaryJson?.length ?? 0,
        blockedPhaseCount: r.blockedPhaseCount,
        stalePhaseCount: r.stalePhaseCount,
        costSummary: r.costSummaryJson ?? undefined,
        createdAt: r.createdAt?.toISO() ?? '',
        updatedAt: r.updatedAt?.toISO() ?? '',
      })),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ── Get Run Detail ──────────────────────────────────────────────────────

  async getRun(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<PhaseIntegrationRun | null> {
    const run = await TrizPmPhaseIntegrationRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('snapshots')
      .first()

    if (!run) return null

    await this.auditService.log({
      event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_READ,
      userId: run.actorId,
      organizationId,
      projectId,
      entityType: 'triz_pm_phase_integration_run',
      entityId: run.id,
      metadata: { phaseCount: run.phaseCount },
    })

    return this.toRunDTO(run)
  }

  // ── List Phases ─────────────────────────────────────────────────────────

  async listPhases(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<PhaseSnapshot[]> {
    const snapshots = await TrizPmPhaseSnapshot.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('phase_id')

    return snapshots.map((s) => this.toSnapshotDTO(s))
  }

  // ── Get Phase Detail ────────────────────────────────────────────────────

  async getPhase(
    organizationId: number,
    projectId: number,
    runId: number,
    phaseId: string,
  ): Promise<PhaseSnapshot | null> {
    const snapshot = await TrizPmPhaseSnapshot.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('phase_id', phaseId)
      .first()

    if (!snapshot) return null

    await this.auditService.log({
      event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_PHASE_READ,
      userId: 0,
      organizationId,
      projectId,
      entityType: 'triz_pm_phase_snapshot',
      entityId: snapshot.id,
      metadata: { phaseId, readiness: snapshot.readiness },
    })

    return this.toSnapshotDTO(snapshot)
  }

  // ── Review Phase ────────────────────────────────────────────────────────

  async reviewPhase(
    organizationId: number,
    projectId: number,
    actorId: number,
    runId: number,
    phaseId: string,
    reviewNotes?: string,
  ): Promise<PhaseSnapshot> {
    const snapshot = await TrizPmPhaseSnapshot.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('phase_id', phaseId)
      .firstOrFail()

    const reviewMeta: PhaseReviewMetadata = {
      reviewed: true,
      reviewedBy: actorId,
      reviewedAt: new Date().toISOString(),
      reviewNotes: reviewNotes ?? '',
    }

    snapshot.reviewMetadataJson = reviewMeta
    await snapshot.save()

    await this.auditService.log({
      event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_REVIEW,
      userId: actorId,
      organizationId,
      projectId,
      entityType: 'triz_pm_phase_snapshot',
      entityId: snapshot.id,
      metadata: { phaseId, action: 'review' },
    })

    return this.toSnapshotDTO(snapshot)
  }

  // ── AI Explain Phase ────────────────────────────────────────────────────

  async explainPhase(
    organizationId: number,
    projectId: number,
    actorId: number,
    runId: number,
    phaseId: string,
    aiProvider?: {
      generate: (prompt: string) => Promise<{
        text: string
        cost: {
          totalTokens?: number
          totalCalls?: number
          totalLatencyMs?: number
          providerId?: string
          modelId?: string
        }
      }>
    },
  ): Promise<PhaseAiExplanation> {
    const snapshot = await this.getPhase(organizationId, projectId, runId, phaseId)
    if (!snapshot) throw new Error('Phase not found')

    // Default: deterministic fallback
    if (!aiProvider) {
      const fallbackExplanation = generateDeterministicExplanation(snapshot)
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_AI_EXPLANATION_FALLBACK,
        userId: actorId,
        organizationId,
        projectId,
        entityType: 'triz_pm_phase_snapshot',
        entityId: 0,
        metadata: { phaseId, reason: 'no_provider' },
      })
      return fallbackExplanation
    }

    try {
      // Build low-sensitivity context packet
      const contextPacket = buildContextPacket(snapshot)
      const result = await aiProvider.generate(contextPacket)

      // Anti-hallucination: validate output references only existing refs
      const validRefIds = new Set(snapshot.sourceRefs.map((r) => r.sourceId))
      const hallucinationRefs = extractExternalRefs(result.text)
      const invalidRefs = hallucinationRefs.filter((r) => !validRefIds.has(r))

      if (invalidRefs.length > 0) {
        // Fallback on hallucination detected
        await this.auditService.log({
          event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_AI_EXPLANATION_FALLBACK,
          userId: actorId,
          organizationId,
          projectId,
          entityType: 'triz_pm_phase_snapshot',
          entityId: 0,
          metadata: { phaseId, reason: 'anti_hallucination', invalidRefs },
        })
        return {
          ...generateDeterministicExplanation(snapshot),
          degradedReason: `反幻觉校验失败: 检测到 ${invalidRefs.length} 条未授权引用`,
        }
      }

      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_AI_EXPLANATION_ATTEMPT,
        userId: actorId,
        organizationId,
        projectId,
        entityType: 'triz_pm_phase_snapshot',
        entityId: 0,
        metadata: { phaseId, costRefs: result.cost },
      })

      return {
        text: result.text,
        isFallback: false,
        sourceRefs: snapshot.sourceRefs.slice(0, 5),
        costSummary: {
          isFallback: false,
          ...result.cost,
        },
      }
    } catch {
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_AI_EXPLANATION_BLOCKED,
        userId: actorId,
        organizationId,
        projectId,
        entityType: 'triz_pm_phase_snapshot',
        entityId: 0,
        metadata: { phaseId, reason: 'ai_error' },
      })
      return {
        ...generateDeterministicExplanation(snapshot),
        degradedReason: 'AI 服务不可用，使用确定性说明',
      }
    }
  }

  // ── Handoff Preview ──────────────────────────────────────────────────────

  async handoffPreview(
    organizationId: number,
    projectId: number,
    actorId: number,
    runId: number,
    phaseId: string,
    recommendationId: string,
    target: PhaseHandoffTarget,
  ): Promise<PhaseHandoffPreview> {
    const snapshot = await TrizPmPhaseSnapshot.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('phase_id', phaseId)
      .firstOrFail()

    const rec = (snapshot.recommendationsJson ?? []).find(
      (r) => r.recommendationId === recommendationId,
    )
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`)

    // Stale check: re-compute current source hashes vs snapshot
    const currentInput = await this.collector.collect(organizationId, projectId, actorId)
    const phaseSources = currentInput.sourceRefs.filter((r) =>
      snapshot.sourceRefsJson.some((sr) => sr.sourceId === r.sourceId),
    )
    const currentHashes: Record<string, string> = {}
    for (const ref of phaseSources) {
      currentHashes[ref.sourceKind + ':' + ref.sourceId] = ref.sourceHash
    }
    const isStale = isPhaseStale(currentHashes, snapshot.sourceHashesJson)

    if (isStale) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_STALE_BLOCKED,
        userId: actorId,
        organizationId,
        projectId,
        entityType: 'triz_pm_phase_snapshot',
        entityId: snapshot.id,
        metadata: { phaseId, target },
      })
      throw Object.assign(new Error('Handoff blocked: source data is stale'), {
        code: 'STALE_BLOCKED',
      })
    }

    // Record handoff action with idempotency
    const idempotencyKey = computePhaseHandoffIdempotencyKey(
      String(runId),
      phaseId as any,
      recommendationId,
      target,
    )

    const existing = await TrizPmPhaseAction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .first()

    if (!existing) {
      await TrizPmPhaseAction.create({
        runId,
        organizationId,
        projectId,
        actorId,
        phaseId: phaseId as any,
        recommendationId,
        actionKind: rec.actionKind as any,
        handoffTarget: target,
        idempotencyKey,
        status: 'handoff_initiated',
        sourceHashesJson: currentHashes,
      })
    }

    // 用 PhaseHandoffTarget 做键：新增 target 时缺映射会在编译期暴露，不必靠运行时兜底
    const auditEventMap: Record<PhaseHandoffTarget, AuditEventType> = {
      workbench: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_WORKBENCH_PREVIEW,
      decision_center: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_DECISION_PREVIEW,
      draft_layer: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_DRAFT_PREVIEW,
      clarification: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_CLARIFICATION_PREVIEW,
      risk_review: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_RISK_PREVIEW,
      change_review: AuditEvent.TRIZ_PM_PHASE_INTEGRATION_CHANGE_PREVIEW,
    }

    await this.auditService.log({
      event: auditEventMap[target],
      userId: actorId,
      organizationId,
      projectId,
      entityType: 'triz_pm_phase_snapshot',
      entityId: snapshot.id,
      metadata: { phaseId, target, recommendationId },
    })

    return {
      previewId: `preview_${idempotencyKey}`,
      target,
      runId: String(runId),
      phaseId: phaseId as any,
      recommendationId,
      sourceRefs: rec.sourceRefs ?? [],
      sourceHashes: currentHashes,
      warnings:
        rec.sourceRefs?.length === 0
          ? [
              {
                code: 'MISSING_CRITICAL_CATEGORY' as any,
                message: '无关联来源',
                severity: 'medium',
              },
            ]
          : [],
      actorId,
      organizationId,
      projectId,
      idempotencyKey,
      previewOnly: true,
      requiresUserConfirmation: true,
    }
  }

  // ── DTO Helpers ─────────────────────────────────────────────────────────

  private toRunDTO(run: TrizPmPhaseIntegrationRun): PhaseIntegrationRun {
    return {
      runId: String(run.id),
      projectId: run.projectId,
      organizationId: run.organizationId,
      actorId: run.actorId,
      status: run.status,
      inputSignature: run.inputSignature,
      outputHash: run.outputHash ?? '',
      phases: (run.snapshots ?? []).map((s) => this.toSnapshotDTO(s)),
      warningSummary: run.warningSummaryJson ?? [],
      costSummary: run.costSummaryJson ?? undefined,
      createdAt: run.createdAt?.toISO() ?? '',
      updatedAt: run.updatedAt?.toISO() ?? '',
    }
  }

  private toSnapshotDTO(s: TrizPmPhaseSnapshot): PhaseSnapshot {
    return {
      snapshotId: s.snapshotId,
      runId: String(s.runId),
      phaseId: s.phaseId,
      phaseLabel: s.phaseLabel,
      sourceRefs: s.sourceRefsJson ?? [],
      sourceHashes: s.sourceHashesJson ?? {},
      readiness: s.readiness,
      gaps: s.gapsJson ?? [],
      recommendations: s.recommendationsJson ?? [],
      warnings: s.warningsJson ?? [],
      stale: s.stale,
      reviewMetadata: s.reviewMetadataJson ?? undefined,
      methodologyHint: s.methodologyHint ?? undefined,
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * 把来源明细按 sourceKind 归并成 run 表的低敏摘要：
 * count = 该种类的来源条数，hash = 该种类下所有来源哈希（排序后）的确定性摘要。
 */
function buildSourceSummary(
  sourceRefs: PmSourceRef[],
): Record<string, { count: number; hash: string }> {
  const grouped = new Map<string, string[]>()
  for (const ref of sourceRefs) {
    const bucket = grouped.get(ref.sourceKind)
    if (bucket) bucket.push(ref.sourceHash)
    else grouped.set(ref.sourceKind, [ref.sourceHash])
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([kind, hashes]) => [
      kind,
      { count: hashes.length, hash: simpleHash8([...hashes].sort().join('|')) },
    ]),
  )
}

function generateDeterministicExplanation(snapshot: PhaseSnapshot): PhaseAiExplanation {
  const phaseName = snapshot.phaseLabel
  const readinessLabel = snapshot.readiness
  const recCount = snapshot.recommendations.length
  const gapCount = snapshot.gaps.length
  const warnCount = snapshot.warnings.length

  const warnSuffix = warnCount > 0 ? `，另有 ${warnCount} 条告警需关注` : ''
  const text = `${phaseName}阶段审查摘要：当前就绪状态为「${readinessLabel}」，共识别 ${recCount} 条推荐动作和 ${gapCount} 个数据缺口${warnSuffix}。待人工审查确认本阶段是否满足推进条件。`

  return {
    text,
    isFallback: true,
    degradedReason: '确定性默认说明，非 AI 生成',
    sourceRefs: snapshot.sourceRefs.slice(0, 3),
    costSummary: { isFallback: true },
  }
}

function buildContextPacket(snapshot: PhaseSnapshot): string {
  const lines: string[] = []
  lines.push(`阶段: ${snapshot.phaseLabel} (${snapshot.phaseId})`)
  lines.push(`就绪状态: ${snapshot.readiness}`)
  lines.push(`来源数量: ${snapshot.sourceRefs.length}`)
  lines.push(`缺口数量: ${snapshot.gaps.length}`)
  for (const gap of snapshot.gaps) {
    lines.push(`  - ${gap.description}`)
  }
  lines.push(`推荐动作: ${snapshot.recommendations.length}`)
  for (const rec of snapshot.recommendations) {
    lines.push(`  - ${rec.title}`)
  }
  return lines.join('\n')
}

function extractExternalRefs(text: string): string[] {
  // Simple extraction: look for patterns that look like IDs not in our system
  const patterns = text.match(/[a-zA-Z0-9_]+-\d+/g) ?? []
  return [...new Set(patterns)]
}
