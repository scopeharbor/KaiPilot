import { DateTime } from 'luxon'
import type {
  OcrReviewSelectionRequest,
  OcrConfirmationPreviewResponse,
  OcrAcceptedExtractionSummary,
  OcrReviewDetailResponse,
  OcrReviewAllowedAction,
} from '@aiproj/types'
import {
  computeSelectedTextHash,
  // barrel 里这三个名字被其他域的同名函数占用，OCR 审查确认版走域前缀别名
  computeOcrReviewPreviewHash,
  computeReviewAcceptedExtractionHash,
  isOcrReviewSourceHashStale,
  resolveAllowedActions,
  buildRedlineSummary,
} from '@aiproj/types'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrReviewSourceAdapter from '#services/ai_ocr/ocr_review_source_adapter'
import OcrReviewPolicy from '#policies/ocr_review_policy'
import { ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

/**
 * OCR 审查确认服务（v3-ocr-review-confirmation-flow §5）。
 *
 * 提供审查详情读取、选择规范化、确认预览、确认保存和超集。
 * 所有写操作都在短事务内完成。
 */
@inject()
export default class OcrReviewService {
  constructor(
    private adapter: OcrReviewSourceAdapter,
    private policy: OcrReviewPolicy,
  ) {}

  /**
   * 获取审查详情——组装所有 DTO 并计算允许的动作。
   */
  async getReviewDetail(
    jobId: number,
    organizationId: number,
    projectId: number,
    user: User,
  ): Promise<OcrReviewDetailResponse> {
    const [canView, canConfirm] = await Promise.all([
      this.policy.view(user, organizationId, projectId),
      this.policy.confirm(user, organizationId, projectId),
    ])

    if (!canView) {
      const { PermissionDeniedException } = await import('#exceptions/api_exception')
      throw new PermissionDeniedException('无权查看 OCR 审查数据')
    }

    const [
      sourceSummary,
      pageGroups,
      candidateItems,
      warningSummary,
      acceptedExtractionsResult,
      jobStatus,
    ] = await Promise.all([
      this.adapter.getSourceSummary(jobId, organizationId, projectId),
      this.adapter.getPageGroups(jobId, organizationId, projectId),
      this.adapter.getCandidateItems(jobId, organizationId, projectId),
      this.adapter.getWarningSummary(jobId, organizationId, projectId),
      this.adapter.getAcceptedExtractions(organizationId, projectId),
      this.adapter.deriveJobStatus(jobId, organizationId, projectId),
    ])

    const isStale = jobStatus === 'stale_source'
    const hasCandidates = candidateItems.length > 0
    const hasAcceptedExtractions = acceptedExtractionsResult.data.length > 0

    const allowedActions: OcrReviewAllowedAction[] = resolveAllowedActions({
      canView,
      canConfirm,
      isStale,
      hasCandidates,
      hasAcceptedExtractions,
    })

    return {
      sourceSummary,
      jobStatus,
      jobId,
      providerLabel: null, // upstream not implemented
      modelLabel: null, // upstream not implemented
      pageGroups,
      candidateItems,
      warningSummary,
      acceptedExtractions: acceptedExtractionsResult.data,
      allowedActions,
      staleReason: isStale ? 'source_hash_mismatch' : null,
    }
  }

  /**
   * 规范化选择——验证候选文本/页面引用的有效性。
   */
  async validateSelection(
    selection: OcrReviewSelectionRequest,
    _organizationId: number,
    _projectId: number,
  ): Promise<{
    selectedTextHash: string
    sourceHash: string
    candidateHash: string
  }> {
    if (!selection.selectedText || selection.selectedText.trim().length === 0) {
      throw new ValidationException('选中文本不能为空')
    }
    if (!selection.pageRefs || selection.pageRefs.length === 0) {
      throw new ValidationException('页面引用不能为空')
    }

    const selectedTextHash = computeSelectedTextHash(selection.selectedText)

    // Guard: upstream candidates table not implemented, use placeholder hashes
    const sourceHash = 'a1b2c3d4' // placeholder - will be real source hash when upstream lands
    const candidateHash = `candidate_hash_${selection.candidateId}`

    return { selectedTextHash, sourceHash, candidateHash }
  }

  /**
   * 确认预览——验证权限/候选/来源新鲜度后返回精确写入载荷。
   */
  async confirmationPreview(
    selection: OcrReviewSelectionRequest,
    organizationId: number,
    projectId: number,
    user: User,
    _reviewNote?: string | null,
  ): Promise<OcrConfirmationPreviewResponse> {
    await this.policy.assertConfirm(user, organizationId, projectId)

    const { selectedTextHash, sourceHash, candidateHash } = await this.validateSelection(
      selection,
      organizationId,
      projectId,
    )

    // Check source freshness (guard: upstream not implemented, skip actual hash comparison)
    if (isOcrReviewSourceHashStale(sourceHash, candidateHash)) {
      throw new ValidationException('来源文件已变更，请重新运行 OCR 后再次审查', {
        code: 'STALE_SOURCE',
      })
    }

    const previewHash = computeOcrReviewPreviewHash(
      sourceHash,
      candidateHash,
      selectedTextHash,
      selection.pageRefs,
    )

    return {
      previewHash,
      sourceHash,
      candidateHash,
      selectedTextHash,
      selectedText: selection.selectedText,
      pageRefs: selection.pageRefs,
      redlineSummary: buildRedlineSummary(),
      requiresExplicitConfirmation: true,
    }
  }

  /**
   * 确认保存——在短事务中重新验证预览哈希和来源新鲜度后写入。
   */
  async confirmationSave(
    previewHash: string,
    selection: OcrReviewSelectionRequest,
    organizationId: number,
    projectId: number,
    user: User,
    reviewNote?: string | null,
  ): Promise<OcrAcceptedExtractionSummary> {
    await this.policy.assertConfirm(user, organizationId, projectId)

    const { selectedTextHash, sourceHash, candidateHash } = await this.validateSelection(
      selection,
      organizationId,
      projectId,
    )

    // Revalidate preview hash
    const expectedHash = computeOcrReviewPreviewHash(
      sourceHash,
      candidateHash,
      selectedTextHash,
      selection.pageRefs,
    )
    if (previewHash !== expectedHash) {
      throw new ValidationException('预览哈希不匹配，请重新预览后再确认', {
        code: 'PREVIEW_HASH_MISMATCH',
      })
    }

    // Revalidate source freshness
    if (isOcrReviewSourceHashStale(sourceHash, candidateHash)) {
      throw new ValidationException('来源文件已变更，无法保存确认', { code: 'STALE_SOURCE' })
    }

    const confirmedAtDt = DateTime.now()
    const confirmedAt = confirmedAtDt.toISO()!

    return db.transaction(async (trx) => {
      // Supersede previous current records for the same source
      const previousCurrent = await OcrReviewAcceptedExtraction.query({ client: trx })
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('source_kind', 'attachment')
        .where('source_hash', sourceHash)
        .where('status', 'current')
        .first()

      let supersededById: number | null = null
      if (previousCurrent) {
        previousCurrent.status = 'superseded'
        previousCurrent.supersededAt = confirmedAtDt
        await previousCurrent.useTransaction(trx).save()
        supersededById = previousCurrent.id
      }

      // Create new accepted extraction
      const record = new OcrReviewAcceptedExtraction()
      record.organizationId = organizationId
      record.projectId = projectId
      record.reviewerId = user.id
      record.sourceKind = 'attachment'
      record.sourceId = null // upstream not implemented
      record.jobId = selection.candidateId // placeholder
      record.candidateId = selection.candidateId
      record.sourceHash = sourceHash
      record.candidateHash = candidateHash
      record.selectedTextHash = selectedTextHash
      record.selectedText = selection.selectedText
      record.pageRefsJson = selection.pageRefs
      record.reviewNote = reviewNote ?? null
      record.status = 'current'
      // 承接上一条 current 记录，保证 supersede 链不断
      record.supersededById = supersededById
      record.confirmationHash = computeReviewAcceptedExtractionHash(
        sourceHash,
        candidateHash,
        selectedTextHash,
        user.id,
        confirmedAt,
      )
      record.confirmedAt = confirmedAtDt

      await record.useTransaction(trx).save()

      return {
        extractionId: record.id,
        sourceHash: record.sourceHash,
        candidateHash: record.candidateHash,
        selectedTextHash: record.selectedTextHash,
        pageRefs: record.pageRefsJson,
        status: 'current',
        reviewerId: record.reviewerId,
        reviewerName: user.fullName ?? null,
        reviewNote: record.reviewNote,
        confirmedAt: confirmedAt,
        supersededAt: null,
      }
    })
  }
}
