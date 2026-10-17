/**
 * V3 OCR Review Confirmation Flow — 共享契约测试
 *
 * 覆盖 DTO 守卫、哈希确定性、陈旧检测、红线摘要、
 * 允许动作解析、脱敏和夹具的完整测试。
 */

import { describe, it, expect } from 'vitest'
import {
  OCR_REVIEW_STATUSES,
  OCR_SELECTION_MODES,
  OCR_CONFIRMATION_PREVIEW_STATUSES,
  OCR_ACCEPTED_EXTRACTION_STATUSES,
  OCR_REVIEW_ALLOWED_ACTIONS,
  OCR_STALE_REASONS,
  OCR_REVIEW_AUDIT_ACTIONS,
  isOcrReviewStatus,
  isOcrSelectionMode,
  isOcrConfirmationPreviewStatus,
  isOcrAcceptedExtractionStatus,
  isOcrReviewAllowedAction,
  isOcrStaleReason,
  computeSelectedTextHash,
  computePreviewHash,
  computeAcceptedExtractionHash,
  isSourceHashStale,
  resolveAllowedActions,
  buildRedlineSummary,
  redactAuditMetadata,
  buildAuditMetadata,
} from './ocr-review-confirmation.js'

import {
  buildSourceSummary,
  buildPageGroup,
  buildFailedPageGroup,
  buildCandidateItem,
  buildWarningSummary,
  buildAcceptedExtractionSummary,
  buildSupersededExtractionSummary,
  buildAcceptedExtractionDetail,
  buildReviewDetailResponse,
  buildPartialFailureResponse,
  buildReadOnlyResponse,
  buildStaleSourceResponse,
  buildConfirmationPreviewResponse,
  buildEmptySelectionRequest,
  buildInvalidPageSelectionRequest,
  buildHighConfidence,
  buildMediumConfidence,
  buildLowConfidence,
  buildUnknownConfidence,
} from './ocr-review-confirmation-fixtures.js'

// ─── 2.1 枚举 ──────────────────────────────────────────────────────────────

describe('OCR Review enums', () => {
  it('OCR_REVIEW_STATUSES has all expected values', () => {
    expect(OCR_REVIEW_STATUSES).toEqual([
      'reviewable',
      'partially_reviewable',
      'fully_accepted',
      'stale_source',
      'failed',
      'canceled',
    ])
  })

  it('OCR_SELECTION_MODES has full/partial/page', () => {
    expect(OCR_SELECTION_MODES).toEqual(['full', 'partial', 'page'])
  })

  it('OCR_CONFIRMATION_PREVIEW_STATUSES has ready/stale/invalid', () => {
    expect(OCR_CONFIRMATION_PREVIEW_STATUSES).toEqual(['ready', 'stale', 'invalid'])
  })

  it('OCR_ACCEPTED_EXTRACTION_STATUSES has current/superseded', () => {
    expect(OCR_ACCEPTED_EXTRACTION_STATUSES).toEqual(['current', 'superseded'])
  })

  it('OCR_REVIEW_ALLOWED_ACTIONS has 7 actions', () => {
    expect(OCR_REVIEW_ALLOWED_ACTIONS).toHaveLength(7)
    expect(OCR_REVIEW_ALLOWED_ACTIONS).toContain('view')
    expect(OCR_REVIEW_ALLOWED_ACTIONS).toContain('confirm')
    expect(OCR_REVIEW_ALLOWED_ACTIONS).toContain('supersede')
  })

  it('OCR_STALE_REASONS has 5 reasons', () => {
    expect(OCR_STALE_REASONS).toHaveLength(5)
    expect(OCR_STALE_REASONS).toContain('source_hash_mismatch')
  })

  it('OCR_REVIEW_AUDIT_ACTIONS has 8 actions', () => {
    expect(OCR_REVIEW_AUDIT_ACTIONS).toHaveLength(8)
    expect(OCR_REVIEW_AUDIT_ACTIONS).toContain('OCR_REVIEW_OPEN')
    expect(OCR_REVIEW_AUDIT_ACTIONS).toContain('OCR_REVIEW_CONFIRMATION_SAVED')
  })
})

// ─── 2.1 类型守卫 ──────────────────────────────────────────────────────────

describe('OCR Review type guards', () => {
  it('isOcrReviewStatus returns true for valid statuses', () => {
    expect(isOcrReviewStatus('reviewable')).toBe(true)
    expect(isOcrReviewStatus('stale_source')).toBe(true)
    expect(isOcrReviewStatus('invalid_status')).toBe(false)
    expect(isOcrReviewStatus(null)).toBe(false)
    expect(isOcrReviewStatus(123)).toBe(false)
  })

  it('isOcrSelectionMode returns true for valid modes', () => {
    expect(isOcrSelectionMode('full')).toBe(true)
    expect(isOcrSelectionMode('partial')).toBe(true)
    expect(isOcrSelectionMode('page')).toBe(true)
    expect(isOcrSelectionMode('invalid')).toBe(false)
  })

  it('isOcrConfirmationPreviewStatus guards correctly', () => {
    expect(isOcrConfirmationPreviewStatus('ready')).toBe(true)
    expect(isOcrConfirmationPreviewStatus('stale')).toBe(true)
    expect(isOcrConfirmationPreviewStatus('unknown')).toBe(false)
  })

  it('isOcrAcceptedExtractionStatus guards correctly', () => {
    expect(isOcrAcceptedExtractionStatus('current')).toBe(true)
    expect(isOcrAcceptedExtractionStatus('superseded')).toBe(true)
    expect(isOcrAcceptedExtractionStatus('deleted')).toBe(false)
  })

  it('isOcrReviewAllowedAction guards correctly', () => {
    expect(isOcrReviewAllowedAction('view')).toBe(true)
    expect(isOcrReviewAllowedAction('confirm')).toBe(true)
    expect(isOcrReviewAllowedAction('execute')).toBe(false)
  })

  it('isOcrStaleReason guards correctly', () => {
    expect(isOcrStaleReason('source_hash_mismatch')).toBe(true)
    expect(isOcrStaleReason('file_deleted')).toBe(true)
    expect(isOcrStaleReason('unknown')).toBe(false)
  })
})

// ─── 2.3 纯函数：哈希 ──────────────────────────────────────────────────────

describe('OCR Review hashing', () => {
  it('computeSelectedTextHash is deterministic', () => {
    const h1 = computeSelectedTextHash('Hello World')
    const h2 = computeSelectedTextHash('Hello World')
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(8)
  })

  it('computeSelectedTextHash normalizes line endings', () => {
    const h1 = computeSelectedTextHash('Line1\r\nLine2')
    const h2 = computeSelectedTextHash('Line1\nLine2')
    expect(h1).toBe(h2)
  })

  it('computeSelectedTextHash trims whitespace', () => {
    const h1 = computeSelectedTextHash('  text  ')
    const h2 = computeSelectedTextHash('text')
    expect(h1).toBe(h2)
  })

  it('computeSelectedTextHash different inputs give different hashes', () => {
    const h1 = computeSelectedTextHash('Text A')
    const h2 = computeSelectedTextHash('Text B')
    expect(h1).not.toBe(h2)
  })

  it('computePreviewHash is deterministic', () => {
    const h1 = computePreviewHash('src', 'cand', 'sel', [1, 2])
    const h2 = computePreviewHash('src', 'cand', 'sel', [1, 2])
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(8)
  })

  it('computePreviewHash page refs order matters', () => {
    const h1 = computePreviewHash('src', 'cand', 'sel', [1, 2])
    const h2 = computePreviewHash('src', 'cand', 'sel', [2, 1])
    expect(h1).not.toBe(h2)
  })

  it('computeAcceptedExtractionHash is deterministic', () => {
    const h1 = computeAcceptedExtractionHash('src', 'cand', 'sel', 42, '2024-01-01')
    const h2 = computeAcceptedExtractionHash('src', 'cand', 'sel', 42, '2024-01-01')
    expect(h1).toBe(h2)
  })
})

// ─── 2.3 纯函数：陈旧检测 ──────────────────────────────────────────────────

describe('Source freshness comparison', () => {
  it('isSourceHashStale returns false when hashes match', () => {
    expect(isSourceHashStale('abc123', 'abc123')).toBe(false)
  })

  it('isSourceHashStale returns true when hashes differ', () => {
    expect(isSourceHashStale('abc123', 'def456')).toBe(true)
  })

  it('isSourceHashStale returns true when current is null', () => {
    expect(isSourceHashStale(null, 'abc123')).toBe(true)
  })

  it('isSourceHashStale returns true when candidate is null', () => {
    expect(isSourceHashStale('abc123', null)).toBe(true)
  })

  it('isSourceHashStale returns true when both null', () => {
    expect(isSourceHashStale(null, null)).toBe(true)
  })
})

// ─── 2.3 纯函数：允许动作 ──────────────────────────────────────────────────

describe('Allowed actions resolution', () => {
  it('full permission non-stale returns all actions', () => {
    const actions = resolveAllowedActions({
      canView: true,
      canConfirm: true,
      isStale: false,
      hasCandidates: true,
      hasAcceptedExtractions: true,
    })
    expect(actions).toContain('view')
    expect(actions).toContain('select')
    expect(actions).toContain('preview_confirmation')
    expect(actions).toContain('confirm')
    expect(actions).toContain('supersede')
    expect(actions).toContain('copy')
    expect(actions).toContain('export')
  })

  it('read-only user only gets view/copy/export', () => {
    const actions = resolveAllowedActions({
      canView: true,
      canConfirm: false,
      isStale: false,
      hasCandidates: true,
      hasAcceptedExtractions: true,
    })
    expect(actions).toEqual(['view', 'select', 'copy', 'export'])
  })

  it('stale source blocks confirm/supersede/preview', () => {
    const actions = resolveAllowedActions({
      canView: true,
      canConfirm: true,
      isStale: true,
      hasCandidates: true,
      hasAcceptedExtractions: true,
    })
    expect(actions).not.toContain('confirm')
    expect(actions).not.toContain('supersede')
    expect(actions).not.toContain('preview_confirmation')
    expect(actions).toContain('view')
  })

  it('no candidates means no select action', () => {
    const actions = resolveAllowedActions({
      canView: true,
      canConfirm: true,
      isStale: false,
      hasCandidates: false,
      hasAcceptedExtractions: false,
    })
    expect(actions).not.toContain('select')
    expect(actions).toContain('view')
  })

  it('no view permission returns empty', () => {
    const actions = resolveAllowedActions({
      canView: false,
      canConfirm: false,
      isStale: false,
      hasCandidates: true,
      hasAcceptedExtractions: false,
    })
    expect(actions).toEqual([])
  })
})

// ─── 2.3 纯函数：红线 ──────────────────────────────────────────────────────

describe('Redline summary', () => {
  it('buildRedlineSummary returns all unchanged', () => {
    const summary = buildRedlineSummary()
    expect(summary.tasks).toBe('unchanged')
    expect(summary.wbs).toBe('unchanged')
    expect(summary.risks).toBe('unchanged')
    expect(summary.reports).toBe('unchanged')
    expect(summary.documentBody).toBe('unchanged')
    expect(summary.compilerArtifacts).toBe('unchanged')
    expect(summary.aiDrafts).toBe('unchanged')
    expect(summary.searchIndexes).toBe('unchanged')
    expect(summary.knowledgeBases).toBe('unchanged')
    expect(summary.externalSystems).toBe('unchanged')
    expect(Object.keys(summary)).toHaveLength(10)
  })
})

// ─── 2.4 纯函数：脱敏 ──────────────────────────────────────────────────────

describe('Audit redaction', () => {
  it('redactAuditMetadata removes api_key field', () => {
    const input = { actor: 1, api_key: 'secret123', org: 2 }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    expect(result.actor).toBe(1)
    expect(result.api_key).toBe('[REDACTED]')
    expect(result.org).toBe(2)
  })

  it('redactAuditMetadata removes authorization header', () => {
    const input = { Authorization: 'Bearer token', action: 'read' }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    expect(result.Authorization).toBe('[REDACTED]')
    expect(result.action).toBe('read')
  })

  it('redactAuditMetadata removes token/secret/password', () => {
    const input = { token: 'abc', secret: 'xyz', password: 'pw', data: 'ok' }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    expect(result.token).toBe('[REDACTED]')
    expect(result.secret).toBe('[REDACTED]')
    expect(result.password).toBe('[REDACTED]')
    expect(result.data).toBe('ok')
  })

  it('redactAuditMetadata removes prompt and dataUrl fields', () => {
    const input = { prompt_hint: 'read this', dataUrl: 'data:...', meta: 'safe' }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    expect(result.prompt_hint).toBe('[REDACTED]')
    expect(result.dataUrl).toBe('[REDACTED]')
    expect(result.meta).toBe('safe')
  })

  it('redactAuditMetadata handles nested objects', () => {
    const input = { outer: { api_key: 'nested_secret', safe: 42 } }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    const outer = result.outer as Record<string, unknown>
    expect(outer.api_key).toBe('[REDACTED]')
    expect(outer.safe).toBe(42)
  })

  it('redactAuditMetadata handles arrays', () => {
    const input = { items: [{ api_key: 'a' }, { safe: 'b' }] }
    const result = redactAuditMetadata(input) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items[0].api_key).toBe('[REDACTED]')
    expect(items[1].safe).toBe('b')
  })

  it('redactAuditMetadata passes through primitives', () => {
    expect(redactAuditMetadata(null)).toBe(null)
    expect(redactAuditMetadata(42)).toBe(42)
    expect(redactAuditMetadata('hello')).toBe('hello')
  })

  it('buildAuditMetadata excludes full text, keeps hashes', () => {
    const meta = buildAuditMetadata({
      actorId: 1,
      organizationId: 10,
      projectId: 100,
      sourceHash: 'src123',
      candidateHash: 'cand456',
      selectedTextHash: 'sel789',
      extractionId: 5,
      warningCodes: ['WARN1'],
      action: 'OCR_REVIEW_CONFIRMATION_SAVED',
    })
    expect(meta.actor).toBe(1)
    expect(meta.sourceHash).toBe('src123')
    expect(meta.candidateHash).toBe('cand456')
    expect(meta.selectedTextHash).toBe('sel789')
    expect(meta.extractionId).toBe(5)
    expect(meta.warningCodes).toEqual(['WARN1'])
    // 不应包含完整文本
    expect(meta.fullText).toBeUndefined()
    expect(meta.acceptedText).toBeUndefined()
  })

  it('buildAuditMetadata includes denial reason when present', () => {
    const meta = buildAuditMetadata({
      actorId: 1,
      organizationId: 10,
      projectId: 100,
      action: 'OCR_REVIEW_PERMISSION_DENIED',
      denialReason: '缺少 file:manage 权限',
    })
    expect(meta.denialReason).toBe('缺少 file:manage 权限')
  })
})

// ─── 2.5 夹具 ──────────────────────────────────────────────────────────────

describe('OCR Review fixtures', () => {
  it('buildSourceSummary creates valid source summary', () => {
    const s = buildSourceSummary()
    expect(s.sourceKind).toBe('attachment')
    expect(s.sourceHash).toBe('a1b2c3d4')
    expect(s.visible).toBe(true)
  })

  it('buildSourceSummary accepts overrides', () => {
    const s = buildSourceSummary({ sourceKind: 'document', sourceId: 42 })
    expect(s.sourceKind).toBe('document')
    expect(s.sourceId).toBe(42)
  })

  it('buildPageGroup creates page with defaults', () => {
    const pg = buildPageGroup(0)
    expect(pg.pageIndex).toBe(0)
    expect(pg.candidateStatus).toBe('succeeded')
    expect(pg.extractedText).toBeTruthy()
  })

  it('buildFailedPageGroup has null text', () => {
    const pg = buildFailedPageGroup(1)
    expect(pg.candidateStatus).toBe('failed')
    expect(pg.extractedText).toBeNull()
  })

  it('buildCandidateItem has expected fields', () => {
    const c = buildCandidateItem(3)
    expect(c.candidateId).toBe(3)
    expect(c.status).toBe('succeeded')
    expect(c.sourceHash).toBe('a1b2c3d4')
  })

  it('buildWarningSummary defaults to zero warnings', () => {
    const w = buildWarningSummary()
    expect(w.totalWarnings).toBe(0)
    expect(w.hasFailures).toBe(false)
  })

  it('buildAcceptedExtractionSummary creates current record', () => {
    const ae = buildAcceptedExtractionSummary(1)
    expect(ae.status).toBe('current')
    expect(ae.supersededAt).toBeNull()
  })

  it('buildSupersededExtractionSummary has superseded status', () => {
    const ae = buildSupersededExtractionSummary(2)
    expect(ae.status).toBe('superseded')
    expect(ae.supersededAt).toBeTruthy()
  })

  it('buildAcceptedExtractionDetail includes selectedText', () => {
    const ae = buildAcceptedExtractionDetail(1)
    expect(ae.selectedText).toBeTruthy()
    expect(ae.supersededById).toBeNull()
  })

  it('buildReviewDetailResponse has expected defaults', () => {
    const r = buildReviewDetailResponse()
    expect(r.jobStatus).toBe('reviewable')
    expect(r.pageGroups).toHaveLength(2)
    expect(r.allowedActions).toContain('confirm')
  })

  it('buildPartialFailureResponse has failed page', () => {
    const r = buildPartialFailureResponse()
    expect(r.jobStatus).toBe('partially_reviewable')
    expect(r.warningSummary.hasFailures).toBe(true)
    expect(r.pageGroups[1].candidateStatus).toBe('failed')
  })

  it('buildReadOnlyResponse only has view/copy/export', () => {
    const r = buildReadOnlyResponse()
    expect(r.allowedActions).toEqual(['view', 'copy', 'export'])
  })

  it('buildStaleSourceResponse has stale status', () => {
    const r = buildStaleSourceResponse()
    expect(r.jobStatus).toBe('stale_source')
    expect(r.staleReason).toBe('source_hash_mismatch')
  })

  it('buildConfirmationPreviewResponse has redline', () => {
    const p = buildConfirmationPreviewResponse()
    expect(p.requiresExplicitConfirmation).toBe(true)
    expect(p.redlineSummary.tasks).toBe('unchanged')
  })

  it('buildEmptySelectionRequest has empty text', () => {
    const s = buildEmptySelectionRequest()
    expect(s.selectedText).toBe('')
    expect(s.pageRefs).toEqual([])
  })

  it('buildInvalidPageSelectionRequest has invalid page', () => {
    const s = buildInvalidPageSelectionRequest()
    expect(s.pageRefs).toEqual([999])
    expect(s.selectedText).toBeTruthy()
  })

  it('confidence builders return correct levels', () => {
    expect(buildHighConfidence().level).toBe('high')
    expect(buildMediumConfidence().level).toBe('medium')
    expect(buildLowConfidence().level).toBe('low')
    expect(buildUnknownConfidence().level).toBe('unknown')
  })
})

// ─── 2.7 哈希稳定性和性能 ──────────────────────────────────────────────────

describe('Hash stability and performance', () => {
  it('computeSelectedTextHash is stable for 1000 calls', () => {
    const text = 'The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了懒狗。'
    const expected = computeSelectedTextHash(text)
    for (let i = 0; i < 1000; i++) {
      expect(computeSelectedTextHash(text)).toBe(expected)
    }
  })

  it('computePreviewHash is stable for large page arrays', () => {
    const pages = Array.from({ length: 100 }, (_, i) => i)
    const h1 = computePreviewHash('src', 'cand', 'sel', pages)
    const h2 = computePreviewHash('src', 'cand', 'sel', pages)
    expect(h1).toBe(h2)
  })

  it('hash performance is acceptable for 500 candidates', () => {
    const start = performance.now()
    for (let i = 0; i < 500; i++) {
      computeSelectedTextHash(`Candidate text ${i}: Some longer content for hashing purposes.`)
    }
    const elapsed = performance.now() - start
    // 500 hashes should complete well under 100ms
    expect(elapsed).toBeLessThan(100)
  })
})
