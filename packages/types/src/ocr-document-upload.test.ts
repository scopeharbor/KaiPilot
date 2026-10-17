// v3-ocr-document-upload-flow —— 共享契约层测试。
// 覆盖：枚举白名单、DTO 守卫、纯函数确定性/幂等、状态转换、stale 检测、脱敏。

import { describe, it, expect } from 'vitest'
import {
  OCR_DOCUMENT_JOB_STATUSES,
  OCR_DOCUMENT_PAGE_STATUSES,
  OCR_DOCUMENT_CANDIDATE_STATUSES,
  OCR_DOCUMENT_WARNING_CODES,
  OCR_DOCUMENT_SOURCE_KINDS,
  OCR_DOCUMENT_PROVIDER_ERROR_KINDS,
  OCR_DOCUMENT_EXTRACTION_STATUSES,
  OCR_DOCUMENT_SUPPORTED_MIME_TYPES,
  isOcrDocumentSupportedMimeType,
  isOcrDocumentImageMimeType,
  ocrDocFnv1aHash,
  computeSourceHash,
  normalizeIdempotencyKey,
  computeCandidateTextHash,
  computeAcceptedExtractionHash,
  computeInputSignature,
  isOcrJobTerminal,
  isOcrJobRetryable,
  isValidJobStatusTransition,
  isSourceHashStale,
  aggregateOcrWarnings,
  redactProviderSummary,
  redactOcrAuditMetadata,
  checkConfirmationPreconditions,
  buildCostSummary,
  OCR_JOB_TERMINAL_STATUSES,
  OCR_JOB_RETRYABLE_STATUSES,
  OCR_DOCUMENT_MAX_FILE_BYTES,
  OCR_DOCUMENT_MAX_PAGES,
  OCR_DOCUMENT_MAX_PAGE_BYTES,
  OCR_DOCUMENT_MAX_PAGE_PIXELS,
  OCR_DOCUMENT_PROVIDER_TIMEOUT_MS,
} from './ocr-document-upload.js'

import {
  buildOcrProviderUsage,
  buildOcrCostSummary,
  buildOcrWarning,
  buildOcrPageResult,
  buildOcrFailedPageResult,
  buildOcrCandidate,
  buildOcrJobSummary,
  buildOcrJobDetail,
  buildOcrPartialFailureJobDetail,
  buildOcrFailedJobDetail,
  buildOcrStaleCandidate,
  buildOcrPermissionDeniedJobSummary,
  buildOcrAcceptedExtraction,
  buildOcrSupersededExtraction,
  buildOcrImageJobDetail,
  buildOcrPdfJobDetail,
} from './ocr-document-upload-fixtures.js'

// ========================================================================
// 枚举白名单
// ========================================================================

describe('OCR document upload enums', () => {
  it('defines all expected job statuses', () => {
    expect(OCR_DOCUMENT_JOB_STATUSES).toContain('queued')
    expect(OCR_DOCUMENT_JOB_STATUSES).toContain('processing')
    expect(OCR_DOCUMENT_JOB_STATUSES).toContain('reviewable')
    expect(OCR_DOCUMENT_JOB_STATUSES).toContain('failed')
    expect(OCR_DOCUMENT_JOB_STATUSES).toContain('canceled')
  })

  it('defines terminal and retryable subsets', () => {
    for (const ts of OCR_JOB_TERMINAL_STATUSES) {
      expect(OCR_DOCUMENT_JOB_STATUSES).toContain(ts)
    }
    for (const rs of OCR_JOB_RETRYABLE_STATUSES) {
      expect(OCR_DOCUMENT_JOB_STATUSES).toContain(rs)
    }
  })

  it('defines all expected page statuses', () => {
    expect(OCR_DOCUMENT_PAGE_STATUSES).toContain('pending')
    expect(OCR_DOCUMENT_PAGE_STATUSES).toContain('succeeded')
    expect(OCR_DOCUMENT_PAGE_STATUSES).toContain('failed')
  })

  it('defines all expected candidate statuses', () => {
    expect(OCR_DOCUMENT_CANDIDATE_STATUSES).toContain('ready')
    expect(OCR_DOCUMENT_CANDIDATE_STATUSES).toContain('failed')
    expect(OCR_DOCUMENT_CANDIDATE_STATUSES).toContain('stale')
  })

  it('defines warning codes covering normalization and provider concerns', () => {
    expect(OCR_DOCUMENT_WARNING_CODES).toContain('LOW_CONFIDENCE')
    expect(OCR_DOCUMENT_WARNING_CODES).toContain('PDF_NORMALIZER_UNAVAILABLE')
    expect(OCR_DOCUMENT_WARNING_CODES).toContain('STALE_SOURCE')
    expect(OCR_DOCUMENT_WARNING_CODES).toContain('UNSUPPORTED_MIME')
  })

  it('defines source kinds', () => {
    expect(OCR_DOCUMENT_SOURCE_KINDS).toContain('upload')
    expect(OCR_DOCUMENT_SOURCE_KINDS).toContain('attachment')
  })

  it('defines provider error kinds', () => {
    expect(OCR_DOCUMENT_PROVIDER_ERROR_KINDS).toContain('AUTH_REQUIRED')
    expect(OCR_DOCUMENT_PROVIDER_ERROR_KINDS).toContain('MODEL_UNAVAILABLE')
    expect(OCR_DOCUMENT_PROVIDER_ERROR_KINDS).toContain('NORMALIZATION_FAILED')
  })

  it('defines extraction statuses', () => {
    expect(OCR_DOCUMENT_EXTRACTION_STATUSES).toContain('active')
    expect(OCR_DOCUMENT_EXTRACTION_STATUSES).toContain('superseded')
  })
})

// ========================================================================
// MIME 检查
// ========================================================================

describe('MIME type checks', () => {
  it('accepts supported image MIME types', () => {
    expect(isOcrDocumentSupportedMimeType('image/png')).toBe(true)
    expect(isOcrDocumentSupportedMimeType('image/jpeg')).toBe(true)
    expect(isOcrDocumentSupportedMimeType('image/webp')).toBe(true)
    expect(isOcrDocumentSupportedMimeType('application/pdf')).toBe(true)
  })

  it('rejects unsupported MIME types', () => {
    expect(isOcrDocumentSupportedMimeType('text/html')).toBe(false)
    expect(isOcrDocumentSupportedMimeType('application/zip')).toBe(false)
    expect(isOcrDocumentSupportedMimeType(null)).toBe(false)
    expect(isOcrDocumentSupportedMimeType(undefined)).toBe(false)
    expect(isOcrDocumentSupportedMimeType('')).toBe(false)
  })

  it('distinguishes image vs PDF', () => {
    expect(isOcrDocumentImageMimeType('image/png')).toBe(true)
    expect(isOcrDocumentImageMimeType('application/pdf')).toBe(false)
  })
})

// ========================================================================
// 哈希函数：确定性 + 唯一性
// ========================================================================

describe('Hash functions', () => {
  it('ocrDocFnv1aHash is deterministic', () => {
    expect(ocrDocFnv1aHash('hello')).toBe(ocrDocFnv1aHash('hello'))
    expect(ocrDocFnv1aHash('hello')).not.toBe(ocrDocFnv1aHash('world'))
  })

  it('ocrDocFnv1aHash produces non-empty hex', () => {
    const h = ocrDocFnv1aHash('test')
    expect(h).toBeTruthy()
    expect(h).toMatch(/^[0-9a-f]+$/)
  })

  it('computeSourceHash is deterministic', () => {
    const params = {
      attachmentId: 1,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
    }
    expect(computeSourceHash(params)).toBe(computeSourceHash(params))
  })

  it('computeSourceHash differs for different inputs', () => {
    const h1 = computeSourceHash({
      attachmentId: 1,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
    })
    const h2 = computeSourceHash({
      attachmentId: 2,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
    })
    expect(h1).not.toBe(h2)
  })

  it('normalizeIdempotencyKey trims and caps', () => {
    expect(normalizeIdempotencyKey(null)).toBeNull()
    expect(normalizeIdempotencyKey('  ')).toBeNull()
    expect(normalizeIdempotencyKey(' abc ')).toBe('abc')
    const long = 'x'.repeat(500)
    expect(normalizeIdempotencyKey(long)!.length).toBeLessThanOrEqual(256)
  })

  it('computeCandidateTextHash is deterministic', () => {
    expect(computeCandidateTextHash('abc')).toBe(computeCandidateTextHash('abc'))
    expect(computeCandidateTextHash('abc')).not.toBe(computeCandidateTextHash('def'))
  })

  it('computeAcceptedExtractionHash uses all inputs', () => {
    const h1 = computeAcceptedExtractionHash({
      textHash: 'a',
      sourceHash: 'b',
      pageRefs: [0, 1],
      reviewerId: 1,
    })
    const h2 = computeAcceptedExtractionHash({
      textHash: 'a',
      sourceHash: 'b',
      pageRefs: [0, 1],
      reviewerId: 2,
    })
    const h3 = computeAcceptedExtractionHash({
      textHash: 'a',
      sourceHash: 'b',
      pageRefs: [0, 2],
      reviewerId: 1,
    })
    expect(h1).not.toBe(h2)
    expect(h1).not.toBe(h3)
  })

  it('computeInputSignature is deterministic', () => {
    const params = {
      sourceKind: 'upload' as const,
      sourceAttachmentId: 5,
      modelId: 10,
      promptHint: 'ocr',
      pageLimit: 10,
    }
    expect(computeInputSignature(params)).toBe(computeInputSignature(params))
  })
})

// ========================================================================
// 状态转换
// ========================================================================

describe('Status transitions', () => {
  it('isOcrJobTerminal identifies terminal states', () => {
    expect(isOcrJobTerminal('reviewable')).toBe(true)
    expect(isOcrJobTerminal('failed')).toBe(true)
    expect(isOcrJobTerminal('canceled')).toBe(true)
    expect(isOcrJobTerminal('queued')).toBe(false)
    expect(isOcrJobTerminal('processing')).toBe(false)
  })

  it('isOcrJobRetryable allows retry from failed and reviewable', () => {
    expect(isOcrJobRetryable('failed')).toBe(true)
    expect(isOcrJobRetryable('reviewable')).toBe(true)
    expect(isOcrJobRetryable('queued')).toBe(false)
    expect(isOcrJobRetryable('canceled')).toBe(false)
  })

  it('isValidJobStatusTransition allows valid paths', () => {
    expect(isValidJobStatusTransition('queued', 'processing')).toBe(true)
    expect(isValidJobStatusTransition('processing', 'reviewable')).toBe(true)
    expect(isValidJobStatusTransition('processing', 'failed')).toBe(true)
    expect(isValidJobStatusTransition('failed', 'processing')).toBe(true)
    expect(isValidJobStatusTransition('reviewable', 'processing')).toBe(true)
    expect(isValidJobStatusTransition('canceled', 'processing')).toBe(false)
    expect(isValidJobStatusTransition('reviewable', 'canceled')).toBe(true) // can cancel reviewable
  })
})

// ========================================================================
// Stale 检测
// ========================================================================

describe('Stale detection', () => {
  it('isSourceHashStale detects mismatch', () => {
    expect(isSourceHashStale('abc', 'abc')).toBe(false)
    expect(isSourceHashStale('abc', 'def')).toBe(true)
    expect(isSourceHashStale('', 'abc')).toBe(true)
    expect(isSourceHashStale('abc', '')).toBe(true)
  })
})

// ========================================================================
// 警告聚合
// ========================================================================

describe('Warning aggregation', () => {
  it('aggregateOcrWarnings deduplicates and summarizes', () => {
    const w1 = buildOcrWarning('LOW_CONFIDENCE')
    const w2 = buildOcrWarning('LOW_CONFIDENCE')
    const w3 = buildOcrWarning('PDF_NORMALIZER_UNAVAILABLE')
    const result = aggregateOcrWarnings([w1, w2, w3])
    expect(result.codes).toHaveLength(2)
    expect(result.codes).toContain('LOW_CONFIDENCE')
    expect(result.summary).toContain('[LOW_CONFIDENCE]')
  })
})

// ========================================================================
// 脱敏
// ========================================================================

describe('Redaction', () => {
  it('redactProviderSummary hides secrets', () => {
    expect(redactProviderSummary('openai', 'gpt-4o')).toBe('openai/gpt-4o')
    expect(redactProviderSummary(null, null)).toBe('unknown')
  })

  it('redactOcrAuditMetadata strips sensitive keys', () => {
    const meta = {
      apiKey: 'sk-12345',
      prompt: 'extract text',
      fileName: 'doc.pdf',
      pageCount: 3,
    }
    const redacted = redactOcrAuditMetadata(meta)
    expect(redacted.apiKey).toBe('[REDACTED]')
    expect(redacted.prompt).toBe('[REDACTED]')
    expect(redacted.fileName).toBe('doc.pdf')
    expect(redacted.pageCount).toBe(3)
  })
})

// ========================================================================
// 确认前置条件
// ========================================================================

describe('Confirmation preconditions', () => {
  const validParams = {
    candidateStatus: 'ready' as const,
    candidateSourceHash: 'abc',
    currentSourceHash: 'abc',
    candidateBelongsToJobProject: true,
  }

  it('allows ready candidate with fresh source', () => {
    expect(checkConfirmationPreconditions(validParams).allowed).toBe(true)
  })

  it('blocks failed candidate', () => {
    const r = checkConfirmationPreconditions({ ...validParams, candidateStatus: 'failed' as const })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('blocks stale candidate status', () => {
    const r = checkConfirmationPreconditions({ ...validParams, candidateStatus: 'stale' as const })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('STALE_SOURCE')
  })

  it('blocks stale source hash', () => {
    const r = checkConfirmationPreconditions({
      ...validParams,
      candidateSourceHash: 'old',
      currentSourceHash: 'new',
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('STALE_SOURCE')
  })

  it('blocks cross-project candidate', () => {
    const r = checkConfirmationPreconditions({
      ...validParams,
      candidateBelongsToJobProject: false,
    })
    expect(r.allowed).toBe(false)
    expect(r.reasonCode).toBe('PERMISSION_DENIED')
  })
})

// ========================================================================
// 费用摘要
// ========================================================================

describe('Cost summary', () => {
  it('buildCostSummary aggregates usage', () => {
    const usages = [
      buildOcrProviderUsage(),
      buildOcrProviderUsage({ inputTokens: 800, outputTokens: 300, totalTokens: 1100 }),
    ]
    const summary = buildCostSummary(usages)
    expect(summary.totalInputTokens).toBe(2000)
    expect(summary.totalOutputTokens).toBe(750)
    expect(summary.totalTokens).toBe(2750)
  })
})

// ========================================================================
// 配置常量
// ========================================================================

describe('Configuration constants', () => {
  it('defines reasonable limits', () => {
    expect(OCR_DOCUMENT_MAX_FILE_BYTES).toBeGreaterThan(0)
    expect(OCR_DOCUMENT_MAX_PAGES).toBeGreaterThan(0)
    expect(OCR_DOCUMENT_MAX_PAGE_BYTES).toBeGreaterThan(0)
    expect(OCR_DOCUMENT_MAX_PAGE_PIXELS).toBeGreaterThan(0)
    expect(OCR_DOCUMENT_PROVIDER_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

// ========================================================================
// Fixture builders
// ========================================================================

describe('Fixture builders', () => {
  it('buildOcrPageResult creates valid page result', () => {
    const page = buildOcrPageResult(0)
    expect(page.pageIndex).toBe(0)
    expect(page.status).toBe('succeeded')
    expect(page.candidateText).toBeTruthy()
    expect(page.candidateHash).toBeTruthy()
  })

  it('buildOcrFailedPageResult creates failed page', () => {
    const page = buildOcrFailedPageResult(1)
    expect(page.status).toBe('failed')
    expect(page.candidateText).toBeNull()
    expect(page.warnings).toHaveLength(1)
  })

  it('buildOcrCandidate creates valid candidate', () => {
    const c = buildOcrCandidate(0)
    expect(c.status).toBe('ready')
    expect(c.extractedText).toBeTruthy()
    expect(c.textHash).toBeTruthy()
  })

  it('buildOcrJobSummary creates valid summary', () => {
    const job = buildOcrJobSummary()
    expect(job.status).toBe('reviewable')
    expect(job.organizationId).toBe(1)
    expect(job.projectId).toBe(100)
  })

  it('buildOcrJobDetail includes pages', () => {
    const job = buildOcrJobDetail()
    expect(job.pages).toHaveLength(3)
    expect(job.pages[0].jobId).toBe(10)
  })

  it('buildOcrPartialFailureJobDetail has mixed pages', () => {
    const job = buildOcrPartialFailureJobDetail()
    expect(job.succeededPages).toBe(2)
    expect(job.failedPages).toBe(1)
    expect(job.warningCodes).toContain('PARTIAL_PAGE_FAILURE')
  })

  it('buildOcrFailedJobDetail has no provider', () => {
    const job = buildOcrFailedJobDetail()
    expect(job.status).toBe('failed')
    expect(job.provider).toBeNull()
  })

  it('buildOcrStaleCandidate has stale status', () => {
    const c = buildOcrStaleCandidate()
    expect(c.status).toBe('stale')
    expect(c.warnings.some((w) => w.code === 'STALE_SOURCE')).toBe(true)
  })

  it('buildOcrPermissionDeniedJobSummary has failure state', () => {
    const job = buildOcrPermissionDeniedJobSummary()
    expect(job.status).toBe('failed')
    expect(job.warningCodes).toContain('PERMISSION_DENIED')
  })

  it('buildOcrAcceptedExtraction creates valid extraction', () => {
    const ex = buildOcrAcceptedExtraction()
    expect(ex.status).toBe('active')
    expect(ex.acceptedTextHash).toBeTruthy()
    expect(ex.pageRefs).toHaveLength(3)
  })

  it('buildOcrSupersededExtraction has superseded status', () => {
    const ex = buildOcrSupersededExtraction()
    expect(ex.status).toBe('superseded')
    expect(ex.supersededById).toBe(302)
  })

  it('buildOcrImageJobDetail is single page', () => {
    const job = buildOcrImageJobDetail()
    expect(job.sourceMimeType).toBe('image/png')
    expect(job.pageCount).toBe(1)
    expect(job.pages).toHaveLength(1)
  })

  it('buildOcrPdfJobDetail is multi page', () => {
    const job = buildOcrPdfJobDetail()
    expect(job.sourceMimeType).toBe('application/pdf')
    expect(job.pageCount).toBe(5)
    expect(job.pages).toHaveLength(5)
  })

  it('all fixtures accept overrides', () => {
    expect(buildOcrJobSummary({ projectId: 999 }).projectId).toBe(999)
    expect(buildOcrAcceptedExtraction({ acceptedText: 'custom' }).acceptedText).toBe('custom')
  })
})

// =============================================================================
// PDF 页面清单 —— v3-ocr-multipage-pdf-support §2.7
// =============================================================================

import {
  buildPdfPageManifest,
  computePdfManifestHash,
  computePdfInputSignature,
  validatePageLimit,
  collectSkippedPageWarnings,
} from './ocr-document-upload.js'

import {
  buildPdfPageManifestFixture,
  buildPdfPageLimitManifestFixture,
  buildOcrPdfProcessedPageRef,
  buildOcrPdfSkippedPageRef,
  buildOcrNormalizedPage,
  buildOcrNormalizationResult,
  buildOcrNormalizationOutcome,
  buildOcrNormalizationFailureOutcome,
} from './ocr-document-upload-fixtures.js'
import type { OcrPdfPageManifest, OcrPdfSkippedPageRef } from './ocr-document-upload.js'

describe('PDF page manifest', () => {
  // -----------------------------------------------------------------------
  // DTO 守卫
  // -----------------------------------------------------------------------
  it('builds valid processed page ref', () => {
    const ref = buildOcrPdfProcessedPageRef(0)
    expect(ref.pageIndex).toBe(0)
    expect(ref.mimeType).toBe('image/png')
    expect(ref.sizeBytes).toBeGreaterThan(0)
  })

  it('builds valid skipped page ref', () => {
    const ref = buildOcrPdfSkippedPageRef(3)
    expect(ref.pageIndex).toBe(3)
    expect(ref.reason).toBe('PAGE_LIMIT_EXCEEDED')
    expect(ref.warning.code).toBe('PAGE_OVERFLOW')
  })

  // -----------------------------------------------------------------------
  // Manifest 确定性
  // -----------------------------------------------------------------------
  it('computePdfManifestHash is deterministic', () => {
    const m1 = buildPdfPageManifestFixture()
    const m2 = buildPdfPageManifestFixture()
    expect(computePdfManifestHash(m1)).toBe(computePdfManifestHash(m2))
  })

  it('manifest hash changes when page count changes', () => {
    const m1 = buildPdfPageManifestFixture()
    const m2 = buildPdfPageManifestFixture({ totalPages: 5 })
    expect(computePdfManifestHash(m1)).not.toBe(computePdfManifestHash(m2))
  })

  it('manifest hash changes when source hash changes', () => {
    const m1 = buildPdfPageManifestFixture()
    const m2 = buildPdfPageManifestFixture({
      sourceHash: computeSourceHash({
        attachmentId: 999,
        fileName: 'other.pdf',
        mimeType: 'application/pdf',
        fileSize: 100,
      }),
    })
    expect(computePdfManifestHash(m1)).not.toBe(computePdfManifestHash(m2))
  })

  it('manifest hash changes when page limit changes', () => {
    const m1 = buildPdfPageManifestFixture({ pageLimit: null })
    const m2 = buildPdfPageManifestFixture({ pageLimit: 5 })
    expect(computePdfManifestHash(m1)).not.toBe(computePdfManifestHash(m2))
  })

  // -----------------------------------------------------------------------
  // buildPdfPageManifest
  // -----------------------------------------------------------------------
  it('buildPdfPageManifest includes all processed refs', () => {
    const manifest = buildPdfPageManifestFixture()
    expect(manifest.processedRefs).toHaveLength(3)
    expect(manifest.processedRefs[0].pageIndex).toBe(0)
    expect(manifest.processedRefs[2].pageIndex).toBe(2)
    expect(manifest.manifestHash).toBeTruthy()
  })

  it('buildPdfPageManifest records skipped pages', () => {
    const manifest = buildPdfPageLimitManifestFixture()
    expect(manifest.totalPages).toBe(20)
    expect(manifest.pageLimit).toBe(5)
    expect(manifest.processedRefs).toHaveLength(5)
    expect(manifest.skippedRefs).toHaveLength(15)
    expect(manifest.skippedRefs[0].pageIndex).toBe(5)
    expect(manifest.skippedRefs[14].pageIndex).toBe(19)
  })

  // -----------------------------------------------------------------------
  // validatePageLimit
  // -----------------------------------------------------------------------
  it('validatePageLimit allows null', () => {
    const result = validatePageLimit(null, 50)
    expect(result.allowed).toBe(true)
    expect(result.effectiveLimit).toBe(0)
    expect(result.warning).toBeUndefined()
  })

  it('validatePageLimit truncates oversize', () => {
    const result = validatePageLimit(100, 50)
    expect(result.allowed).toBe(true)
    expect(result.effectiveLimit).toBe(50)
    expect(result.warning).toBeDefined()
    expect(result.warning!.code).toBe('PAGE_OVERFLOW')
  })

  it('validatePageLimit accepts valid limit', () => {
    const result = validatePageLimit(5, 50)
    expect(result.allowed).toBe(true)
    expect(result.effectiveLimit).toBe(5)
    expect(result.warning).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // collectSkippedPageWarnings
  // -----------------------------------------------------------------------
  it('collectSkippedPageWarnings aggregates all warnings', () => {
    const skipped: OcrPdfSkippedPageRef[] = [
      buildOcrPdfSkippedPageRef(5),
      buildOcrPdfSkippedPageRef(6, {
        reason: 'RASTERIZATION_FAILED',
        warning: buildOcrWarning('MALFORMED_FILE', { message: '渲染失败', pageIndex: 6 }),
      }),
    ]
    const warnings = collectSkippedPageWarnings(skipped)
    expect(warnings).toHaveLength(2)
    expect(warnings[0].code).toBe('PAGE_OVERFLOW')
    expect(warnings[1].code).toBe('MALFORMED_FILE')
  })

  // -----------------------------------------------------------------------
  // computePdfInputSignature
  // -----------------------------------------------------------------------
  it('computePdfInputSignature includes manifestHash', () => {
    const sig1 = computePdfInputSignature({
      sourceKind: 'upload',
      sourceAttachmentId: 1,
      pageLimit: 5,
      manifestHash: 'abc123',
    })
    const sig2 = computePdfInputSignature({
      sourceKind: 'upload',
      sourceAttachmentId: 1,
      pageLimit: 5,
      manifestHash: 'def456',
    })
    expect(sig1).not.toBe(sig2)
  })

  // -----------------------------------------------------------------------
  // Normalization fixtures
  // -----------------------------------------------------------------------
  it('buildOcrNormalizationResult produces correct page count', () => {
    const result = buildOcrNormalizationResult(3)
    expect(result.totalPages).toBe(3)
    expect(result.pages).toHaveLength(3)
  })

  it('buildOcrNormalizationOutcome wraps ok=true', () => {
    const outcome = buildOcrNormalizationOutcome(2)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result.totalPages).toBe(2)
  })

  it('buildOcrNormalizationFailureOutcome wraps ok=false', () => {
    const outcome = buildOcrNormalizationFailureOutcome()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.failure.warnings[0].code).toBe('PDF_NORMALIZER_UNAVAILABLE')
  })
})
