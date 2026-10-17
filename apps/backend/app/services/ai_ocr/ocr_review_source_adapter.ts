import type {
  OcrReviewSourceSummary,
  OcrReviewPageGroup,
  OcrReviewCandidateItem,
  OcrReviewWarningSummary,
  OcrAcceptedExtractionSummary,
  OcrReviewStatus,
} from '@aiproj/types'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'

/**
 * OCR 审查来源适配器（v3-ocr-review-confirmation-flow §3.4）。
 *
 * 从上游 OCR 作业/页面/候选/已接受提取记录中读取数据，
 * 组装为审查工作台所需的 DTO。
 *
 * 上游 v3-ocr-document-upload-flow 尚未 apply，
 * 当前适配器返回 guarded 降级数据：
 * - sourceSummary: 从已接受提取表中反推来源信息
 * - pageGroups / candidateItems: 空数组（上游作业/候选不存在）
 * - acceptedExtractions: 从本表读取
 */
export default class OcrReviewSourceAdapter {
  /**
   * 获取来源摘要——当前版本从 accepted extractions 反推，
   * 上游落地后改为从 ocr_document_jobs 读取。
   */
  async getSourceSummary(
    jobId: number,
    organizationId: number,
    projectId: number,
  ): Promise<OcrReviewSourceSummary> {
    // Guard: 上游未实现，返回降级摘要
    const existing = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('job_id', jobId)
      .where('status', 'current')
      .first()

    if (existing) {
      return {
        sourceKind: existing.sourceKind,
        sourceId: existing.sourceId,
        sourceName: null, // 上游未落地，无法查文件名
        sourceHash: existing.sourceHash,
        sourceVersion: null,
        mimeType: null,
        visible: true,
      }
    }

    return {
      sourceKind: 'unknown',
      sourceId: null,
      sourceName: null,
      sourceHash: null,
      sourceVersion: null,
      mimeType: null,
      visible: true,
    }
  }

  /**
   * 获取页面分组——当前返回空（上游未实现）。
   */
  async getPageGroups(
    _jobId: number,
    _organizationId: number,
    _projectId: number,
  ): Promise<OcrReviewPageGroup[]> {
    // Guard: 上游 ocr_document_pages 表不存在，返回空
    return []
  }

  /**
   * 获取候选审查项——当前返回空（上游未实现）。
   */
  async getCandidateItems(
    _jobId: number,
    _organizationId: number,
    _projectId: number,
  ): Promise<OcrReviewCandidateItem[]> {
    // Guard: 上游 ocr_document_candidates 表不存在，返回空
    return []
  }

  /**
   * 获取警告摘要。
   */
  async getWarningSummary(
    _jobId: number,
    _organizationId: number,
    _projectId: number,
  ): Promise<OcrReviewWarningSummary> {
    // Guard: 上游未实现，返回空警告
    return { totalWarnings: 0, topCodes: [], hasFailures: false }
  }

  /**
   * 获取已接受提取列表——从本表读取（已实现）。
   */
  async getAcceptedExtractions(
    organizationId: number,
    projectId: number,
    sourceKind?: string,
    sourceId?: number,
    page?: number,
    perPage?: number,
  ): Promise<{
    data: OcrAcceptedExtractionSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const p = page ?? 1
    const pp = perPage ?? 20

    let query = OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('confirmed_at', 'desc')

    if (sourceKind) {
      query = query.where('source_kind', sourceKind)
    }
    if (sourceId) {
      query = query.where('source_id', sourceId)
    }

    const result = await query.paginate(p, pp)

    const data: OcrAcceptedExtractionSummary[] = result.all().map((e) => ({
      extractionId: e.id,
      sourceHash: e.sourceHash,
      candidateHash: e.candidateHash,
      selectedTextHash: e.selectedTextHash,
      pageRefs: e.pageRefsJson,
      status: e.status,
      reviewerId: e.reviewerId,
      reviewerName: null, // 需要 join user 表，后续优化
      reviewNote: e.reviewNote,
      confirmedAt: e.confirmedAt.toISO(),
      supersededAt: e.supersededAt?.toISO() ?? null,
    }))

    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * 推导审查作业状态——当前版本始终返回 'reviewable'（guarded）。
   */
  async deriveJobStatus(
    _jobId: number,
    _organizationId: number,
    _projectId: number,
  ): Promise<OcrReviewStatus> {
    // Guard: 上游未实现，返回降级状态
    return 'reviewable'
  }
}
