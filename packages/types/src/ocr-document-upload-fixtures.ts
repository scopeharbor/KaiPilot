// v3-ocr-document-upload-flow —— 共享 fixtures（前后端测试用）。

import type {
  OcrDocumentAcceptedExtraction,
  OcrDocumentCandidate,
  OcrDocumentJobDetail,
  OcrDocumentJobSummary,
  OcrDocumentPageResult,
  OcrDocumentWarning,
  OcrDocumentWarningCode,
  OcrDocumentCostSummary,
  OcrDocumentProviderUsage,
  OcrDocumentJobStatus,
  OcrDocumentPageStatus,
  OcrDocumentCandidateStatus,
  OcrDocumentSourceKind,
  OcrDocumentExtractionStatus,
  OcrNormalizedPage,
  OcrNormalizationResult,
  OcrNormalizationOutcome,
  OcrPdfPageManifest,
  OcrPdfProcessedPageRef,
  OcrPdfSkippedPageRef,
} from './ocr-document-upload.js'
import {
  computeSourceHash,
  computeCandidateTextHash,
  normalizeIdempotencyKey,
  buildPdfPageManifest,
} from './ocr-document-upload.js'

// ---------------------------------------------------------------------------
// 原子 builder
// ---------------------------------------------------------------------------

export function buildOcrProviderUsage(
  overrides?: Partial<OcrDocumentProviderUsage>,
): OcrDocumentProviderUsage {
  return {
    inputTokens: 1200,
    outputTokens: 450,
    totalTokens: 1650,
    ...overrides,
  }
}

export function buildOcrCostSummary(
  overrides?: Partial<OcrDocumentCostSummary>,
): OcrDocumentCostSummary {
  return {
    totalInputTokens: 3600,
    totalOutputTokens: 1350,
    totalTokens: 4950,
    estimatedCost: null,
    currency: null,
    ...overrides,
  }
}

export function buildOcrWarning(
  code: OcrDocumentWarningCode,
  overrides?: Partial<OcrDocumentWarning>,
): OcrDocumentWarning {
  return {
    code,
    message: `警告: ${code}`,
    pageIndex: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 页面结果
// ---------------------------------------------------------------------------

export function buildOcrPageResult(
  pageIndex: number,
  overrides?: Partial<OcrDocumentPageResult>,
): OcrDocumentPageResult {
  const sourceHash = computeSourceHash({
    attachmentId: 1,
    fileName: 'test-doc.pdf',
    mimeType: 'application/pdf',
    fileSize: 50000,
  })
  const candidateText = `第 ${pageIndex + 1} 页的提取文本内容。`
  return {
    id: 100 + pageIndex,
    jobId: 10,
    pageIndex,
    sourceHash,
    status: 'succeeded' as OcrDocumentPageStatus,
    mimeType: 'image/png',
    normalizedBytes: 45000,
    warnings: [],
    candidateId: 200 + pageIndex,
    candidateText,
    candidateHash: computeCandidateTextHash(candidateText),
    provider: 'openai',
    model: 'gpt-4o',
    usage: buildOcrProviderUsage(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildOcrFailedPageResult(
  pageIndex: number,
  overrides?: Partial<OcrDocumentPageResult>,
): OcrDocumentPageResult {
  return buildOcrPageResult(pageIndex, {
    status: 'failed' as OcrDocumentPageStatus,
    candidateText: null,
    candidateHash: null,
    candidateId: null,
    provider: null,
    model: null,
    usage: null,
    warnings: [buildOcrWarning('PROVIDER_UNAVAILABLE', { message: 'Provider 不可用' })],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 候选
// ---------------------------------------------------------------------------

export function buildOcrCandidate(
  pageIndex: number,
  overrides?: Partial<OcrDocumentCandidate>,
): OcrDocumentCandidate {
  const text = `候选文本 - 第 ${pageIndex + 1} 页`
  return {
    id: 200 + pageIndex,
    jobId: 10,
    pageId: 100 + pageIndex,
    status: 'ready' as OcrDocumentCandidateStatus,
    extractedText: text,
    textHash: computeCandidateTextHash(text),
    confidenceScore: 0.92,
    sourceHash: computeSourceHash({
      attachmentId: 1,
      fileName: 'doc.pdf',
      mimeType: 'application/pdf',
      fileSize: 50000,
    }),
    provider: 'openai',
    model: 'gpt-4o',
    warnings: [],
    usage: buildOcrProviderUsage(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 作业摘要 / 详情
// ---------------------------------------------------------------------------

export function buildOcrJobSummary(
  overrides?: Partial<OcrDocumentJobSummary>,
): OcrDocumentJobSummary {
  return {
    id: 10,
    organizationId: 1,
    projectId: 100,
    sourceKind: 'upload' as OcrDocumentSourceKind,
    sourceAttachmentId: 1,
    sourceFileName: 'test-doc.pdf',
    sourceMimeType: 'application/pdf',
    sourceHash: computeSourceHash({
      attachmentId: 1,
      fileName: 'test-doc.pdf',
      mimeType: 'application/pdf',
      fileSize: 50000,
    }),
    status: 'reviewable' as OcrDocumentJobStatus,
    pageCount: 3,
    succeededPages: 3,
    failedPages: 0,
    provider: 'openai',
    model: 'gpt-4o',
    warningCodes: [],
    costSummary: buildOcrCostSummary(),
    idempotencyKeyHash: normalizeIdempotencyKey('test-key-001'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildOcrJobDetail(overrides?: Partial<OcrDocumentJobDetail>): OcrDocumentJobDetail {
  const summary = buildOcrJobSummary()
  const pages = [buildOcrPageResult(0), buildOcrPageResult(1), buildOcrPageResult(2)]
  return {
    ...summary,
    connectionId: 5,
    modelId: 10,
    promptHint: '提取所有文字',
    inputSignature: 'abc123',
    pages,
    warnings: [],
    acceptedExtractionId: null,
    acceptedExtractionStatus: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 部分失败作业
// ---------------------------------------------------------------------------

export function buildOcrPartialFailureJobDetail(
  overrides?: Partial<OcrDocumentJobDetail>,
): OcrDocumentJobDetail {
  const pages = [buildOcrPageResult(0), buildOcrFailedPageResult(1), buildOcrPageResult(2)]
  return buildOcrJobDetail({
    status: 'reviewable',
    succeededPages: 2,
    failedPages: 1,
    warningCodes: ['PARTIAL_PAGE_FAILURE'],
    warnings: [
      buildOcrWarning('PARTIAL_PAGE_FAILURE', { message: '第 2 页 OCR 失败', pageIndex: 1 }),
    ],
    pages,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 失败作业
// ---------------------------------------------------------------------------

export function buildOcrFailedJobDetail(
  overrides?: Partial<OcrDocumentJobDetail>,
): OcrDocumentJobDetail {
  return buildOcrJobDetail({
    status: 'failed' as OcrDocumentJobStatus,
    succeededPages: 0,
    failedPages: 3,
    provider: null,
    model: null,
    costSummary: null,
    warningCodes: ['PROVIDER_UNAVAILABLE'],
    warnings: [buildOcrWarning('PROVIDER_UNAVAILABLE', { message: 'Provider 不可用' })],
    pages: [],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Stale 候选
// ---------------------------------------------------------------------------

export function buildOcrStaleCandidate(
  overrides?: Partial<OcrDocumentCandidate>,
): OcrDocumentCandidate {
  return buildOcrCandidate(0, {
    status: 'stale' as OcrDocumentCandidateStatus,
    sourceHash: computeSourceHash({
      attachmentId: 2,
      fileName: 'other.pdf',
      mimeType: 'application/pdf',
      fileSize: 99999,
    }),
    warnings: [buildOcrWarning('STALE_SOURCE', { message: '源文件已变更' })],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 权限拒绝状态
// ---------------------------------------------------------------------------

export function buildOcrPermissionDeniedJobSummary(
  overrides?: Partial<OcrDocumentJobSummary>,
): OcrDocumentJobSummary {
  return buildOcrJobSummary({
    status: 'failed' as OcrDocumentJobStatus,
    provider: null,
    model: null,
    costSummary: null,
    warningCodes: ['PERMISSION_DENIED'],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 已接受提取
// ---------------------------------------------------------------------------

export function buildOcrAcceptedExtraction(
  overrides?: Partial<OcrDocumentAcceptedExtraction>,
): OcrDocumentAcceptedExtraction {
  const text = '已接受的 OCR 提取文本'
  const sourceHash = computeSourceHash({
    attachmentId: 1,
    fileName: 'doc.pdf',
    mimeType: 'application/pdf',
    fileSize: 50000,
  })
  return {
    id: 300,
    jobId: 10,
    sourceAttachmentId: 1,
    acceptedText: text,
    acceptedTextHash: computeCandidateTextHash(text),
    pageRefs: [0, 1, 2],
    sourceHash,
    reviewerId: 1,
    reviewNote: '确认无误',
    status: 'active' as OcrDocumentExtractionStatus,
    supersededById: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildOcrSupersededExtraction(
  overrides?: Partial<OcrDocumentAcceptedExtraction>,
): OcrDocumentAcceptedExtraction {
  return buildOcrAcceptedExtraction({
    id: 301,
    status: 'superseded' as OcrDocumentExtractionStatus,
    supersededById: 302,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 图片作业（单页）
// ---------------------------------------------------------------------------

export function buildOcrImageJobDetail(
  overrides?: Partial<OcrDocumentJobDetail>,
): OcrDocumentJobDetail {
  const sourceHash = computeSourceHash({
    attachmentId: 2,
    fileName: 'screenshot.png',
    mimeType: 'image/png',
    fileSize: 120000,
  })
  const page = buildOcrPageResult(0, { sourceHash, mimeType: 'image/png' })
  return buildOcrJobDetail({
    sourceKind: 'upload',
    sourceAttachmentId: 2,
    sourceFileName: 'screenshot.png',
    sourceMimeType: 'image/png',
    sourceHash,
    pageCount: 1,
    succeededPages: 1,
    failedPages: 0,
    pages: [page],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// PDF 作业（多页）
// ---------------------------------------------------------------------------

export function buildOcrPdfJobDetail(
  overrides?: Partial<OcrDocumentJobDetail>,
): OcrDocumentJobDetail {
  return buildOcrJobDetail({
    sourceKind: 'attachment',
    sourceAttachmentId: 3,
    sourceFileName: 'report.pdf',
    sourceMimeType: 'application/pdf',
    sourceHash: computeSourceHash({
      attachmentId: 3,
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 200000,
    }),
    pageCount: 5,
    succeededPages: 5,
    pages: [
      buildOcrPageResult(0),
      buildOcrPageResult(1),
      buildOcrPageResult(2),
      buildOcrPageResult(3),
      buildOcrPageResult(4),
    ],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// PDF 清单 fixtures —— v3-ocr-multipage-pdf-support §2.6
// ---------------------------------------------------------------------------

export function buildOcrPdfProcessedPageRef(
  pageIndex: number,
  overrides?: Partial<OcrPdfProcessedPageRef>,
): OcrPdfProcessedPageRef {
  return {
    pageIndex,
    mimeType: 'image/png',
    sizeBytes: 45000,
    widthPixels: 800,
    heightPixels: 1200,
    ...overrides,
  }
}

export function buildOcrPdfSkippedPageRef(
  pageIndex: number,
  overrides?: Partial<OcrPdfSkippedPageRef>,
): OcrPdfSkippedPageRef {
  return {
    pageIndex,
    reason: 'PAGE_LIMIT_EXCEEDED',
    warning: buildOcrWarning('PAGE_OVERFLOW', {
      message: `第 ${pageIndex + 1} 页因 pageLimit 被跳过`,
      pageIndex,
    }),
    ...overrides,
  }
}

export function buildOcrNormalizedPage(
  pageIndex: number,
  overrides?: Partial<OcrNormalizedPage>,
): OcrNormalizedPage {
  return {
    pageIndex,
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,FAKE_PAGE_${pageIndex}`,
    sizeBytes: 45000,
    widthPixels: 800,
    heightPixels: 1200,
    ...overrides,
  }
}

export function buildOcrNormalizationResult(
  pageCount: number,
  overrides?: Partial<OcrNormalizationResult>,
): OcrNormalizationResult {
  const pages = Array.from({ length: pageCount }, (_, i) => buildOcrNormalizedPage(i))
  return {
    pages,
    totalPages: pageCount,
    skippedPages: 0,
    warnings: [],
    ...overrides,
  }
}

export function buildOcrNormalizationOutcome(pageCount: number): OcrNormalizationOutcome {
  return { ok: true, result: buildOcrNormalizationResult(pageCount) }
}

export function buildOcrNormalizationFailureOutcome(
  reason: string = 'PDF 归一化器不可用',
): OcrNormalizationOutcome {
  return {
    ok: false,
    failure: {
      reason: 'NORMALIZATION_FAILED',
      message: reason,
      warnings: [buildOcrWarning('PDF_NORMALIZER_UNAVAILABLE', { message: reason })],
    },
  }
}

/** 3 页成功 PDF manifest fixture */
export function buildPdfPageManifestFixture(
  overrides?: Partial<OcrPdfPageManifest>,
): OcrPdfPageManifest {
  const sourceHash = computeSourceHash({
    attachmentId: 1,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 200000,
  })
  const pages = [buildOcrNormalizedPage(0), buildOcrNormalizedPage(1), buildOcrNormalizedPage(2)]
  return buildPdfPageManifest({
    sourceHash,
    totalPages: 3,
    pageLimit: null,
    pages,
    skippedRefs: [],
    warnings: [],
    ...overrides,
  })
}

/** page-limit 截断 fixture：20 页 PDF，pageLimit=5 */
export function buildPdfPageLimitManifestFixture(): OcrPdfPageManifest {
  const sourceHash = computeSourceHash({
    attachmentId: 2,
    fileName: 'large-report.pdf',
    mimeType: 'application/pdf',
    fileSize: 500000,
  })
  const pages = Array.from({ length: 5 }, (_, i) => buildOcrNormalizedPage(i))
  const skippedRefs: OcrPdfSkippedPageRef[] = Array.from({ length: 15 }, (_, i) =>
    buildOcrPdfSkippedPageRef(i + 5),
  )
  return buildPdfPageManifest({
    sourceHash,
    totalPages: 20,
    pageLimit: 5,
    pages,
    skippedRefs,
    warnings: [
      buildOcrWarning('PAGE_OVERFLOW', {
        message: 'PDF 共 20 页，pageLimit=5，15 页被跳过',
      }),
    ],
  })
}
