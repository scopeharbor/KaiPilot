/**
 * v3-triz-ifr-visualization —— IFR 可视化服务（tasks 3.4-3.6 P0）。
 *
 * - buildPreview: 在数据库事务外构建只读预览（无副作用）
 * - save: 显式保存审查会话（需确认元数据）
 * - checkFreshness: 比较当前来源 hash 与存储 hash
 */

import type {
  IfrPreview,
  IfrSavedReview,
  IfrStage,
  IfrSourceRef,
  IfrWarningCode,
  IfrFreshnessResult,
  IdealityScoreOutput,
  IfrTrendSummary,
  IfrReviewStatus,
  IfrSourceKind,
} from '@aiproj/types'
import {
  computeIdealityScore,
  computeIfrTrendSummary,
  computeIfrStageHash,
  isIfrSourceStale,
  aggregateIfrWarnings,
  rankIfrStages,
  simpleHash,
  IFR_SCHEMA_VERSION,
  IFR_SCORE_VERSION,
} from '@aiproj/types'
import TrizIfrReviewSession, { TrizIfrStageSnapshot } from '#models/triz_ifr_review_session'
import { IfrSourceCollector, type IfrCollectedSources } from './ifr_source_collector.js'
// 不得改回 import type：@inject() 的运行时元数据需要值导入（见 portfolio_grouping_view_service）。
import AuditService from '#services/audit_service'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

export interface IfrPreviewInput {
  organizationId: number
  projectId: number
  user: User
  currentState?: string
  idealState?: string
  usefulFunction?: number
  cost?: number
  harm?: number
  stages?: { kind: 'current' | 'intermediate' | 'target'; label: string; description: string }[]
}

export interface IfrSaveInput {
  ifrId?: string
  organizationId: number
  projectId: number
  user: User
  currentState: string
  idealState: string
  stages: IfrStage[]
  idealityScore: IdealityScoreOutput
  trendSummary: IfrTrendSummary
  sourceRefs: IfrSourceRef[]
  warningSummary: IfrWarningCode[]
  sourceHash: string
  outputHash: string
}

@inject()
export default class TrizIfrVisualizationService {
  private sourceCollector = new IfrSourceCollector()

  constructor(private auditService: AuditService) {}

  /**
   * 构建只读 IFR 预览（无副作用，事务外）。
   */
  async buildPreview(input: IfrPreviewInput): Promise<IfrPreview> {
    const collected = await this.sourceCollector.collect({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.user.id,
      currentState: input.currentState,
      idealState: input.idealState,
    })

    const score = computeIdealityScore(
      {
        usefulFunction: input.usefulFunction ?? 0.5,
        cost: input.cost ?? 0.3,
        harm: input.harm ?? 0.2,
      },
      undefined,
      collected.sourceRefs,
    )

    const stages = this.buildDefaultStages(collected, input.stages)
    const trendSummary = computeIfrTrendSummary(score, null)
    const warningSummary = aggregateIfrWarnings(stages, collected.sourceRefs, score)

    const outputHash = simpleHash(
      JSON.stringify({
        currentState: collected.currentState,
        idealState: collected.idealState,
        stages: stages.map((s) => s.stageHash),
        score: score.outputHash,
        sourceRefs: collected.sourceRefs.map((s) => s.hash),
        warnings: warningSummary,
      }),
    )

    return {
      previewId: simpleHash(`${input.organizationId}:${input.projectId}:preview:${Date.now()}`),
      organizationId: input.organizationId,
      projectId: input.projectId,
      currentState: collected.currentState,
      idealState: collected.idealState,
      stages: rankIfrStages(stages),
      idealityScore: score,
      trendSummary,
      sourceRefs: collected.sourceRefs,
      warningSummary,
      aiDraftState: null,
      reviewStatus: 'preview',
      schemaVersion: IFR_SCHEMA_VERSION,
      scoreVersion: IFR_SCORE_VERSION,
      outputHash,
    }
  }

  /**
   * 显式保存 IFR 审查会话。
   */
  async saveReview(input: IfrSaveInput): Promise<IfrSavedReview> {
    const {
      organizationId,
      projectId,
      user,
      currentState,
      idealState,
      stages,
      idealityScore,
      trendSummary,
      sourceRefs,
      warningSummary,
      sourceHash,
      outputHash,
    } = input

    const ifrId = input.ifrId ?? simpleHash(`${organizationId}:${projectId}:${Date.now()}`)

    // Supersede existing
    const existing = await TrizIfrReviewSession.queryForOrgProjectIfr(
      organizationId,
      projectId,
      ifrId,
    ).first()

    if (existing) {
      existing.reviewStatus = 'superseded'
      await existing.save()
    }

    const session = await TrizIfrReviewSession.create({
      ifrId,
      organizationId,
      projectId,
      actorId: user.id,
      currentState,
      idealState,
      reviewStatus: 'saved' as IfrReviewStatus,
      schemaVersion: IFR_SCHEMA_VERSION,
      scoreVersion: IFR_SCORE_VERSION,
      idealityScore,
      trendSummary,
      sourceRefs,
      warningSummary,
      aiDraftState: null,
      outputHash,
      sourceHash,
    })

    for (const stage of stages) {
      await TrizIfrStageSnapshot.create({
        sessionId: session.id,
        stageId: stage.stageId,
        kind: stage.kind,
        label: stage.label,
        description: stage.description,
        expectedUsefulFunctionChange: stage.expectedUsefulFunctionChange,
        expectedCostChange: stage.expectedCostChange,
        expectedHarmChange: stage.expectedHarmChange,
        relatedPrincipleRefs: stage.relatedPrincipleRefs,
        relatedContradictionRefs: stage.relatedContradictionRefs,
        warningCodes: stage.warningCodes,
        reviewState: stage.reviewState,
        stageHash: stage.stageHash,
        stale: stage.stale,
      })
    }

    await this.auditService.log({
      event: 'TRIZ_IFR_REVIEW_SAVED' as any,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'triz_ifr_review_session',
      entityId: session.id,
      metadata: {
        ifrId,
        actor: user.id,
        org: organizationId,
        project: projectId,
        sourceHash: sourceHash.slice(0, 8),
        outputHash: outputHash.slice(0, 8),
        warningCount: warningSummary.length,
        stageCount: stages.length,
      },
    })

    // Read back stage snapshots for DTO conversion
    const savedStages = await TrizIfrStageSnapshot.queryForSession(session.id)
    return this.toSavedReviewDTO(session, savedStages)
  }

  async listSaved(
    organizationId: number,
    projectId: number,
    page: number = 1,
    perPage: number = 20,
  ): Promise<{
    data: IfrSavedReview[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const query = TrizIfrReviewSession.queryForProject(organizationId, projectId).orderBy(
      'created_at',
      'desc',
    )

    const total = await query.clone().clearOrder().count('* as total')
    const totalCount = Number(total[0]?.$extras?.total ?? 0)

    const sessions = await query.offset((page - 1) * perPage).limit(perPage)

    const data: IfrSavedReview[] = []
    for (const session of sessions) {
      const stages = await TrizIfrStageSnapshot.queryForSession(session.id)
      data.push(this.toSavedReviewDTO(session, stages))
    }

    return {
      data,
      meta: {
        total: totalCount,
        page,
        perPage,
        totalPages: Math.ceil(totalCount / perPage),
      },
    }
  }

  async detail(
    organizationId: number,
    projectId: number,
    ifrId: string,
  ): Promise<IfrSavedReview | null> {
    const session = await TrizIfrReviewSession.queryForOrgProjectIfr(
      organizationId,
      projectId,
      ifrId,
    ).first()

    if (!session) return null

    const stages = await TrizIfrStageSnapshot.queryForSession(session.id)
    return this.toSavedReviewDTO(session, stages)
  }

  async checkFreshness(
    organizationId: number,
    projectId: number,
    ifrId: string,
    currentSourceHash: string,
  ): Promise<IfrFreshnessResult | null> {
    const session = await TrizIfrReviewSession.queryForOrgProjectIfr(
      organizationId,
      projectId,
      ifrId,
    ).first()

    if (!session) return null

    const isFresh = !isIfrSourceStale(currentSourceHash, session.sourceHash)

    let staleStageIds: string[] = []
    let staleSourceKinds: IfrSourceKind[] = []

    if (!isFresh) {
      const stages = await TrizIfrStageSnapshot.queryForSession(session.id)
      staleStageIds = stages.filter((s) => s.stale).map((s) => s.stageId)

      staleSourceKinds = (session.sourceRefs ?? [])
        .filter((r: any) => r.stale)
        .map((r: any) => r.kind as IfrSourceKind)
    }

    return {
      isFresh,
      staleStageIds,
      staleSourceKinds,
      staleReason: isFresh ? null : '来源 hash 与当前快照不匹配，请刷新 IFR 审查。',
      currentSourceHash,
      storedSourceHash: session.sourceHash,
    }
  }

  // ── Private ──

  private buildDefaultStages(
    collected: IfrCollectedSources,
    userStages?: {
      kind: 'current' | 'intermediate' | 'target'
      label: string
      description: string
    }[],
  ): IfrStage[] {
    if (userStages && userStages.length > 0) {
      return userStages.map((s) => ({
        stageId: simpleHash(`${s.kind}:${s.label}:${s.description}`),
        kind: s.kind,
        label: s.label,
        description: s.description,
        expectedUsefulFunctionChange: '+0%',
        expectedCostChange: '-0%',
        expectedHarmChange: '-0%',
        relatedPrincipleRefs: [],
        relatedContradictionRefs: [],
        warningCodes: [],
        reviewState: 'pending' as const,
        stageHash: computeIfrStageHash(s),
        stale: false,
      }))
    }

    return [
      {
        stageId: 'default-current',
        kind: 'current' as const,
        label: '当前状态',
        description: collected.currentState,
        expectedUsefulFunctionChange: '+0%',
        expectedCostChange: '-0%',
        expectedHarmChange: '-0%',
        relatedPrincipleRefs: [],
        relatedContradictionRefs: [],
        warningCodes: [],
        reviewState: 'pending' as const,
        stageHash: computeIfrStageHash({
          kind: 'current',
          label: '当前状态',
          description: collected.currentState,
        }),
        stale: false,
      },
      {
        stageId: 'default-target',
        kind: 'target' as const,
        label: '目标 IFR',
        description: collected.idealState,
        expectedUsefulFunctionChange: '+50%',
        expectedCostChange: '-100%',
        expectedHarmChange: '-100%',
        relatedPrincipleRefs: [],
        relatedContradictionRefs: [],
        warningCodes: [],
        reviewState: 'pending' as const,
        stageHash: computeIfrStageHash({
          kind: 'target',
          label: '目标 IFR',
          description: collected.idealState,
        }),
        stale: false,
      },
    ]
  }

  private toSavedReviewDTO(
    session: TrizIfrReviewSession,
    stages: TrizIfrStageSnapshot[],
  ): IfrSavedReview {
    return {
      ifrId: session.ifrId,
      organizationId: session.organizationId,
      projectId: session.projectId,
      currentState: session.currentState,
      idealState: session.idealState,
      stages: stages.map((s) => ({
        stageId: s.stageId,
        kind: s.kind as IfrStage['kind'],
        label: s.label,
        description: s.description,
        expectedUsefulFunctionChange: s.expectedUsefulFunctionChange,
        expectedCostChange: s.expectedCostChange,
        expectedHarmChange: s.expectedHarmChange,
        relatedPrincipleRefs: s.relatedPrincipleRefs ?? [],
        relatedContradictionRefs: s.relatedContradictionRefs ?? [],
        warningCodes: s.warningCodes ?? [],
        reviewState: s.reviewState as IfrStage['reviewState'],
        stageHash: s.stageHash,
        stale: s.stale,
      })),
      idealityScore: session.idealityScore ?? {
        formulaVersion: 1,
        dimensions: [],
        aggregateScore: 0,
        confidence: 0,
        missingDataWarnings: [],
        sourceRefs: [],
        outputHash: '',
      },
      trendSummary: session.trendSummary ?? {
        usefulFunctionTrend: 'unknown',
        costTrend: 'unknown',
        harmTrend: 'unknown',
        overallDirection: 'needs_review',
        summaryText: '',
        trendHash: '',
      },
      sourceRefs: session.sourceRefs ?? [],
      warningSummary: session.warningSummary ?? [],
      aiDraftState: session.aiDraftState,
      reviewStatus: session.reviewStatus,
      schemaVersion: session.schemaVersion,
      scoreVersion: session.scoreVersion,
      outputHash: session.outputHash,
      actorId: session.actorId,
      createdAt: session.createdAt.toISO() ?? '',
      updatedAt: session.updatedAt.toISO() ?? '',
    }
  }
}
