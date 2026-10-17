import { DateTime } from 'luxon'
/**
 * OcrResultRetentionService — OCR 保留治理核心服务（v3-ocr-result-persistence-and-retention §5）
 *
 * 职责：
 * - 保留 cleanup preview（非破坏性，只返回预备清理的记录清单）
 * - 保留 cleanup execute（幂等，重新验证 hash/hold/ownership）
 * - Hold set/release
 * - Tombstone 创建
 * - 不改变 source file、task、WBS、risk、Compiler、AI draft、search index、knowledge base
 *
 * 与 OcrResultRetentionPolicyResolver、OcrResultLifecycleClassifier 协作。
 */

import OcrDocumentJob from '#models/ocr_document_job'
import OcrDocumentPage from '#models/ocr_document_page'
import OcrDocumentCandidate from '#models/ocr_document_candidate'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrRetentionCleanupRun from '#models/ocr_retention_cleanup_run'
import OcrRetentionHold from '#models/ocr_retention_hold'
import OcrRetentionTombstone from '#models/ocr_retention_tombstone'
import { OcrResultRetentionPolicyResolver } from './ocr_result_retention_policy_resolver.js'
import { OcrResultLifecycleClassifier } from './ocr_result_lifecycle_classifier.js'
import type { RecordForClassification } from './ocr_result_lifecycle_classifier.js'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  type OcrCleanupPreviewRequest,
  type OcrCleanupPreviewResponse,
  type OcrCleanupPreviewItem,
  type OcrCleanupExecuteRequest,
  type OcrCleanupResultDTO,
  type OcrRetentionHoldSetRequest,
  type OcrRetentionHoldDTO,
  type OcrRetentionPolicy,
  type OcrRetentionRecordKind,
  type OcrRetentionCleanupAction,
  computeCleanupPreviewHash,
  computeRecordFingerprint,
  computeTombstoneHash,
  computeHoldScopeHash,
  buildOcrRetentionAuditMetadata,
  isRetentionDeadlineReached,
  retentionDaysForCategory,
  OCR_RETENTION_HOLD_NOTE_MAX_LENGTH,
  isValidHoldNote,
} from '@aiproj/types'

export class OcrResultRetentionService {
  readonly #policyResolver = new OcrResultRetentionPolicyResolver()
  readonly #classifier = new OcrResultLifecycleClassifier()
  readonly #audit = new AuditService()

  /**
   * cleanup preview —— 返回 eligible + blocked 记录清单（非破坏性）
   */
  async preview(
    organizationId: number,
    projectId: number,
    request: OcrCleanupPreviewRequest,
    userId: number,
  ): Promise<OcrCleanupPreviewResponse> {
    const policy = await this.#policyResolver.resolve(organizationId, projectId)

    // 收集符合条件的记录
    const jobs = await this.#collectJobs(organizationId, projectId, request)
    const candidates = await this.#collectCandidates(organizationId, projectId, request)
    const acceptedExtractions = await this.#collectAcceptedExtractions(
      organizationId,
      projectId,
      request,
    )

    const allRecords: RecordForClassification[] = [...jobs, ...candidates, ...acceptedExtractions]

    const classifications = this.#classifier.classifyMany(allRecords, policy)
    const now = new Date()

    // 查找活跃 hold
    const activeHolds = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'active')

    const holdScopes = new Set(activeHolds.map((h) => h.scopeHash))

    const eligible: OcrCleanupPreviewItem[] = []
    const blocked: OcrCleanupPreviewItem[] = []

    for (const record of allRecords) {
      const classification = classifications.get(record.id)
      if (!classification) continue

      const item: OcrCleanupPreviewItem = {
        recordKind: record.kind,
        recordId: record.id,
        lifecycleState: classification.lifecycleState,
        plannedAction: null,
        blockedReason: null,
        contentHash: null,
        sourceHash: null,
      }

      // 判断是否被 hold 阻止
      const scopeHash = `${record.kind}:${record.id}`
      if (holdScopes.has(scopeHash) || holdScopes.has(`job:${record.id}`)) {
        item.blockedReason = 'hold_active'
        blocked.push(item)
        continue
      }

      // 判断是否仍处于保留期内
      if (
        !classification.retentionDeadline ||
        !isRetentionDeadlineReached({
          baseIso: record.createdAt,
          retentionDays: retentionDaysForCategory(policy, classification.sensitivityCategory),
          nowIso: now.toISOString(),
        })
      ) {
        item.blockedReason = 'within_retention'
        blocked.push(item)
        continue
      }

      // 判断是否有 accepted_extraction 依赖
      if (
        record.hasAcceptedExtraction &&
        ['accepted_extraction_text', 'accepted_extraction_metadata'].includes(
          classification.sensitivityCategory,
        ) &&
        !record.isSuperseded
      ) {
        item.blockedReason = 'accepted_dependency'
        blocked.push(item)
        continue
      }

      // 判断 source 是否仍为最新
      // （简化：如果 record 状态不是 superseded/expired 则跳过）
      if (
        classification.lifecycleState === 'active' ||
        classification.lifecycleState === 'accepted'
      ) {
        item.blockedReason = 'source_fresh'
        blocked.push(item)
        continue
      }

      // 已是终态
      if (classification.lifecycleState === 'purged') {
        item.blockedReason = 'already_terminal'
        blocked.push(item)
        continue
      }

      // 可清理：确定动作
      const action = this.#determineCleanupAction(classification.sensitivityCategory, policy)
      item.plannedAction = action
      item.contentHash = record.contentHash ?? null
      item.sourceHash = record.sourceHash ?? null
      eligible.push(item)
    }

    // 截断
    const limit = request.limit ?? 500
    const truncated = eligible.length > limit
    const truncatedEligible = eligible.slice(0, limit)

    const recordFingerprints = truncatedEligible.map((r) =>
      computeRecordFingerprint({
        recordKind: r.recordKind,
        recordId: r.recordId,
        lifecycleState: r.lifecycleState,
        sourceHash: r.sourceHash,
        contentHash: r.contentHash,
      }),
    )

    const previewHash = computeCleanupPreviewHash({
      organizationId,
      projectId,
      policyHash: policy.policyHash,
      recordFingerprints,
      nowIso: now.toISOString(),
    })

    // 审计
    await this.#audit.log({
      event: AuditEvent.OCR_RETENTION_PREVIEW,
      userId,
      organizationId,
      projectId,
      metadata: buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId,
        projectId,
        action: 'OCR_RETENTION_PREVIEW',
        policyHash: policy.policyHash,
        previewHash,
        counts: {
          eligible: truncatedEligible.length,
          blocked: blocked.length,
        },
      }),
    })

    return {
      previewHash,
      policyHash: policy.policyHash,
      generatedAt: now.toISOString(),
      eligible: truncatedEligible,
      blocked,
      plannedTombstones: truncatedEligible.filter(
        (r) => r.plannedAction === 'purge' || r.plannedAction === 'tombstone',
      ).length,
      policyEvidence: {
        source: policy.source,
        bounds: policy.bounds,
      },
      truncated,
      requiresExplicitConfirmation: true,
    }
  }

  /**
   * cleanup execute —— 执行清理（幂等，需显式确认）
   */
  async execute(
    organizationId: number,
    projectId: number,
    request: OcrCleanupExecuteRequest,
    userId: number,
  ): Promise<OcrCleanupResultDTO> {
    if (request.confirm !== true) {
      throw new Error('需要显式确认清理操作')
    }

    const policy = await this.#policyResolver.resolve(organizationId, projectId)

    // 检查幂等
    const existing = await OcrRetentionCleanupRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('run_key', request.runKey)
      .first()

    if (existing) {
      return this.#toCleanupResultDTO(existing, true)
    }

    // 重新获取 preview 信息进行验证
    const previewResult = await this.preview(organizationId, projectId, {}, userId)

    // 验证 preview hash
    if (previewResult.previewHash !== request.previewHash) {
      await this.#audit.log({
        event: AuditEvent.OCR_RETENTION_STALE_PREVIEW_BLOCKED,
        userId,
        organizationId,
        projectId,
        metadata: buildOcrRetentionAuditMetadata({
          actorId: userId,
          organizationId,
          projectId,
          action: 'OCR_RETENTION_STALE_PREVIEW_BLOCKED',
          previewHash: request.previewHash,
          policyHash: policy.policyHash,
        }),
      })
      throw new Error('Preview 已过期，请重新预览')
    }

    // 验证 policy hash
    if (previewResult.policyHash !== policy.policyHash) {
      throw new Error('保留策略已变更，请重新预览')
    }

    // 执行清理
    const startedAt = new Date().toISOString()
    let expiredCount = 0
    let redactedCount = 0
    let purgedCount = 0
    let tombstoneCount = 0
    let blockedCount = 0

    for (const item of previewResult.eligible) {
      try {
        const tombstone = await this.#executeCleanupItem(
          organizationId,
          projectId,
          item,
          policy,
          'retention_expired',
        )

        if (tombstone) tombstoneCount++
        if (item.plannedAction === 'expire') expiredCount++
        if (item.plannedAction === 'redact') redactedCount++
        if (item.plannedAction === 'purge') purgedCount++
      } catch {
        blockedCount++
      }
    }

    // 创建清理运行记录
    const run = await OcrRetentionCleanupRun.create({
      organizationId,
      projectId,
      runKey: request.runKey,
      status: 'completed',
      previewHash: request.previewHash,
      policyHash: policy.policyHash,
      expiredCount,
      redactedCount,
      purgedCount,
      tombstoneCount,
      blockedCount,
      executedBy: userId,
      startedAt: DateTime.fromISO(startedAt),
      completedAt: DateTime.now(),
    })

    await this.#audit.log({
      event: AuditEvent.OCR_RETENTION_CLEANUP_EXECUTED,
      userId,
      organizationId,
      projectId,
      metadata: buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId,
        projectId,
        action: 'OCR_RETENTION_CLEANUP_EXECUTED',
        policyHash: policy.policyHash,
        previewHash: request.previewHash,
        runId: run.id,
        counts: { expiredCount, redactedCount, purgedCount, tombstoneCount, blockedCount },
      }),
    })

    return this.#toCleanupResultDTO(run, false)
  }

  /**
   * 设置 hold
   */
  async setHold(
    organizationId: number,
    projectId: number,
    request: OcrRetentionHoldSetRequest,
    userId: number,
  ): Promise<OcrRetentionHoldDTO> {
    // 验证 note
    if (!isValidHoldNote(request.note)) {
      throw new Error(
        `Hold note 无效：最大 ${OCR_RETENTION_HOLD_NOTE_MAX_LENGTH} 字符，不含绝对路径`,
      )
    }

    const scopeHash = computeHoldScopeHash({
      organizationId,
      projectId,
      scopeKind: request.scopeKind,
      scopeRef: request.scopeRef,
    })

    const hold = await OcrRetentionHold.create({
      organizationId,
      projectId,
      scopeKind: request.scopeKind,
      scopeHash,
      reasonCode: request.reasonCode,
      note: request.note ?? null,
      status: 'active',
      setBy: userId,
      setAt: DateTime.now(),
    })

    await this.#audit.log({
      event: AuditEvent.OCR_RETENTION_HOLD_SET,
      userId,
      organizationId,
      projectId,
      metadata: buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId,
        projectId,
        action: 'OCR_RETENTION_HOLD_SET',
        holdId: hold.id,
      }),
    })

    return this.#toHoldDTO(hold)
  }

  /**
   * 释放 hold
   */
  async releaseHold(
    holdId: number,
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<OcrRetentionHoldDTO> {
    const hold = await OcrRetentionHold.query()
      .where('id', holdId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!hold) throw new Error('Hold 不存在或不属于此项目')
    if (hold.status !== 'active') throw new Error('Hold 已释放')

    hold.status = 'released'
    hold.releasedBy = userId
    hold.releasedAt = DateTime.now()
    await hold.save()

    await this.#audit.log({
      event: AuditEvent.OCR_RETENTION_HOLD_RELEASED,
      userId,
      organizationId,
      projectId,
      metadata: buildOcrRetentionAuditMetadata({
        actorId: userId,
        organizationId,
        projectId,
        action: 'OCR_RETENTION_HOLD_RELEASED',
        holdId: hold.id,
      }),
    })

    return this.#toHoldDTO(hold)
  }

  /**
   * 获取项目所有 hold
   */
  async listHolds(organizationId: number, projectId: number): Promise<OcrRetentionHoldDTO[]> {
    const holds = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    return holds.map((h) => this.#toHoldDTO(h))
  }

  // ── private helpers ──

  async #collectJobs(
    orgId: number,
    projectId: number,
    request: OcrCleanupPreviewRequest,
  ): Promise<RecordForClassification[]> {
    let query = OcrDocumentJob.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)

    if (request.recordKinds && !request.recordKinds.includes('job')) return []
    if (request.jobId) query = query.where('id', request.jobId)
    if (request.limit) query = query.limit(request.limit)

    const jobs = await query
    return jobs.map((j) => ({
      kind: 'job' as const,
      id: j.id,
      status: j.status,
      hasText: false,
      hasAcceptedExtraction: false,
      isSuperseded: false,
      hasHold: false,
      createdAt: j.createdAt.toISO()!,
      purgedAt: (j as any).purgedAt?.toISO?.() ?? null,
      redactedAt: (j as any).redactedAt?.toISO?.() ?? null,
      confirmedAt: null,
      supersededAt: null,
      sourceHash: j.sourceHash,
      contentHash: null,
    }))
  }

  async #collectCandidates(
    orgId: number,
    projectId: number,
    request: OcrCleanupPreviewRequest,
  ): Promise<RecordForClassification[]> {
    if (request.recordKinds && !request.recordKinds.includes('candidate')) return []

    const jobs = await OcrDocumentJob.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
    const jobIds = jobs.map((j) => j.id)
    if (jobIds.length === 0) return []

    let query = OcrDocumentCandidate.query().whereIn('job_id', jobIds)
    if (request.limit) query = query.limit(request.limit)

    const candidates = await query
    return candidates.map((c) => ({
      kind: 'candidate' as const,
      id: c.id,
      status: c.status,
      hasText: !!c.extractedText,
      hasAcceptedExtraction: false,
      isSuperseded: false,
      hasHold: false,
      createdAt: c.createdAt.toISO()!,
      purgedAt: (c as any).purgedAt?.toISO?.() ?? null,
      redactedAt: (c as any).redactedAt?.toISO?.() ?? null,
      confirmedAt: null,
      supersededAt: null,
      sourceHash: c.sourceHash,
      contentHash: c.textHash ?? null,
    }))
  }

  async #collectAcceptedExtractions(
    orgId: number,
    projectId: number,
    request: OcrCleanupPreviewRequest,
  ): Promise<RecordForClassification[]> {
    if (request.recordKinds && !request.recordKinds.includes('accepted_extraction')) return []

    let query = OcrReviewAcceptedExtraction.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)

    if (request.limit) query = query.limit(request.limit)

    const extractions = await query
    return extractions.map((e) => ({
      kind: 'accepted_extraction' as const,
      id: e.id,
      status: e.status,
      hasText: !!e.selectedText,
      hasAcceptedExtraction: true,
      isSuperseded: e.status === 'superseded',
      hasHold: false,
      createdAt: e.createdAt.toISO()!,
      purgedAt: (e as any).purgedAt?.toISO?.() ?? null,
      redactedAt: (e as any).redactedAt?.toISO?.() ?? null,
      confirmedAt: e.confirmedAt?.toISO?.() ?? null,
      supersededAt: e.supersededAt?.toISO?.() ?? null,
      sourceHash: e.sourceHash,
      contentHash: e.selectedTextHash,
    }))
  }

  #determineCleanupAction(
    category: string,
    _policy: OcrRetentionPolicy,
  ): OcrRetentionCleanupAction | null {
    switch (category) {
      case 'candidate_text':
        return 'purge'
      case 'candidate_metadata':
      case 'job_metadata':
      case 'page_state':
      case 'provider_summary':
      case 'accepted_extraction_metadata':
      case 'audit_metadata':
        return 'expire'
      case 'accepted_extraction_text':
        return 'redact'
      case 'tombstone':
        return 'purge'
      default:
        return null
    }
  }

  async #executeCleanupItem(
    organizationId: number,
    projectId: number,
    item: OcrCleanupPreviewItem,
    policy: OcrRetentionPolicy,
    reason: string,
  ): Promise<OcrRetentionTombstone | null> {
    const model = await this.#findRecordModel(item.recordKind, item.recordId)
    if (!model) return null

    // 创建 tombstone
    const tombstoneHash = computeTombstoneHash({
      recordKind: item.recordKind,
      recordId: item.recordId,
      cleanupReason: reason,
      policyHash: policy.policyHash,
      purgedAtIso: new Date().toISOString(),
    })

    const tombstone = await OcrRetentionTombstone.create({
      organizationId,
      projectId,
      recordKind: item.recordKind,
      recordId: item.recordId,
      sourceKind: null,
      sourceHash: item.sourceHash,
      contentHash: item.contentHash,
      lifecycleAction: item.plannedAction ?? 'expire',
      cleanupReason: reason,
      policyHash: policy.policyHash,
      tombstoneHash,
      cleanupRunId: null,
    })

    // 更新记录生命周期状态
    const modelAny = model as any
    if (typeof modelAny.retentionLifecycle === 'string' || modelAny.retentionLifecycle === null) {
      modelAny.retentionLifecycle = 'purged'
    }
    if (typeof modelAny.tombstoneId === 'number' || modelAny.tombstoneId === null) {
      modelAny.tombstoneId = tombstone.id
    }

    // 根据动作删除/脱敏文本
    if (item.plannedAction === 'purge') {
      if (typeof (modelAny as any).candidateText === 'string')
        (modelAny as any).candidateText = null
      if (typeof (modelAny as any).extractedText === 'string')
        (modelAny as any).extractedText = null
      if (typeof (modelAny as any).selectedText === 'string') (modelAny as any).selectedText = null
      if (typeof (modelAny as any).acceptedText === 'string') (modelAny as any).acceptedText = null
    }

    await (model as any).save()

    await this.#audit.log({
      event:
        item.plannedAction === 'purge'
          ? AuditEvent.OCR_RETENTION_PURGED
          : AuditEvent.OCR_RETENTION_EXPIRED,
      userId: 0, // system action
      organizationId,
      projectId,
      metadata: buildOcrRetentionAuditMetadata({
        actorId: 0,
        organizationId,
        projectId,
        action: item.plannedAction === 'purge' ? 'OCR_RETENTION_PURGED' : 'OCR_RETENTION_EXPIRED',
        recordKind: item.recordKind,
        recordId: item.recordId,
        tombstoneId: tombstone.id,
      }),
    })

    return tombstone
  }

  async #findRecordModel(kind: OcrRetentionRecordKind, id: number): Promise<any> {
    switch (kind) {
      case 'job':
        return OcrDocumentJob.find(id)
      case 'page':
        return OcrDocumentPage.find(id)
      case 'candidate':
        return OcrDocumentCandidate.find(id)
      case 'accepted_extraction':
        return OcrReviewAcceptedExtraction.find(id)
    }
  }

  #toCleanupResultDTO(run: OcrRetentionCleanupRun, replayed: boolean): OcrCleanupResultDTO {
    return {
      runId: run.id,
      runKey: run.runKey,
      status: run.status,
      previewHash: run.previewHash,
      policyHash: run.policyHash,
      expiredCount: run.expiredCount,
      redactedCount: run.redactedCount,
      purgedCount: run.purgedCount,
      tombstoneCount: run.tombstoneCount,
      blockedCount: run.blockedCount,
      replayed,
      startedAt: run.startedAt?.toISO?.() ?? new Date().toISOString(),
      completedAt: run.completedAt?.toISO?.() ?? null,
      failureReason: run.failureReason,
    }
  }

  #toHoldDTO(hold: OcrRetentionHold): OcrRetentionHoldDTO {
    return {
      holdId: hold.id,
      organizationId: hold.organizationId,
      projectId: hold.projectId,
      scopeKind: hold.scopeKind,
      scopeHash: hold.scopeHash,
      reasonCode: hold.reasonCode,
      note: hold.note,
      status: hold.status,
      setBy: hold.setBy,
      setAt: hold.setAt?.toISO?.() ?? new Date().toISOString(),
      releasedBy: hold.releasedBy,
      releasedAt: hold.releasedAt?.toISO?.() ?? null,
    }
  }
}
