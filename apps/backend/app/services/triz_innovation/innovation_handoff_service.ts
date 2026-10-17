/**
 * v3-triz-innovation-workbench —— Draft Layer Handoff 服务（§6.2-6.3）。
 *
 * 从工作台方案创建 Draft Layer 候选输入（sourceType=triz_innovation_workbench）。
 * 红线：只创建候选元数据（refs/hash/summary/warnings/actor），不写正式业务数据。
 * Draft Layer 仍必须执行 Preview、Diff、dry-run、权限校验、hash 校验、人工确认。
 *
 * stale 来源（来源 hash 与当前不一致）→ handoff 阻断，返回 status=stale。
 */
import type User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import InnovationWorkbenchService from '#services/triz_innovation/innovation_workbench_service'
import InnovationSourceService from '#services/triz_innovation/innovation_source_service'
import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'
import type {
  InnovationDraftHandoffInput,
  InnovationHandoffMeta,
  InnovationOption,
  TrizAnalysisWarning,
} from '@aiproj/types'
import {
  TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE,
  computeHandoffIdempotencyKey,
  validateInnovationHandoffInput,
} from '@aiproj/types'

export interface CreateHandoffParams {
  user: User
  organizationId: number
  projectId: number
  schemeId: string
  optionIds?: string[]
  note?: string | null
  requestId?: string | null
}

export interface HandoffResult {
  handoffStatus: InnovationHandoffMeta['status']
  draftSessionRef: string | null
  blockedReason: string | null
  candidate: InnovationDraftHandoffInput | null
}

@inject()
export default class InnovationHandoffService {
  constructor(
    private workbench: InnovationWorkbenchService,
    private sources: InnovationSourceService,
    private audit: AuditService,
  ) {}

  async createHandoff(params: CreateHandoffParams): Promise<HandoffResult> {
    const { user, organizationId, projectId, schemeId, note } = params
    const record = await this.workbench.getBySchemeId(organizationId, projectId, schemeId)
    const scheme = record.payload

    if (scheme.status === 'abandoned') {
      return this.block('方案已废弃，无法创建待审核草案', null)
    }

    const optionIds = params.optionIds?.length
      ? params.optionIds
      : scheme.options.map((o) => o.optionId)
    const selectedOptions = scheme.options.filter((o) => optionIds.includes(o.optionId))
    if (selectedOptions.length === 0) {
      return this.block('方案中无可用的候选路径', null)
    }

    // 6.3 来源 hash 校验：比对方案记录的 source hash 与当前来源
    const recordedSignatures = Array.from(
      new Set(selectedOptions.flatMap((o) => o.hashes.contradictionSignatures)),
    )
    const recordedAnalysisHashes = Array.from(
      new Set(selectedOptions.flatMap((o) => o.hashes.analysisContentHashes)),
    )
    const freshness = await this.sources.refreshFreshness({
      user,
      organizationId,
      projectId,
      recorded: {
        contradictionSignatures: recordedSignatures,
        analysisContentHashes: recordedAnalysisHashes,
      },
    })
    if (freshness.stale) {
      await this.audit.log({
        event: AuditEvent.TRIZ_INNOVATION_STALE_DETECTED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'triz_innovation_scheme',
        entityId: record.id,
        requestId: params.requestId ?? null,
        metadata: {
          schemeId,
          mismatchedContradictions: freshness.mismatched.contradictions.length,
          mismatchedAnalyses: freshness.mismatched.analyses.length,
        },
      })
      return {
        handoffStatus: 'stale',
        draftSessionRef: null,
        blockedReason: '来源 hash 已变化，请重新审查后再创建草案',
        candidate: null,
      }
    }
    if (selectedOptions.some((option) => option.sourceRefs.some((source) => source.stale))) {
      await this.audit.log({
        event: AuditEvent.TRIZ_INNOVATION_STALE_DETECTED,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'triz_innovation_scheme',
        entityId: record.id,
        requestId: params.requestId ?? null,
        metadata: {
          schemeId,
          staleSourceRefs: selectedOptions
            .flatMap((option) => option.sourceRefs)
            .filter((source) => source.stale)
            .map((source) => `${source.sourceType}:${source.ref}`),
        },
      })
      return {
        handoffStatus: 'stale',
        draftSessionRef: null,
        blockedReason: '来源已标记为过期，请重新审查后再创建草案',
        candidate: null,
      }
    }

    // blocking warning 检查
    const allWarnings: TrizAnalysisWarning[] = selectedOptions.flatMap((o) => o.warnings)
    if (allWarnings.some((w) => w.severity === 'blocking')) {
      return this.block('存在阻断性 warning，请先处理后再创建草案', null)
    }

    const idempotencyKey = computeHandoffIdempotencyKey({
      schemeId,
      optionIds: selectedOptions.map((o) => o.optionId),
      schemeHash: scheme.schemeHash,
    })

    // 幂等：同 idempotency_key 已存在则直接返回既有
    const existing = await this.workbench.findByHandoffIdempotencyKey(
      organizationId,
      projectId,
      idempotencyKey,
    )
    if (existing && existing.draftSessionRef) {
      return {
        handoffStatus: 'candidate_created',
        draftSessionRef: existing.draftSessionRef,
        blockedReason: null,
        candidate: this.buildCandidate(
          params,
          scheme.schemeHash,
          selectedOptions,
          idempotencyKey,
          allWarnings,
          note ?? null,
        ),
      }
    }

    const draftSessionRef = this.generateDraftSessionRef(schemeId, idempotencyKey)
    const candidate = this.buildCandidate(
      params,
      scheme.schemeHash,
      selectedOptions,
      idempotencyKey,
      allWarnings,
      note ?? null,
    )

    const handoff: InnovationHandoffMeta = {
      status: 'candidate_created',
      draftSessionRef,
      handedOffAt: null,
      blockedReason: null,
    }
    await this.workbench.saveHandoff(organizationId, projectId, schemeId, handoff, idempotencyKey)

    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_HANDOFF_CREATED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: params.requestId ?? null,
      metadata: {
        schemeId,
        optionIds: candidate.optionIds,
        draftSessionRef,
        idempotencyKey,
        sourceHash: candidate.sourceHashes.schemeHash,
        warningTotal: candidate.warningSummary.total,
        warningBlocking: candidate.warningSummary.blocking,
      },
    })

    return { handoffStatus: 'candidate_created', draftSessionRef, blockedReason: null, candidate }
  }

  // ──────── 内部 ────────

  private buildCandidate(
    params: CreateHandoffParams,
    schemeHash: string,
    options: InnovationOption[],
    idempotencyKey: string,
    warnings: TrizAnalysisWarning[],
    note: string | null,
  ): InnovationDraftHandoffInput {
    const contradictionRefs = Array.from(
      new Set(
        options.flatMap((option) =>
          option.sourceRefs
            .filter((source) => source.sourceType === 'contradiction')
            .map((source) => source.ref),
        ),
      ),
    )
    const analysisArtifactRefs = Array.from(
      new Set(
        options.flatMap((option) =>
          option.sourceRefs
            .filter((source) => source.sourceType === 'triz_analysis')
            .map((source) => source.ref),
        ),
      ),
    )
    const contradictionSignatures = Array.from(
      new Set(options.flatMap((option) => option.hashes.contradictionSignatures)),
    )
    const analysisContentHashes = Array.from(
      new Set(options.flatMap((option) => option.hashes.analysisContentHashes)),
    )

    const candidate: InnovationDraftHandoffInput = {
      sourceType: TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE,
      schemeId: params.schemeId,
      optionIds: options.map((option) => option.optionId),
      organizationId: params.organizationId,
      projectId: params.projectId,
      actorId: params.user.id,
      contradictionRefs,
      analysisArtifactRefs,
      sourceHashes: {
        contradictionSignatures,
        analysisContentHashes,
        schemeHash,
      },
      warningSummary: {
        total: warnings.length,
        blocking: warnings.filter((w) => w.severity === 'blocking').length,
        codes: Array.from(new Set(warnings.map((w) => w.code))),
      },
      idempotencyKey,
      note,
    }
    const errors = validateInnovationHandoffInput(candidate)
    if (errors.length > 0) {
      throw new Error(`TRIZ Innovation handoff candidate invalid: ${errors.join('；')}`)
    }
    return candidate
  }

  private generateDraftSessionRef(schemeId: string, idempotencyKey: string): string {
    const raw = `iw_handoff:${schemeId}:${idempotencyKey}`
    return `draft_iw_${createHash('sha256').update(raw, 'utf-8').digest('hex').slice(0, 16)}`
  }

  private block(reason: string, _candidate: InnovationDraftHandoffInput | null): HandoffResult {
    return { handoffStatus: 'stale', draftSessionRef: null, blockedReason: reason, candidate: null }
  }
}
