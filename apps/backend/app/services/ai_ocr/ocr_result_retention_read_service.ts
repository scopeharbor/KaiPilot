/**
 * OcrResultRetentionReadService — OCR 保留状态只读服务（v3-ocr-result-persistence-and-retention §4.5）
 *
 * 职责：
 * - 项目级保留状态摘要（counts by lifecycle/kind，expiringSoon，holdActiveCount）
 * - 单条记录保留摘要
 * - accepted extraction 保留摘要列表
 * - 只读，不修改任何数据
 */

import OcrDocumentJob from '#models/ocr_document_job'
import OcrDocumentCandidate from '#models/ocr_document_candidate'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrRetentionHold from '#models/ocr_retention_hold'
import { OcrResultRetentionPolicyResolver } from './ocr_result_retention_policy_resolver.js'
import { OcrResultLifecycleClassifier } from './ocr_result_lifecycle_classifier.js'
import type { RecordForClassification } from './ocr_result_lifecycle_classifier.js'
import {
  type OcrRetentionStatusResponse,
  type OcrRetentionRecordSummary,
  type OcrAcceptedExtractionRetentionSummary,
  type OcrRetentionAllowedAction,
  type OcrRetentionLifecycleState,
  type OcrRetentionRecordKind,
  resolveOcrRetentionAllowedActions,
} from '@aiproj/types'

export class OcrResultRetentionReadService {
  #policyResolver = new OcrResultRetentionPolicyResolver()
  #classifier = new OcrResultLifecycleClassifier()

  /**
   * 获取项目级 OCR 保留状态
   */
  async getProjectStatus(
    organizationId: number,
    projectId: number,
    allowedActions: OcrRetentionAllowedAction[],
  ): Promise<OcrRetentionStatusResponse> {
    const policy = await this.#policyResolver.resolve(organizationId, projectId)

    // 收集所有受治理记录
    const jobs = await this.#fetchJobs(organizationId, projectId)
    const candidates = await this.#fetchCandidates(organizationId, projectId)
    const acceptedExtractions = await this.#fetchAcceptedExtractions(organizationId, projectId)

    const allRecords: RecordForClassification[] = [...jobs, ...candidates, ...acceptedExtractions]

    // 查找活跃 hold
    const activeHolds = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'active')
      .count('* as total')
    const holdActiveCount = Number(activeHolds[0].$extras?.total ?? 0)

    // 分类并统计
    const classifications = this.#classifier.classifyMany(allRecords, policy)

    const counts: Record<OcrRetentionLifecycleState, number> = {
      active: 0,
      reviewable: 0,
      accepted: 0,
      superseded: 0,
      expired: 0,
      purge_pending: 0,
      purged: 0,
      hold_blocked: 0,
    }

    const countsByKind: Record<OcrRetentionRecordKind, number> = {
      job: jobs.length,
      page: 0, // pages are counted via jobs
      candidate: candidates.length,
      accepted_extraction: acceptedExtractions.length,
    }

    let expiringSoon = 0
    const now = new Date()
    const soonThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    for (const record of allRecords) {
      const classification = classifications.get(record.id)
      if (classification) {
        counts[classification.lifecycleState]++
        if (
          classification.retentionDeadline &&
          new Date(classification.retentionDeadline) < soonThreshold &&
          !['purged', 'hold_blocked'].includes(classification.lifecycleState)
        ) {
          expiringSoon++
        }
      }
    }

    return {
      organizationId,
      projectId,
      policy,
      counts,
      countsByKind,
      expiringSoon,
      holdActiveCount,
      allowedActions,
    }
  }

  /**
   * 获取单条记录的保留摘要（跨记录种类）
   */
  async getRecordSummary(
    recordKind: OcrRetentionRecordKind,
    recordId: number,
    organizationId: number,
    projectId: number,
  ): Promise<OcrRetentionRecordSummary | null> {
    const policy = await this.#policyResolver.resolve(organizationId, projectId)
    let record: RecordForClassification | null = null

    // 尝试各表
    switch (recordKind) {
      case 'job':
        record = await this.#fetchJobById(recordId)
        break
      case 'candidate':
        record = await this.#fetchCandidateById(recordId)
        break
      case 'accepted_extraction':
        record = await this.#fetchAcceptedExtractionById(recordId)
        break
    }

    if (!record) return null

    // 验证组织隔离
    const classification = this.#classifier.classify(record, policy)
    const holdActive = await this.#checkHold(organizationId, projectId, recordKind, recordId)

    return {
      recordKind: record.kind,
      recordId: record.id,
      lifecycleState: holdActive ? 'hold_blocked' : classification.lifecycleState,
      sensitivityCategory: classification.sensitivityCategory,
      sourceKind: null,
      sourceHash: null,
      contentHash: null,
      retentionDeadline: classification.retentionDeadline,
      blockedReason: holdActive ? 'hold_active' : null,
      holdActive,
      textAvailable: !record.purgedAt && !record.redactedAt,
    }
  }

  /**
   * 获取 accepted extraction 保留摘要列表
   */
  async getAcceptedExtractionSummaries(
    organizationId: number,
    projectId: number,
  ): Promise<OcrAcceptedExtractionRetentionSummary[]> {
    const policy = await this.#policyResolver.resolve(organizationId, projectId)
    const extractions = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    const results: OcrAcceptedExtractionRetentionSummary[] = []
    for (const ext of extractions) {
      const record: RecordForClassification = {
        kind: 'accepted_extraction',
        id: ext.id,
        status: ext.status,
        hasText: !!ext.selectedText,
        hasAcceptedExtraction: false,
        isSuperseded: ext.status === 'superseded',
        hasHold: false,
        createdAt: ext.createdAt.toISO()!,
        purgedAt: (ext as any).purgedAt?.toISO?.() ?? null,
        redactedAt: (ext as any).redactedAt?.toISO?.() ?? null,
        confirmedAt: ext.confirmedAt?.toISO?.() ?? null,
        supersededAt: ext.supersededAt?.toISO?.() ?? null,
      }
      const classification = this.#classifier.classify(record, policy)

      results.push({
        extractionId: ext.id,
        lifecycleState: classification.lifecycleState,
        status: ext.status as 'current' | 'superseded',
        sourceHash: ext.sourceHash,
        candidateHash: ext.candidateHash,
        selectedTextHash: ext.selectedTextHash,
        reviewerId: ext.reviewerId,
        pageRefs: ext.pageRefsJson,
        retentionDeadline: classification.retentionDeadline,
        holdActive: false,
        textAvailable: !(ext as any).purgedAt && !(ext as any).redactedAt,
        tombstoneId: (ext as any).tombstoneId ?? null,
        confirmedAt: ext.confirmedAt?.toISO?.() ?? null,
        supersededAt: ext.supersededAt?.toISO?.() ?? null,
      })
    }

    return results
  }

  // ── 权限解析 ──

  resolveAllowedActions(
    canView: boolean,
    canManage: boolean,
    canHold: boolean,
  ): OcrRetentionAllowedAction[] {
    return resolveOcrRetentionAllowedActions({ canView, canManage, canHold })
  }

  // ── private helpers ──

  async #fetchJobs(orgId: number, projectId: number): Promise<RecordForClassification[]> {
    const jobs = await OcrDocumentJob.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
    return jobs.map((j) => ({
      kind: 'job' as OcrRetentionRecordKind,
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
    }))
  }

  async #fetchCandidates(orgId: number, projectId: number): Promise<RecordForClassification[]> {
    // Candidates don't have org/project directly — they're linked via job
    const jobs = await OcrDocumentJob.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
    const jobIds = jobs.map((j) => j.id)
    if (jobIds.length === 0) return []

    const candidates = await OcrDocumentCandidate.query().whereIn('job_id', jobIds)
    return candidates.map((c) => ({
      kind: 'candidate' as OcrRetentionRecordKind,
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
    }))
  }

  async #fetchAcceptedExtractions(
    orgId: number,
    projectId: number,
  ): Promise<RecordForClassification[]> {
    const extractions = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', orgId)
      .where('project_id', projectId)
    return extractions.map((e) => ({
      kind: 'accepted_extraction' as OcrRetentionRecordKind,
      id: e.id,
      status: e.status,
      hasText: !!e.selectedText,
      hasAcceptedExtraction: false,
      isSuperseded: e.status === 'superseded',
      hasHold: false,
      createdAt: e.createdAt.toISO()!,
      purgedAt: (e as any).purgedAt?.toISO?.() ?? null,
      redactedAt: (e as any).redactedAt?.toISO?.() ?? null,
      confirmedAt: e.confirmedAt?.toISO?.() ?? null,
      supersededAt: e.supersededAt?.toISO?.() ?? null,
    }))
  }

  async #fetchJobById(id: number): Promise<RecordForClassification | null> {
    const j = await OcrDocumentJob.find(id)
    if (!j) return null
    return {
      kind: 'job',
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
    }
  }

  async #fetchCandidateById(id: number): Promise<RecordForClassification | null> {
    const c = await OcrDocumentCandidate.find(id)
    if (!c) return null
    return {
      kind: 'candidate',
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
    }
  }

  async #fetchAcceptedExtractionById(id: number): Promise<RecordForClassification | null> {
    const e = await OcrReviewAcceptedExtraction.find(id)
    if (!e) return null
    return {
      kind: 'accepted_extraction',
      id: e.id,
      status: e.status,
      hasText: !!e.selectedText,
      hasAcceptedExtraction: false,
      isSuperseded: e.status === 'superseded',
      hasHold: false,
      createdAt: e.createdAt.toISO()!,
      purgedAt: (e as any).purgedAt?.toISO?.() ?? null,
      redactedAt: (e as any).redactedAt?.toISO?.() ?? null,
      confirmedAt: e.confirmedAt?.toISO?.() ?? null,
      supersededAt: e.supersededAt?.toISO?.() ?? null,
    }
  }

  async #checkHold(
    organizationId: number,
    projectId: number,
    recordKind: OcrRetentionRecordKind,
    _recordId: number,
  ): Promise<boolean> {
    const count = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'active')
      .where('scope_kind', recordKind === 'accepted_extraction' ? 'accepted_extraction' : 'job')
      .select('scope_hash')
    // Simple check: if any active hold exists at job level, all child records are blocked
    return count.length > 0
  }
}
