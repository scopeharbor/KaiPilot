/**
 * V3 OCR Document Search Indexing — 共享契约测试
 *
 * 测试哈希稳定性、幂等稳定性、文本截断、可索引性判定、阻塞原因排序、
 * 脱敏、以及 fixture 构建器的正确性。
 */

import { describe, it, expect } from 'vitest'
import {
  computeIndexContentHash,
  computePreviewHash,
  normalizeIdempotencyKey,
  computeIdempotencyKeyHash,
  normalizeSearchableText,
  generateSearchSnippet,
  truncateSearchableText,
  isExtractionIndexable,
  sortBlockedReasonsBySeverity,
  sortWarningsBySeverity,
  buildSearchResultMetadata,
  buildOcrSearchIndexAuditMetadata,
  isOcrSearchIndexEntryStatus,
  isOcrSearchIndexRunType,
  isOcrSearchIndexRunStatus,
  isOcrSearchIndexBlockedReason,
  isOcrSearchIndexWarningCode,
  OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX,
  OCR_SEARCH_INDEX_SNIPPET_MAX,
} from './ocr-document-search-indexing.js'
import {
  buildIndexPreviewEntry,
  buildBlockedPreviewEntry,
  buildIndexEntrySummary,
  buildTombstonedEntrySummary,
  buildIndexRunSummary,
  buildPreviewResponse,
  buildExecuteResponse,
  buildMultipleEligiblePreviews,
  buildMixedPreviewEntries,
  FIXTURE_SEARCHABLE_TEXT_SHORT,
  FIXTURE_SEARCHABLE_TEXT_LONG,
  FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD,
  buildAuditMetadataFixture,
} from './ocr-document-search-indexing-fixtures.js'

// ─── 类型守卫 ─────────────────────────────────────────────────────────────

describe('ocr-document-search-indexing type guards', () => {
  it('validates entry statuses', () => {
    expect(isOcrSearchIndexEntryStatus('active')).toBe(true)
    expect(isOcrSearchIndexEntryStatus('inactive')).toBe(true)
    expect(isOcrSearchIndexEntryStatus('tombstoned')).toBe(true)
    expect(isOcrSearchIndexEntryStatus('unknown')).toBe(false)
    expect(isOcrSearchIndexEntryStatus('')).toBe(false)
  })

  it('validates run types', () => {
    expect(isOcrSearchIndexRunType('index')).toBe(true)
    expect(isOcrSearchIndexRunType('reindex')).toBe(true)
    expect(isOcrSearchIndexRunType('unindex')).toBe(true)
    expect(isOcrSearchIndexRunType('preview')).toBe(false)
  })

  it('validates run statuses', () => {
    expect(isOcrSearchIndexRunStatus('succeeded')).toBe(true)
    expect(isOcrSearchIndexRunStatus('partial')).toBe(true)
    expect(isOcrSearchIndexRunStatus('stale_rejected')).toBe(true)
    expect(isOcrSearchIndexRunStatus('blocked')).toBe(true)
    expect(isOcrSearchIndexRunStatus('error')).toBe(true)
  })

  it('validates blocked reasons', () => {
    expect(isOcrSearchIndexBlockedReason('stale_source')).toBe(true)
    expect(isOcrSearchIndexBlockedReason('hold_active')).toBe(true)
    expect(isOcrSearchIndexBlockedReason('unknown')).toBe(false)
  })

  it('validates warning codes', () => {
    expect(isOcrSearchIndexWarningCode('source_hash_unknown')).toBe(true)
    expect(isOcrSearchIndexWarningCode('retention_deadline_approaching')).toBe(true)
    expect(isOcrSearchIndexWarningCode('unknown_code')).toBe(false)
  })
})

// ─── 哈希稳定性 ───────────────────────────────────────────────────────────

describe('computeIndexContentHash', () => {
  it('is deterministic', () => {
    const h1 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    const h2 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('changes with different extraction id', () => {
    const h1 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    const h2 = computeIndexContentHash(2, 'abc', 'def', [1, 2])
    expect(h1).not.toBe(h2)
  })

  it('changes with different source hash', () => {
    const h1 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    const h2 = computeIndexContentHash(1, 'xyz', 'def', [1, 2])
    expect(h1).not.toBe(h2)
  })

  it('changes with different selected text hash', () => {
    const h1 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    const h2 = computeIndexContentHash(1, 'abc', 'ghi', [1, 2])
    expect(h1).not.toBe(h2)
  })

  it('changes with different page refs', () => {
    const h1 = computeIndexContentHash(1, 'abc', 'def', [1, 2])
    const h2 = computeIndexContentHash(1, 'abc', 'def', [1, 3])
    expect(h1).not.toBe(h2)
  })
})

describe('computePreviewHash', () => {
  it('is deterministic', () => {
    const entries = buildMultipleEligiblePreviews(3)
    const h1 = computePreviewHash(entries)
    const h2 = computePreviewHash(entries)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('changes with different entries', () => {
    const e1 = buildMultipleEligiblePreviews(2)
    const e2 = buildMultipleEligiblePreviews(3)
    expect(computePreviewHash(e1)).not.toBe(computePreviewHash(e2))
  })

  it('includes blocked entries in hash', () => {
    const withBlocked = buildMixedPreviewEntries()
    const allEligible = buildMultipleEligiblePreviews(5)
    expect(computePreviewHash(withBlocked)).not.toBe(computePreviewHash(allEligible))
  })
})

describe('computeIdempotencyKeyHash', () => {
  it('is deterministic', () => {
    const h1 = computeIdempotencyKeyHash('my-key-123')
    const h2 = computeIdempotencyKeyHash('my-key-123')
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(16)
  })

  it('normalizes whitespace', () => {
    const h1 = computeIdempotencyKeyHash('  my-key-123  ')
    const h2 = computeIdempotencyKeyHash('my-key-123')
    expect(h1).toBe(h2)
  })

  it('truncates long keys', () => {
    const longKey = 'x'.repeat(500)
    const h = computeIdempotencyKeyHash(longKey)
    expect(h).toHaveLength(16)
  })
})

// ─── 文本规范化与截断 ────────────────────────────────────────────────────

describe('normalizeSearchableText', () => {
  it('trims whitespace', () => {
    expect(normalizeSearchableText('  hello world  ')).toBe('hello world')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeSearchableText('hello   world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(normalizeSearchableText('')).toBe('')
  })
})

describe('generateSearchSnippet', () => {
  it('returns full text if short enough', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_SHORT, '测试')
    expect(snippet).toBe(FIXTURE_SEARCHABLE_TEXT_SHORT)
  })

  it('centers around keyword', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_LONG, '甘特图')
    expect(snippet).toContain('甘特图')
    expect(snippet.length).toBeLessThanOrEqual(OCR_SEARCH_INDEX_SNIPPET_MAX + 2) // +2 for ……
  })

  it('returns truncated start if keyword not found', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_LONG, 'NONEXISTENT')
    expect(snippet.length).toBeLessThanOrEqual(OCR_SEARCH_INDEX_SNIPPET_MAX + 1) // +1 for …
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('handles Chinese keywords', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD, '项目')
    expect(snippet).toContain('项目')
  })

  it('handles empty keyword', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_LONG, '')
    expect(snippet.length).toBeLessThanOrEqual(OCR_SEARCH_INDEX_SNIPPET_MAX + 1)
    expect(snippet.endsWith('…')).toBe(true)
  })
})

describe('truncateSearchableText', () => {
  it('keeps short text as-is', () => {
    expect(truncateSearchableText('hello')).toBe('hello')
  })

  it('truncates long text', () => {
    const long = 'x'.repeat(OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX + 100)
    expect(truncateSearchableText(long)).toHaveLength(OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX)
  })

  it('normalizes before truncating', () => {
    const padded = '  ' + 'x'.repeat(OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX + 10) + '  '
    expect(truncateSearchableText(padded)).toHaveLength(OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX)
  })
})

// ─── 生命周期分类 ─────────────────────────────────────────────────────────

describe('isExtractionIndexable', () => {
  it('marks current accepted extraction with text and hash as eligible', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: 'some text',
    })
    expect(result.eligible).toBe(true)
    expect(result.blockedReason).toBeNull()
  })

  it('blocks non-accepted status', () => {
    const result = isExtractionIndexable({
      status: 'candidate',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: 'some text',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('candidate_only')
  })

  it('blocks empty selected text', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: '',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('not_accepted')
  })

  it('blocks null selected text', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: null,
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('not_accepted')
  })

  it('blocks missing source hash', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: null,
      candidateHash: 'def456',
      selectedText: 'text',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('not_accepted')
  })

  it('blocks purged extraction', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: '2024-01-01T00:00:00Z',
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: 'text',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('purged_extraction')
  })

  it('blocks tombstoned extraction', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: 5,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: 'text',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('tombstoned_extraction')
  })

  it('blocks expired lifecycle', () => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: 'expired',
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'def456',
      selectedText: 'text',
    })
    expect(result.eligible).toBe(false)
    expect(result.blockedReason).toBe('expired_extraction')
  })
})

// ─── 排序 ─────────────────────────────────────────────────────────────────

describe('sortBlockedReasonsBySeverity', () => {
  it('sorts by severity descending', () => {
    const reasons = ['stale_source', 'hold_active', 'expired_extraction'] as const
    const sorted = sortBlockedReasonsBySeverity([...reasons])
    expect(sorted[0]).toBe('hold_active')
    expect(sorted[1]).toBe('expired_extraction')
    expect(sorted[2]).toBe('stale_source')
  })

  it('deduplicates', () => {
    const reasons = ['stale_source', 'stale_source', 'hold_active'] as const
    const sorted = sortBlockedReasonsBySeverity([...reasons])
    expect(sorted).toHaveLength(2)
  })
})

describe('sortWarningsBySeverity', () => {
  it('sorts by severity descending', () => {
    const warnings = ['page_refs_partial', 'retention_policy_unavailable'] as const
    const sorted = sortWarningsBySeverity([...warnings])
    expect(sorted[0]).toBe('retention_policy_unavailable')
    expect(sorted[1]).toBe('page_refs_partial')
  })

  it('deduplicates', () => {
    const warnings = ['source_hash_unknown', 'source_hash_unknown'] as const
    const sorted = sortWarningsBySeverity([...warnings])
    expect(sorted).toHaveLength(1)
  })
})

// ─── 脱敏 ─────────────────────────────────────────────────────────────────

describe('buildSearchResultMetadata', () => {
  it('excludes full OCR text', () => {
    const meta = buildSearchResultMetadata({
      sourceKind: 'attachment',
      sourceId: 10,
      extractionId: 5,
      pageRefs: [1, 2],
      selectedTextHash: 'hash123',
      indexContentHash: 'idx456',
      matchedFields: ['searchable_text'],
    })
    // 不应包含原始文本
    expect(meta).not.toHaveProperty('selectedText')
    expect(meta).not.toHaveProperty('searchableText')
    expect(meta).not.toHaveProperty('fullText')
    // 应该包含哈希而非原文
    expect(meta.selectedTextHash).toBe('hash123')
    expect(meta.indexContentHash).toBe('idx456')
  })

  it('includes page refs and source kind', () => {
    const meta = buildSearchResultMetadata({
      sourceKind: 'document',
      sourceId: 20,
      extractionId: 5,
      pageRefs: [3, 4, 5],
      selectedTextHash: 'hash123',
      indexContentHash: 'idx456',
      matchedFields: ['searchable_text'],
    })
    expect(meta.sourceKind).toBe('document')
    expect(meta.sourceId).toBe(20)
    expect(meta.pageRefs).toEqual([3, 4, 5])
    expect(meta.matchedFields).toContain('searchable_text')
  })
})

describe('buildOcrSearchIndexAuditMetadata', () => {
  it('excludes full OCR text', () => {
    const meta = buildOcrSearchIndexAuditMetadata({
      organizationId: 1,
      projectId: 1,
      runId: 1,
      runType: 'index',
      entryIds: [1, 2],
      extractionIds: [1, 2],
      sourceHashes: ['abc', 'def'],
      selectedTextHashes: ['111', '222'],
      indexContentHashes: ['aaa', 'bbb'],
      createdCount: 2,
    })
    expect(meta).not.toHaveProperty('searchableText')
    expect(meta).not.toHaveProperty('selectedText')
    expect(meta).not.toHaveProperty('fullText')
    expect(meta).not.toHaveProperty('rawProviderBody')
    expect(meta).not.toHaveProperty('prompt')
    expect(meta).not.toHaveProperty('apiKey')
    expect(meta).not.toHaveProperty('authorizationHeader')
    expect(meta).not.toHaveProperty('absolutePath')
    expect(meta).not.toHaveProperty('fileContents')
  })
})

// ─── Fixture 构建器 ───────────────────────────────────────────────────────

describe('fixture builders', () => {
  it('buildIndexPreviewEntry creates valid entry', () => {
    const entry = buildIndexPreviewEntry()
    expect(entry.eligible).toBe(true)
    expect(entry.blockedReason).toBeNull()
    expect(entry.plannedIndexHash).toBeTruthy()
    expect(entry.pageRefs).toHaveLength(2)
  })

  it('buildBlockedPreviewEntry creates blocked entry', () => {
    const entry = buildBlockedPreviewEntry('stale_source')
    expect(entry.eligible).toBe(false)
    expect(entry.blockedReason).toBe('stale_source')
    expect(entry.plannedIndexHash).toBeNull()
  })

  it('buildIndexEntrySummary creates active entry', () => {
    const entry = buildIndexEntrySummary()
    expect(entry.status).toBe('active')
    expect(entry.tombstonedAt).toBeNull()
    expect(entry.id).toBeGreaterThan(0)
  })

  it('buildTombstonedEntrySummary creates tombstoned entry', () => {
    const entry = buildTombstonedEntrySummary()
    expect(entry.status).toBe('tombstoned')
    expect(entry.tombstonedAt).toBeTruthy()
  })

  it('buildIndexRunSummary creates valid run', () => {
    const run = buildIndexRunSummary('index')
    expect(run.runType).toBe('index')
    expect(run.status).toBe('succeeded')
    expect(run.entryCount).toBe(3)
  })

  it('buildPreviewResponse computes counts correctly', () => {
    const entries = buildMixedPreviewEntries()
    const resp = buildPreviewResponse(entries)
    expect(resp.data.eligibleCount).toBe(2)
    expect(resp.data.blockedCount).toBe(3)
    expect(resp.data.blockedReasons).toHaveLength(3)
    expect(resp.data.requiresConfirmation).toBe(true)
  })

  it('buildExecuteResponse includes run and entries', () => {
    const entries = [buildIndexEntrySummary(), buildIndexEntrySummary({ extractionId: 2 })]
    const run = buildIndexRunSummary('index')
    const resp = buildExecuteResponse(entries, run)
    expect(resp.data.createdCount).toBe(2)
    expect(resp.data.entries).toHaveLength(2)
  })

  it('buildMultipleEligiblePreviews generates correct count', () => {
    const entries = buildMultipleEligiblePreviews(5)
    expect(entries).toHaveLength(5)
    expect(entries.every((e) => e.eligible)).toBe(true)
  })

  it('buildMixedPreviewEntries has mix of eligible and blocked', () => {
    const entries = buildMixedPreviewEntries()
    const eligible = entries.filter((e) => e.eligible)
    const blocked = entries.filter((e) => !e.eligible)
    expect(eligible.length).toBeGreaterThan(0)
    expect(blocked.length).toBeGreaterThan(0)
  })

  it('buildAuditMetadataFixture excludes sensitive fields', () => {
    const meta = buildAuditMetadataFixture()
    expect(meta.organizationId).toBe(1)
    expect(meta.projectId).toBe(1)
    // 不应包含敏感数据
    expect(meta).not.toHaveProperty('searchableText')
    expect(meta).not.toHaveProperty('rawProviderBody')
  })
})

// ─── 大文本 / 中文关键词 fixture ─────────────────────────────────────────

describe('large text and Chinese keyword fixtures', () => {
  it('FIXTURE_SEARCHABLE_TEXT_LONG is long enough for truncation tests', () => {
    expect(FIXTURE_SEARCHABLE_TEXT_LONG.length).toBeGreaterThan(OCR_SEARCH_INDEX_SNIPPET_MAX)
  })

  it('FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD contains common Chinese project terms', () => {
    expect(FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD).toContain('项目')
    expect(FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD).toContain('OCR')
    expect(FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD).toContain('预算')
  })

  it('generateSearchSnippet with Chinese keyword centers correctly', () => {
    const snippet = generateSearchSnippet(FIXTURE_SEARCHABLE_TEXT_CHINESE_KEYWORD, 'OCR')
    expect(snippet).toContain('OCR')
    expect(snippet.length).toBeLessThanOrEqual(OCR_SEARCH_INDEX_SNIPPET_MAX + 2)
  })
})

// ─── 类型级回归：候选与原始 provider 输出不可索引 ──────────────────────────

describe('type-level regression: candidates and raw provider output not indexable', () => {
  it('OcrSearchIndexPreviewEntry does not accept candidateId field', () => {
    // 编译时断言：PreviewEntry 不应有 candidateId
    const entry = buildIndexPreviewEntry()
    expect((entry as Record<string, unknown>).candidateId).toBeUndefined()
    expect((entry as Record<string, unknown>).rawProviderOutput).toBeUndefined()
  })

  it('OcrSearchIndexEntrySummary does not expose raw provider data', () => {
    const summary = buildIndexEntrySummary()
    expect((summary as Record<string, unknown>).rawProviderBody).toBeUndefined()
    expect((summary as Record<string, unknown>).prompt).toBeUndefined()
    expect((summary as Record<string, unknown>).apiKey).toBeUndefined()
  })

  it('buildOcrSearchIndexAuditMetadata does not expose raw provider data', () => {
    const meta = buildOcrSearchIndexAuditMetadata({
      organizationId: 1,
      projectId: 1,
    })
    expect(meta).not.toHaveProperty('rawProviderBody')
    expect(meta).not.toHaveProperty('prompt')
    expect(meta).not.toHaveProperty('apiKey')
    expect(meta).not.toHaveProperty('authorizationHeader')
  })
})
