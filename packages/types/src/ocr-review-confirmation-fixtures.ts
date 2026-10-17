/**
 * OCR Review Confirmation Flow — 测试夹具构建器
 *
 * 提供完整的审查作业、部分失败、只读降级、陈旧来源、无效选择、
 * 确认预览、已接受提取历史和超集记录的夹具。
 */

import type {
  OcrReviewSourceSummary,
  OcrReviewPageGroup,
  OcrReviewCandidateItem,
  OcrReviewWarningSummary,
  OcrReviewDetailResponse,
  OcrAcceptedExtractionSummary,
  OcrAcceptedExtractionDetail,
  OcrConfirmationPreviewResponse,
  OcrReviewConfidenceSummary as OcrConfidenceSummary,
} from './ocr-review-confirmation.js'

// ─── 置信度 ────────────────────────────────────────────────────────────────

export function buildHighConfidence(): OcrConfidenceSummary {
  return { level: 'high', label: '高置信度' }
}

export function buildMediumConfidence(): OcrConfidenceSummary {
  return { level: 'medium', label: '中置信度' }
}

export function buildLowConfidence(): OcrConfidenceSummary {
  return { level: 'low', label: '低置信度' }
}

export function buildUnknownConfidence(): OcrConfidenceSummary {
  return { level: 'unknown', label: '未知' }
}

// ─── 来源摘要 ──────────────────────────────────────────────────────────────

export function buildSourceSummary(
  overrides: Partial<OcrReviewSourceSummary> = {},
): OcrReviewSourceSummary {
  return {
    sourceKind: 'attachment',
    sourceId: 1,
    sourceName: 'test-document.pdf',
    sourceHash: 'a1b2c3d4',
    sourceVersion: 1,
    mimeType: 'application/pdf',
    visible: true,
    ...overrides,
  }
}

// ─── 页面分组 ──────────────────────────────────────────────────────────────

export function buildPageGroup(
  pageIndex: number,
  overrides: Partial<OcrReviewPageGroup> = {},
): OcrReviewPageGroup {
  return {
    pageIndex,
    pageLabel: `第 ${pageIndex + 1} 页`,
    candidateStatus: 'succeeded',
    candidateHash: `page_hash_${pageIndex}`,
    extractedText: `这是第 ${pageIndex + 1} 页的 OCR 提取文本。`,
    confidenceSummary: buildHighConfidence(),
    warningCodes: [],
    providerModel: 'gpt-4o',
    completedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildFailedPageGroup(pageIndex: number): OcrReviewPageGroup {
  return buildPageGroup(pageIndex, {
    candidateStatus: 'failed',
    candidateHash: null,
    extractedText: null,
    confidenceSummary: null,
    warningCodes: ['PROVIDER_TIMEOUT'],
  })
}

// ─── 候选审查项 ────────────────────────────────────────────────────────────

export function buildCandidateItem(
  candidateId: number,
  overrides: Partial<OcrReviewCandidateItem> = {},
): OcrReviewCandidateItem {
  return {
    candidateId,
    pageRefs: [candidateId],
    candidateHash: `candidate_hash_${candidateId}`,
    sourceHash: 'a1b2c3d4',
    status: 'succeeded',
    extractedText: `候选 ${candidateId} 的提取文本内容。`,
    warningCodes: [],
    confidenceSummary: buildHighConfidence(),
    providerModel: 'gpt-4o',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── 警告摘要 ──────────────────────────────────────────────────────────────

export function buildWarningSummary(
  overrides: Partial<OcrReviewWarningSummary> = {},
): OcrReviewWarningSummary {
  return {
    totalWarnings: 0,
    topCodes: [],
    hasFailures: false,
    ...overrides,
  }
}

// ─── 已接受提取 ────────────────────────────────────────────────────────────

export function buildAcceptedExtractionSummary(
  extractionId: number,
  overrides: Partial<OcrAcceptedExtractionSummary> = {},
): OcrAcceptedExtractionSummary {
  return {
    extractionId,
    sourceHash: 'a1b2c3d4',
    candidateHash: `candidate_hash_${extractionId}`,
    selectedTextHash: `selected_hash_${extractionId}`,
    pageRefs: [extractionId],
    status: 'current',
    reviewerId: 1,
    reviewerName: '测试用户',
    reviewNote: null,
    confirmedAt: new Date().toISOString(),
    supersededAt: null,
    ...overrides,
  }
}

export function buildSupersededExtractionSummary(
  extractionId: number,
): OcrAcceptedExtractionSummary {
  return buildAcceptedExtractionSummary(extractionId, {
    status: 'superseded',
    supersededAt: new Date().toISOString(),
  })
}

export function buildAcceptedExtractionDetail(
  extractionId: number,
  overrides: Partial<OcrAcceptedExtractionDetail> = {},
): OcrAcceptedExtractionDetail {
  return {
    ...buildAcceptedExtractionSummary(extractionId),
    selectedText: `已接受的提取文本 ${extractionId}`,
    supersededById: null,
    ...overrides,
  }
}

// ─── 完整审查响应 ──────────────────────────────────────────────────────────

export function buildReviewDetailResponse(
  overrides: Partial<OcrReviewDetailResponse> = {},
): OcrReviewDetailResponse {
  return {
    sourceSummary: buildSourceSummary(),
    jobStatus: 'reviewable',
    jobId: 1,
    providerLabel: 'OpenAI',
    modelLabel: 'gpt-4o',
    pageGroups: [buildPageGroup(0), buildPageGroup(1)],
    candidateItems: [buildCandidateItem(0), buildCandidateItem(1)],
    warningSummary: buildWarningSummary(),
    acceptedExtractions: [],
    allowedActions: ['view', 'select', 'preview_confirmation', 'confirm'],
    staleReason: null,
    ...overrides,
  }
}

/** 部分失败的审查响应 */
export function buildPartialFailureResponse(): OcrReviewDetailResponse {
  return buildReviewDetailResponse({
    jobStatus: 'partially_reviewable',
    pageGroups: [buildPageGroup(0), buildFailedPageGroup(1)],
    warningSummary: buildWarningSummary({
      totalWarnings: 1,
      topCodes: ['PROVIDER_TIMEOUT'],
      hasFailures: true,
    }),
  })
}

/** 只读降级的审查响应 */
export function buildReadOnlyResponse(): OcrReviewDetailResponse {
  return buildReviewDetailResponse({
    allowedActions: ['view', 'copy', 'export'],
  })
}

/** 陈旧来源的审查响应 */
export function buildStaleSourceResponse(): OcrReviewDetailResponse {
  return buildReviewDetailResponse({
    jobStatus: 'stale_source',
    staleReason: 'source_hash_mismatch',
    allowedActions: ['view'],
  })
}

// ─── 确认预览响应 ──────────────────────────────────────────────────────────

export function buildConfirmationPreviewResponse(
  overrides: Partial<OcrConfirmationPreviewResponse> = {},
): OcrConfirmationPreviewResponse {
  return {
    previewHash: 'preview_hash_01',
    sourceHash: 'a1b2c3d4',
    candidateHash: 'candidate_hash_0',
    selectedTextHash: 'selected_hash_0',
    selectedText: '候选 0 的提取文本内容。',
    pageRefs: [0],
    redlineSummary: {
      tasks: 'unchanged',
      wbs: 'unchanged',
      risks: 'unchanged',
      reports: 'unchanged',
      documentBody: 'unchanged',
      compilerArtifacts: 'unchanged',
      aiDrafts: 'unchanged',
      searchIndexes: 'unchanged',
      knowledgeBases: 'unchanged',
      externalSystems: 'unchanged',
    },
    requiresExplicitConfirmation: true,
    ...overrides,
  }
}

// ─── 无效选择 ──────────────────────────────────────────────────────────────

export function buildEmptySelectionRequest() {
  return {
    candidateId: 0,
    mode: 'full' as const,
    selectedText: '',
    pageRefs: [],
  }
}

export function buildInvalidPageSelectionRequest() {
  return {
    candidateId: 0,
    mode: 'page' as const,
    selectedText: '有效文本',
    pageRefs: [999], // 不存在的页面
  }
}
