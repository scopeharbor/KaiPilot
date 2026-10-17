/**
 * V3 OCR UI In Documents — 共享契约与纯函数测试
 *
 * 覆盖最新作业选择、状态派生、动作解析、脱敏和稳定排序。
 */

import { describe, it, expect } from 'vitest'
import {
  selectLatestOcrJobForSource,
  deriveOcrDocumentWorkspaceStatus,
  resolveOcrDocumentWorkspaceActions,
  isOcrSupportedMime,
  redactSourceTitle,
  redactOcrTextCount,
  redactWarningMetadata,
  redactDenialReason,
  sortOcrWorkspaceRows,
  filterOcrWorkspaceRows,
  isOcrDocumentWorkspaceStatus,
  isOcrDocumentWorkspaceAction,
  isOcrDocumentWorkspaceBlockReason,
  getStatusSortWeight,
} from './ocr-ui-in-documents.js'
import {
  buildOcrJobFixture,
  buildWorkspaceRowSummary,
  unsupportedRow,
  noJobRow,
  queuedRow,
  processingRow,
  failedRow,
  reviewableRow,
  confirmedRow,
  staleRow,
  retentionHoldRow,
  privacyBlockRow,
  readOnlyDegradedRow,
  multiJobFixtures,
  largeWorkspaceRows,
} from './ocr-ui-in-documents-fixtures.js'
import type { OcrDocumentJobSummary } from './ocr-document-upload.js'
import type {
  OcrDocumentWorkspaceRowSummary,
  OcrDocumentWorkspaceStatus,
  OcrDocumentWorkspaceAction,
  OcrDocumentWorkspaceBlockReason,
  OcrDocumentWorkspaceFilters,
  OcrDocumentWorkspaceSortConfig,
} from './ocr-ui-in-documents.js'

// =========================================================================
// isOcrSupportedMime
// =========================================================================

describe('isOcrSupportedMime', () => {
  it('supports PDF', () => {
    expect(isOcrSupportedMime('application/pdf')).toBe(true)
  })

  it.each(['image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'image/webp'])(
    'supports image %s',
    (mime) => {
      expect(isOcrSupportedMime(mime)).toBe(true)
    },
  )

  it.each(['image/svg+xml', 'application/msword', 'text/plain', 'video/mp4', null])(
    'rejects %s',
    (mime) => {
      expect(isOcrSupportedMime(mime)).toBe(false)
    },
  )
})

// =========================================================================
// selectLatestOcrJobForSource
// =========================================================================

describe('selectLatestOcrJobForSource', () => {
  it('returns null for empty jobs', () => {
    expect(selectLatestOcrJobForSource([], 1)).toBeNull()
  })

  it('returns null when no job matches sourceAttachmentId', () => {
    const jobs = [buildOcrJobFixture({ sourceAttachmentId: 99 })]
    expect(selectLatestOcrJobForSource(jobs, 1)).toBeNull()
  })

  it('returns the single matching job', () => {
    const job = buildOcrJobFixture({ sourceAttachmentId: 1 })
    const result = selectLatestOcrJobForSource([job], 1)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(job.id)
  })

  it('selects by updatedAt recency among multiple matches', () => {
    const jobs = multiJobFixtures()
    const result = selectLatestOcrJobForSource(jobs, 500)
    expect(result).not.toBeNull()
    // 最新的作业应该有最新的 updatedAt
    expect(result!.id).toBe(12) // id=12 updatedAt 最晚
  })

  it('ties on updatedAt resolved by createdAt', () => {
    const sameTime = '2026-07-10T10:00:00.000Z'
    const older = buildOcrJobFixture({
      id: 50,
      sourceAttachmentId: 10,
      updatedAt: sameTime,
      createdAt: '2026-07-09T10:00:00.000Z',
    })
    const newer = buildOcrJobFixture({
      id: 51,
      sourceAttachmentId: 10,
      updatedAt: sameTime,
      createdAt: '2026-07-10T10:00:00.000Z',
    })
    const result = selectLatestOcrJobForSource([older, newer], 10)
    expect(result!.id).toBe(51)
  })

  it('ties on updatedAt and createdAt resolved by id desc', () => {
    const sameTime = '2026-07-10T10:00:00.000Z'
    const a = buildOcrJobFixture({
      id: 60,
      sourceAttachmentId: 20,
      updatedAt: sameTime,
      createdAt: sameTime,
    })
    const b = buildOcrJobFixture({
      id: 61,
      sourceAttachmentId: 20,
      updatedAt: sameTime,
      createdAt: sameTime,
    })
    const result = selectLatestOcrJobForSource([a, b], 20)
    expect(result!.id).toBe(61)
  })
})

// =========================================================================
// deriveOcrDocumentWorkspaceStatus
// =========================================================================

describe('deriveOcrDocumentWorkspaceStatus', () => {
  it('returns unsupported for non-supported MIME', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: false,
        job: null,
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('unsupported')
  })

  it('returns no_job when supported but no job', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: null,
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('no_job')
  })

  it('returns queued for queued job', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'queued' }),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('queued')
  })

  it('returns processing for processing job', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'processing' }),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('processing')
  })

  it('returns failed for failed job', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'failed' }),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('failed')
  })

  it('returns failed for canceled job', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'canceled' }),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('failed')
  })

  it('returns reviewable when job is reviewable and not stale', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'reviewable' }),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('reviewable')
  })

  it('returns stale when reviewable but source is stale', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'reviewable' }),
        isStale: true,
        hasAcceptedExtraction: false,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('stale')
  })

  it('returns confirmed when has accepted extraction', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture({ status: 'reviewable' }),
        isStale: false,
        hasAcceptedExtraction: true,
        blockReason: null,
        reviewStatus: null,
      }),
    ).toBe('confirmed')
  })

  it('returns blocked for privacy_block', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture(),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: 'privacy_block',
        reviewStatus: null,
      }),
    ).toBe('blocked')
  })

  it('returns blocked for retention_hold', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture(),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: 'retention_hold',
        reviewStatus: null,
      }),
    ).toBe('blocked')
  })

  it('returns degraded for permission_denied', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture(),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: 'permission_denied',
        reviewStatus: null,
      }),
    ).toBe('degraded')
  })

  it('returns unsupported for unsupported_mime block', () => {
    expect(
      deriveOcrDocumentWorkspaceStatus({
        isSupported: true,
        job: buildOcrJobFixture(),
        isStale: false,
        hasAcceptedExtraction: false,
        blockReason: 'unsupported_mime',
        reviewStatus: null,
      }),
    ).toBe('unsupported')
  })
})

// =========================================================================
// resolveOcrDocumentWorkspaceActions
// =========================================================================

describe('resolveOcrDocumentWorkspaceActions', () => {
  const base = {
    isSupported: true,
    isReadOnly: false,
    hasAcceptedExtraction: false,
    downstreamEligible: false,
    blockReason: null as OcrDocumentWorkspaceBlockReason | null,
  }

  it('returns only view_governance for read-only users', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'reviewable',
      isReadOnly: true,
    })
    expect(actions).toEqual(['view_governance'])
  })

  it('returns only view_governance when blocked', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'blocked',
      blockReason: 'retention_hold',
    })
    expect(actions).toEqual(['view_governance'])
  })

  it('returns create_ocr for no_job', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'no_job',
    })
    expect(actions).toContain('create_ocr')
  })

  it('returns review for reviewable', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'reviewable',
    })
    expect(actions).toContain('review')
    expect(actions).toContain('retry_ocr')
  })

  it('returns downstream actions for confirmed with downstream eligible', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'confirmed',
      hasAcceptedExtraction: true,
      downstreamEligible: true,
    })
    expect(actions).toContain('search_index')
    expect(actions).toContain('structured_extraction')
    expect(actions).toContain('entity_linking')
    expect(actions).toContain('export')
    expect(actions).toContain('copy')
  })

  it('returns empty for unsupported', () => {
    const actions = resolveOcrDocumentWorkspaceActions({
      ...base,
      status: 'unsupported',
      isSupported: false,
    })
    expect(actions).toEqual([])
  })
})

// =========================================================================
// Redaction helpers
// =========================================================================

describe('redactSourceTitle', () => {
  it('returns original name when not hidden', () => {
    expect(
      redactSourceTitle({
        sourceKind: 'attachment',
        isHidden: false,
        originalFileName: 'report.pdf',
      }),
    ).toBe('report.pdf')
  })

  it('returns generic label when hidden', () => {
    expect(
      redactSourceTitle({
        sourceKind: 'attachment',
        isHidden: true,
        originalFileName: 'secret-report.pdf',
      }),
    ).toBe('附件')
  })

  it('returns fallback for null filename', () => {
    expect(
      redactSourceTitle({
        sourceKind: 'upload',
        isHidden: false,
        originalFileName: null,
      }),
    ).toBe('未命名文件')
  })
})

describe('redactOcrTextCount', () => {
  it('returns null when privacy blocked', () => {
    expect(redactOcrTextCount({ isPrivacyBlocked: true, textCount: 500 })).toBeNull()
  })

  it('returns count when not blocked', () => {
    expect(redactOcrTextCount({ isPrivacyBlocked: false, textCount: 500 })).toBe(500)
  })
})

describe('redactWarningMetadata', () => {
  it('returns empty array when hidden', () => {
    expect(
      redactWarningMetadata({
        isHidden: true,
        warningCodes: ['LOW_CONFIDENCE', 'PROVIDER_UNAVAILABLE'],
      }),
    ).toEqual([])
  })

  it('returns original when visible', () => {
    const codes = ['LOW_CONFIDENCE'] as const
    expect(redactWarningMetadata({ isHidden: false, warningCodes: [...codes] })).toEqual(codes)
  })
})

describe('redactDenialReason', () => {
  it('returns generic when hidden', () => {
    expect(redactDenialReason({ blockReason: 'privacy_block', isHidden: true })).toBe('源不可访问')
  })

  it('returns low-sensitive label for retention_hold', () => {
    expect(redactDenialReason({ blockReason: 'retention_hold', isHidden: false })).toBe(
      '保留策略限制',
    )
  })

  it('returns low-sensitive label for privacy_block', () => {
    expect(redactDenialReason({ blockReason: 'privacy_block', isHidden: false })).toBe(
      '隐私策略限制',
    )
  })
})

// =========================================================================
// Type guards
// =========================================================================

describe('type guards', () => {
  it.each([
    'unsupported',
    'no_job',
    'queued',
    'processing',
    'failed',
    'reviewable',
    'confirmed',
    'stale',
    'blocked',
    'degraded',
  ])('isOcrDocumentWorkspaceStatus returns true for %s', (status) => {
    expect(isOcrDocumentWorkspaceStatus(status)).toBe(true)
  })

  it('isOcrDocumentWorkspaceStatus returns false for unknown', () => {
    expect(isOcrDocumentWorkspaceStatus('unknown_status')).toBe(false)
  })

  it.each([
    'create_ocr',
    'retry_ocr',
    'review',
    'confirm',
    'search_index',
    'structured_extraction',
    'entity_linking',
    'export',
    'copy',
    'cleanup',
    'view_governance',
  ])('isOcrDocumentWorkspaceAction returns true for %s', (action) => {
    expect(isOcrDocumentWorkspaceAction(action)).toBe(true)
  })

  it('isOcrDocumentWorkspaceBlockReason returns true for valid reasons', () => {
    expect(isOcrDocumentWorkspaceBlockReason('retention_hold')).toBe(true)
    expect(isOcrDocumentWorkspaceBlockReason('privacy_block')).toBe(true)
  })
})

// =========================================================================
// sortOcrWorkspaceRows
// =========================================================================

describe('sortOcrWorkspaceRows', () => {
  const rows = [queuedRow(), noJobRow(), reviewableRow(), failedRow(), confirmedRow()]

  it('sorts by status ascending', () => {
    const sorted = sortOcrWorkspaceRows(rows, {
      field: 'status',
      direction: 'asc',
    })
    expect(sorted[0].status).toBe('reviewable')
    expect(sorted[sorted.length - 1].status).toBe('no_job')
  })

  it('sorts by sourceFileName', () => {
    const sorted = sortOcrWorkspaceRows(rows, {
      field: 'sourceFileName',
      direction: 'asc',
    })
    const names = sorted.map((r) => r.sourceFileName)
    expect(names).toEqual([...names].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'zh-CN')))
  })

  it('sorts by estimatedCost', () => {
    const sorted = sortOcrWorkspaceRows([confirmedRow(), noJobRow()], {
      field: 'estimatedCost',
      direction: 'desc',
    })
    // confirmedRow has cost, noJobRow has null cost → confirmed first
    expect(sorted[0].status).toBe('confirmed')
  })
})

// =========================================================================
// filterOcrWorkspaceRows
// =========================================================================

describe('filterOcrWorkspaceRows', () => {
  const rows = [unsupportedRow(), noJobRow(), reviewableRow(), confirmedRow(), failedRow()]

  it('returns all when filters are null', () => {
    const filters: OcrDocumentWorkspaceFilters = {
      status: null,
      isSupported: null,
      search: null,
    }
    expect(filterOcrWorkspaceRows(rows, filters)).toHaveLength(rows.length)
  })

  it('filters by status', () => {
    const filters: OcrDocumentWorkspaceFilters = {
      status: 'reviewable',
      isSupported: null,
      search: null,
    }
    const result = filterOcrWorkspaceRows(rows, filters)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('reviewable')
  })

  it('filters by isSupported', () => {
    const filters: OcrDocumentWorkspaceFilters = {
      status: null,
      isSupported: false,
      search: null,
    }
    const result = filterOcrWorkspaceRows(rows, filters)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('unsupported')
  })

  it('filters by search', () => {
    const filters: OcrDocumentWorkspaceFilters = {
      status: null,
      isSupported: null,
      search: 'meeting',
    }
    const result = filterOcrWorkspaceRows(rows, filters)
    expect(result).toHaveLength(1)
    expect(result[0].sourceFileName).toBe('meeting-notes.pdf')
  })
})

// =========================================================================
// Fixtures smoke tests
// =========================================================================

describe('fixtures', () => {
  it('each fixture has a valid status', () => {
    const fixtures = [
      unsupportedRow(),
      noJobRow(),
      queuedRow(),
      processingRow(),
      failedRow(),
      reviewableRow(),
      confirmedRow(),
      staleRow(),
      retentionHoldRow(),
      privacyBlockRow(),
      readOnlyDegradedRow(),
    ]
    for (const f of fixtures) {
      expect(OCR_DOCUMENT_WORKSPACE_STATUSES).toContain(f.status)
    }
  })

  it('largeWorkspaceRows generates requested count', () => {
    const rows = largeWorkspaceRows(100)
    expect(rows).toHaveLength(100)
  })

  it('largeWorkspaceRows all have valid statuses', () => {
    const rows = largeWorkspaceRows(50)
    for (const row of rows) {
      expect(isOcrDocumentWorkspaceStatus(row.status)).toBe(true)
    }
  })
})

// =========================================================================
// Performance: large dataset derivation
// =========================================================================

describe('performance: large workspace rows', () => {
  it('derives summaries for 1000 rows within acceptable time', () => {
    const rows = largeWorkspaceRows(1000)
    expect(rows.length).toBe(1000)

    // 对每个行运行 filter + sort
    const start = performance.now()
    const filtered = filterOcrWorkspaceRows(rows, {
      status: null,
      isSupported: null,
      search: null,
    })
    const sorted = sortOcrWorkspaceRows(filtered, {
      field: 'sourceFileName',
      direction: 'asc',
    })
    const elapsed = performance.now() - start

    expect(sorted).toHaveLength(1000)
    // Should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000)
  })
})

// 引用 OCR_DOCUMENT_WORKSPACE_STATUSES 用于 fixture 测试
import { OCR_DOCUMENT_WORKSPACE_STATUSES } from './ocr-ui-in-documents.js'
