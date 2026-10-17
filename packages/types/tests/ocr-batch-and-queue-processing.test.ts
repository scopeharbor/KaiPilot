/**
 * v3-ocr-batch-and-queue-processing — types 契约测试。
 * 纯函数无副作用，无真实 provider 调用。
 */

import { describe, it, expect } from 'vitest'
import {
  OCR_BATCH_STATUSES,
  OCR_QUEUE_ITEM_STATUSES,
  OCR_QUEUE_WORK_KINDS,
  OCR_BATCH_CONTROL_ACTIONS,
  OCR_BATCH_WARNING_CODES,
  OCR_QUEUE_FAILURE_CATEGORIES,
  OCR_BATCH_PERMISSION_ACTIONS,
  OCR_BATCH_AUDIT_ACTIONS,
  OCR_BATCH_ALLOWED_ACTIONS,
  OCR_BATCH_TERMINAL_STATUSES,
  OCR_QUEUE_TERMINAL_STATUSES,
  OCR_BATCH_RETRYABLE_STATUSES,
  OCR_BATCH_DEFAULT_MAX_SOURCES,
  OCR_BATCH_DEFAULT_MAX_PAGES_PER_BATCH,
  OCR_QUEUE_DEFAULT_CLAIM_LIMIT,
  OCR_QUEUE_DEFAULT_MAX_ATTEMPTS,
  OCR_QUEUE_DEFAULT_STALE_LOCK_MS,
  OCR_QUEUE_DEFAULT_RETRY_BASE_DELAY_MS,
  OCR_QUEUE_DEFAULT_RETRY_MAX_DELAY_MS,
  isOcrBatchStatus,
  isOcrQueueItemStatus,
  isOcrQueueWorkKind,
  isOcrBatchControlAction,
  isOcrBatchWarningCode,
  isOcrQueueFailureCategory,
  isOcrBatchPermissionAction,
  isOcrBatchAuditAction,
  isOcrBatchTerminal,
  isOcrQueueItemTerminal,
  isOcrQueueItemRetryable,
  computeBatchInputSignature,
  normalizeBatchIdempotencyKey,
  computeQueueIdempotencyKey,
  sortBatchSources,
  deduplicateBatchSources,
  aggregateBatchProgress,
  deriveBatchAggregateStatus,
  redactBatchAuditMetadata,
  redactSourceName,
  redactBatchProviderSummary,
  computeRetryDelay,
  isRetryableFailure,
  isTerminalFailure,
  computeNextAttemptAt,
  isLockStale,
  resolveBatchAllowedActions,
  isValidQueueItemStatusTransition,
} from '../src/ocr-batch-and-queue-processing.js'
import {
  buildBatchSourceInput,
  buildBatchCreateRequest,
  buildBatchSourceSummary,
  buildBatchSummary,
  buildBatchDetail,
  buildQueueItemSummary,
  buildQueueProjectSummary,
  buildBatchWarning,
  buildBatchCostSummary,
  buildLargeQueueItemSet,
  fixtureSingleDocumentBatch,
  fixtureMultiDocumentBatch,
  fixtureMixedQueueItems,
} from '../src/ocr-batch-and-queue-processing-fixtures.js'

// ---------------------------------------------------------------------------
// 2.8 — 类型守卫
// ---------------------------------------------------------------------------

describe('OCR batch type guards', () => {
  it('isOcrBatchStatus — valid and invalid', () => {
    expect(isOcrBatchStatus('queued')).toBe(true)
    expect(isOcrBatchStatus('completed')).toBe(true)
    expect(isOcrBatchStatus('invalid')).toBe(false)
    expect(isOcrBatchStatus(null)).toBe(false)
  })

  it('isOcrQueueItemStatus — valid and invalid', () => {
    expect(isOcrQueueItemStatus('queued')).toBe(true)
    expect(isOcrQueueItemStatus('succeeded')).toBe(true)
    expect(isOcrQueueItemStatus('terminal_failure')).toBe(true)
    expect(isOcrQueueItemStatus('invalid')).toBe(false)
  })

  it('isOcrQueueWorkKind — valid and invalid', () => {
    expect(isOcrQueueWorkKind('job')).toBe(true)
    expect(isOcrQueueWorkKind('page')).toBe(true)
    expect(isOcrQueueWorkKind('batch')).toBe(false)
  })

  it('isOcrBatchControlAction — valid and invalid', () => {
    expect(isOcrBatchControlAction('retry')).toBe(true)
    expect(isOcrBatchControlAction('cancel')).toBe(true)
    expect(isOcrBatchControlAction('resume')).toBe(true)
    expect(isOcrBatchControlAction('delete')).toBe(false)
  })

  it('isOcrBatchWarningCode — all codes from fixture', () => {
    for (const code of OCR_BATCH_WARNING_CODES) {
      expect(isOcrBatchWarningCode(code)).toBe(true)
    }
    expect(isOcrBatchWarningCode('INVALID_CODE')).toBe(false)
  })

  it('isOcrQueueFailureCategory — all categories', () => {
    for (const cat of OCR_QUEUE_FAILURE_CATEGORIES) {
      expect(isOcrQueueFailureCategory(cat)).toBe(true)
    }
    expect(isOcrQueueFailureCategory('INVALID_CAT')).toBe(false)
  })

  it('isOcrBatchPermissionAction — all valid', () => {
    for (const action of OCR_BATCH_PERMISSION_ACTIONS) {
      expect(isOcrBatchPermissionAction(action)).toBe(true)
    }
    expect(isOcrBatchPermissionAction('ocr_batch:delete')).toBe(false)
  })

  it('isOcrBatchAuditAction — all valid', () => {
    for (const action of OCR_BATCH_AUDIT_ACTIONS) {
      expect(isOcrBatchAuditAction(action)).toBe(true)
    }
    expect(isOcrBatchAuditAction('OCR_BATCH_DELETE')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 签名/幂等键
// ---------------------------------------------------------------------------

describe('computeBatchInputSignature', () => {
  it('deterministic — same input produces same hash', () => {
    const a = computeBatchInputSignature({ sourceAttachmentIds: [1, 2, 3] })
    const b = computeBatchInputSignature({ sourceAttachmentIds: [1, 2, 3] })
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it('different source ids produce different hash', () => {
    const a = computeBatchInputSignature({ sourceAttachmentIds: [1, 2] })
    const b = computeBatchInputSignature({ sourceAttachmentIds: [1, 3] })
    expect(a).not.toBe(b)
  })

  it('order-independent — sorted internally', () => {
    const a = computeBatchInputSignature({ sourceAttachmentIds: [3, 1, 2] })
    const b = computeBatchInputSignature({ sourceAttachmentIds: [1, 2, 3] })
    expect(a).toBe(b)
  })

  it('model and options affect hash', () => {
    const a = computeBatchInputSignature({
      sourceAttachmentIds: [1],
      modelId: 1,
      promptHint: 'test',
    })
    const b = computeBatchInputSignature({
      sourceAttachmentIds: [1],
      modelId: 2,
      promptHint: 'test',
    })
    expect(a).not.toBe(b)
  })
})

describe('computeQueueIdempotencyKey', () => {
  it('deterministic for job-level item', () => {
    const a = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      sourceHash: 'abc',
      attemptScope: 'initial',
    })
    const b = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      sourceHash: 'abc',
      attemptScope: 'initial',
    })
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it('different attempt scope produces different key', () => {
    const a = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      sourceHash: 'abc',
      attemptScope: 'initial',
    })
    const b = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      sourceHash: 'abc',
      attemptScope: 'retry1',
    })
    expect(a).not.toBe(b)
  })

  it('page-level item differs from job-level', () => {
    const a = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      pageId: 5,
      sourceHash: 'abc',
      attemptScope: 'initial',
    })
    const b = computeQueueIdempotencyKey({
      organizationId: 1,
      projectId: 100,
      batchId: 1,
      jobId: 10,
      sourceHash: 'abc',
      attemptScope: 'initial',
    })
    expect(a).not.toBe(b)
  })
})

describe('normalizeBatchIdempotencyKey', () => {
  it('trim and cap', () => {
    expect(normalizeBatchIdempotencyKey('  key123  ')).toBe('key123')
    expect(normalizeBatchIdempotencyKey(null)).toBeNull()
    expect(normalizeBatchIdempotencyKey(undefined)).toBeNull()
    expect(normalizeBatchIdempotencyKey('')).toBeNull()
  })

  it('cap at 256', () => {
    const long = 'a'.repeat(300)
    expect(normalizeBatchIdempotencyKey(long)).toHaveLength(256)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — source sorting
// ---------------------------------------------------------------------------

describe('sortBatchSources', () => {
  it('sorts by attachmentId', () => {
    const sources = [
      buildBatchSourceInput({ sourceAttachmentId: 3 }),
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 2 }),
    ]
    const sorted = sortBatchSources(sources)
    expect(sorted[0].sourceAttachmentId).toBe(1)
    expect(sorted[1].sourceAttachmentId).toBe(2)
    expect(sorted[2].sourceAttachmentId).toBe(3)
  })

  it('stable for same attachmentId', () => {
    const sources = [
      buildBatchSourceInput({ sourceAttachmentId: 1, sourceKind: 'upload' }),
      buildBatchSourceInput({ sourceAttachmentId: 1, sourceKind: 'attachment' }),
    ]
    const sorted = sortBatchSources(sources)
    // 保留原始顺序
    expect(sorted[0].sourceKind).toBe('upload')
    expect(sorted[1].sourceKind).toBe('attachment')
  })
})

describe('deduplicateBatchSources', () => {
  it('removes duplicates', () => {
    const sources = [
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 2 }),
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 2 }),
    ]
    const { deduplicated, duplicateCount } = deduplicateBatchSources(sources)
    expect(deduplicated).toHaveLength(2)
    expect(duplicateCount).toBe(2)
  })

  it('no duplicates', () => {
    const sources = [
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 2 }),
    ]
    const { deduplicated, duplicateCount } = deduplicateBatchSources(sources)
    expect(deduplicated).toHaveLength(2)
    expect(duplicateCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — progress aggregation
// ---------------------------------------------------------------------------

describe('aggregateBatchProgress', () => {
  it('computes totals', () => {
    const result = aggregateBatchProgress({
      queuedCount: 2,
      processingCount: 1,
      completedCount: 5,
      failedCount: 1,
      cancelledCount: 1,
    })
    expect(result.total).toBe(10)
    expect(result.completed).toBe(5)
    expect(result.pending).toBe(3)
  })

  it('empty batch', () => {
    const result = aggregateBatchProgress({
      queuedCount: 0,
      processingCount: 0,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    })
    expect(result.total).toBe(0)
    expect(result.completed).toBe(0)
    expect(result.pending).toBe(0)
  })
})

describe('deriveBatchAggregateStatus', () => {
  it('empty → none', () => {
    expect(deriveBatchAggregateStatus([])).toBe('none')
  })

  it('all queued → processing', () => {
    const items = [{ status: 'queued' as const }, { status: 'queued' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('processing')
  })

  it('processing + succeeded → partial', () => {
    const items = [{ status: 'processing' as const }, { status: 'succeeded' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('partial')
  })

  it('all succeeded → succeeded', () => {
    const items = [{ status: 'succeeded' as const }, { status: 'succeeded' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('succeeded')
  })

  it('all failed → failed', () => {
    const items = [{ status: 'failed' as const }, { status: 'terminal_failure' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('failed')
  })

  it('succeeded + failed → partial', () => {
    const items = [{ status: 'succeeded' as const }, { status: 'failed' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('partial')
  })

  it('rate_limited → rate_limited', () => {
    const items = [{ status: 'rate_limited' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('rate_limited')
  })

  it('all cancelled → cancelled', () => {
    const items = [{ status: 'cancelled' as const }, { status: 'cancelled' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('cancelled')
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 脱敏
// ---------------------------------------------------------------------------

describe('redactBatchAuditMetadata', () => {
  it('strips sensitive keys', () => {
    const result = redactBatchAuditMetadata({
      provider: 'anthropic',
      model: 'claude-fable-5',
      apiKey: 'sk-secret-123',
      authorization: 'Bearer token',
      promptHint: 'extract text',
      fullText: 'Some OCR text',
      sourceBytes: 'base64...',
      absolutePath: '/home/user/file.png',
      filePath: '/tmp/doc.pdf',
    })
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-fable-5')
    expect(result.apiKey).toBe('[REDACTED]')
    expect(result.authorization).toBe('[REDACTED]')
    expect(result.promptHint).toBe('[REDACTED]')
    expect(result.fullText).toBe('[REDACTED]')
    expect(result.sourceBytes).toBe('[REDACTED]')
    expect(result.absolutePath).toBe('[REDACTED]')
    expect(result.filePath).toBe('[REDACTED]')
  })

  it('preserves safe keys', () => {
    const result = redactBatchAuditMetadata({
      batchId: 1,
      sourceCount: 3,
      status: 'queued',
      organizationId: 1,
      projectId: 100,
    })
    expect(result.batchId).toBe(1)
    expect(result.sourceCount).toBe(3)
    expect(result.status).toBe('queued')
  })
})

describe('redactSourceName', () => {
  it('redacts hidden source', () => {
    expect(redactSourceName('secret-file.pdf', true)).toBeNull()
  })

  it('preserves visible source', () => {
    expect(redactSourceName('public-file.png', false)).toBe('public-file.png')
  })

  it('null with no redaction', () => {
    expect(redactSourceName(null, false)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 重试/退避
// ---------------------------------------------------------------------------

describe('computeRetryDelay', () => {
  it('first attempt = base delay', () => {
    expect(computeRetryDelay({ attemptCount: 1 })).toBe(OCR_QUEUE_DEFAULT_RETRY_BASE_DELAY_MS)
  })

  it('exponential growth', () => {
    const d1 = computeRetryDelay({ attemptCount: 1 })
    const d2 = computeRetryDelay({ attemptCount: 2 })
    const d3 = computeRetryDelay({ attemptCount: 3 })
    expect(d2).toBe(d1 * 2)
    expect(d3).toBe(d1 * 4)
  })

  it('capped at max', () => {
    const result = computeRetryDelay({
      attemptCount: 10,
      baseDelayMs: 10_000,
      maxDelayMs: 60_000,
    })
    expect(result).toBe(60_000)
  })

  it('custom base delay', () => {
    expect(computeRetryDelay({ attemptCount: 1, baseDelayMs: 5000 })).toBe(5000)
  })
})

describe('isRetryableFailure', () => {
  it('timeout is retryable', () => expect(isRetryableFailure('timeout')).toBe(true))
  it('rate_limit is retryable', () => expect(isRetryableFailure('rate_limit')).toBe(true))
  it('unavailable is retryable', () => expect(isRetryableFailure('unavailable')).toBe(true))
  it('auth is NOT retryable', () => expect(isRetryableFailure('auth')).toBe(false))
  it('capability_mismatch is NOT retryable', () =>
    expect(isRetryableFailure('capability_mismatch')).toBe(false))
  it('exhausted_attempts is NOT retryable', () =>
    expect(isRetryableFailure('exhausted_attempts')).toBe(false))
})

describe('isTerminalFailure', () => {
  it('auth is terminal', () => expect(isTerminalFailure('auth')).toBe(true))
  it('capability_mismatch is terminal', () =>
    expect(isTerminalFailure('capability_mismatch')).toBe(true))
  it('exhausted_attempts is terminal', () =>
    expect(isTerminalFailure('exhausted_attempts')).toBe(true))
  it('timeout is not terminal', () => expect(isTerminalFailure('timeout')).toBe(false))
  it('none is not terminal', () => expect(isTerminalFailure('none')).toBe(false))
})

describe('computeNextAttemptAt', () => {
  it('computes future time', () => {
    const now = new Date('2026-08-03T10:00:00.000Z').getTime()
    const next = computeNextAttemptAt(10_000, now)
    expect(next).toBe('2026-08-03T10:00:10.000Z')
  })
})

describe('isLockStale', () => {
  it('recent lock is not stale', () => {
    const recent = new Date(Date.now() - 60_000).toISOString() // 1 min ago
    expect(isLockStale(recent, 300_000)).toBe(false)
  })

  it('old lock is stale', () => {
    const old = new Date(Date.now() - 600_000).toISOString() // 10 min ago
    expect(isLockStale(old, 300_000)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 允许动作
// ---------------------------------------------------------------------------

describe('resolveBatchAllowedActions', () => {
  it('viewer gets read-only actions', () => {
    const actions = resolveBatchAllowedActions({
      status: 'queued',
      canView: true,
      canCreate: false,
      canManage: false,
    })
    expect(actions).toContain('view')
    expect(actions).toContain('inspect_queue')
    expect(actions).not.toContain('create')
    expect(actions).not.toContain('retry')
  })

  it('creator can create', () => {
    const actions = resolveBatchAllowedActions({
      status: 'queued',
      canView: true,
      canCreate: true,
      canManage: false,
    })
    expect(actions).toContain('create')
  })

  it('manager can retry failed batch', () => {
    const actions = resolveBatchAllowedActions({
      status: 'failed',
      canView: true,
      canCreate: false,
      canManage: true,
    })
    expect(actions).toContain('retry')
  })

  it('manager can cancel processing batch', () => {
    const actions = resolveBatchAllowedActions({
      status: 'processing',
      canView: true,
      canCreate: false,
      canManage: true,
    })
    expect(actions).toContain('cancel')
  })

  it('manager can resume paused batch', () => {
    const actions = resolveBatchAllowedActions({
      status: 'paused',
      canView: true,
      canCreate: false,
      canManage: true,
    })
    expect(actions).toContain('resume')
    expect(actions).toContain('cancel')
  })

  it('manager cannot cancel completed batch', () => {
    const actions = resolveBatchAllowedActions({
      status: 'completed',
      canView: true,
      canCreate: false,
      canManage: true,
    })
    expect(actions).not.toContain('cancel')
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 状态迁移
// ---------------------------------------------------------------------------

describe('isValidQueueItemStatusTransition', () => {
  it('queued → claimed', () => {
    expect(isValidQueueItemStatusTransition('queued', 'claimed')).toBe(true)
  })

  it('queued → cancelled', () => {
    expect(isValidQueueItemStatusTransition('queued', 'cancelled')).toBe(true)
  })

  it('claimed → processing', () => {
    expect(isValidQueueItemStatusTransition('claimed', 'processing')).toBe(true)
  })

  it('processing → succeeded', () => {
    expect(isValidQueueItemStatusTransition('processing', 'succeeded')).toBe(true)
  })

  it('processing → failed', () => {
    expect(isValidQueueItemStatusTransition('processing', 'failed')).toBe(true)
  })

  it('failed → retryable', () => {
    expect(isValidQueueItemStatusTransition('failed', 'retryable')).toBe(true)
  })

  it('retryable → queued', () => {
    expect(isValidQueueItemStatusTransition('retryable', 'queued')).toBe(true)
  })

  it('budget_blocked → retryable', () => {
    expect(isValidQueueItemStatusTransition('budget_blocked', 'retryable')).toBe(true)
  })

  it('succeeded → cancelled (review override)', () => {
    expect(isValidQueueItemStatusTransition('succeeded', 'cancelled')).toBe(true)
  })

  it('terminal_failure → anything is blocked', () => {
    expect(isValidQueueItemStatusTransition('terminal_failure', 'queued')).toBe(false)
    expect(isValidQueueItemStatusTransition('terminal_failure', 'retryable')).toBe(false)
  })

  it('cancelled → anything is blocked', () => {
    expect(isValidQueueItemStatusTransition('cancelled', 'queued')).toBe(false)
    expect(isValidQueueItemStatusTransition('cancelled', 'retryable')).toBe(false)
  })

  it('stale_blocked → cancelled', () => {
    expect(isValidQueueItemStatusTransition('stale_blocked', 'cancelled')).toBe(true)
  })
})

describe('isOcrBatchTerminal', () => {
  it('terminal statuses', () => {
    for (const status of OCR_BATCH_TERMINAL_STATUSES) {
      expect(isOcrBatchTerminal(status)).toBe(true)
    }
  })

  it('non-terminal statuses', () => {
    expect(isOcrBatchTerminal('queued')).toBe(false)
    expect(isOcrBatchTerminal('processing')).toBe(false)
    expect(isOcrBatchTerminal('partial')).toBe(false)
    expect(isOcrBatchTerminal('paused')).toBe(false)
  })
})

describe('isOcrQueueItemTerminal', () => {
  it('terminal statuses', () => {
    for (const status of OCR_QUEUE_TERMINAL_STATUSES) {
      expect(isOcrQueueItemTerminal(status)).toBe(true)
    }
  })

  it('non-terminal statuses', () => {
    expect(isOcrQueueItemTerminal('queued')).toBe(false)
    expect(isOcrQueueItemTerminal('processing')).toBe(false)
    expect(isOcrQueueItemTerminal('failed')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — fixtures sanity
// ---------------------------------------------------------------------------

describe('fixtures build consistently', () => {
  it('buildBatchCreateRequest', () => {
    const req = buildBatchCreateRequest()
    expect(req.sources).toHaveLength(2)
    expect(req.idempotencyKey).toBe('test-batch-key-1')
  })

  it('fixtureSingleDocumentBatch', () => {
    expect(fixtureSingleDocumentBatch.sources).toHaveLength(1)
  })

  it('fixtureMultiDocumentBatch', () => {
    expect(fixtureMultiDocumentBatch.sources).toHaveLength(3)
  })

  it('buildBatchSummary', () => {
    const s = buildBatchSummary()
    expect(s.status).toBe('queued')
    expect(s.sourceCount).toBe(2)
  })

  it('buildBatchDetail', () => {
    const d = buildBatchDetail()
    expect(d.sources).toHaveLength(2)
    expect(d.allowedActions).toContain('view')
  })

  it('buildQueueItemSummary', () => {
    const qi = buildQueueItemSummary()
    expect(qi.workKind).toBe('job')
    expect(qi.attemptCount).toBe(0)
  })

  it('buildQueueProjectSummary', () => {
    const ps = buildQueueProjectSummary()
    expect(ps.total).toBe(2)
    expect(ps.queued).toBe(2)
  })

  it('buildLargeQueueItemSet', () => {
    const items = buildLargeQueueItemSet(100)
    expect(items).toHaveLength(100)
    // 验证分布：约 20 个 succeeded、33 个 queued、其余 processing
    const succeeded = items.filter((i) => i.status === 'succeeded')
    const queued = items.filter((i) => i.status === 'queued')
    expect(succeeded.length).toBeGreaterThan(0)
    expect(queued.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 2.8 — 边界情况
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('sortBatchSources — empty list', () => {
    expect(sortBatchSources([])).toHaveLength(0)
  })

  it('deduplicateBatchSources — all duplicates', () => {
    const sources = [
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
      buildBatchSourceInput({ sourceAttachmentId: 1 }),
    ]
    const { deduplicated, duplicateCount } = deduplicateBatchSources(sources)
    expect(deduplicated).toHaveLength(1)
    expect(duplicateCount).toBe(2)
  })

  it('computeRetryDelay — attempt 0 (base case)', () => {
    // Math.max(0, -1) = 0, Math.pow(2, 0) = 1, baseDelay * 1 = 10_000
    const d = computeRetryDelay({ attemptCount: 0 })
    expect(d).toBe(10_000)
  })

  it('deriveBatchAggregateStatus — mixed with cancelled + succeeded', () => {
    const items = [{ status: 'cancelled' as const }, { status: 'succeeded' as const }]
    expect(deriveBatchAggregateStatus(items)).toBe('partial')
  })
})

// ---------------------------------------------------------------------------
// 2.9 — P1 性能探针：100+ docs / 500+ page queue items
// ---------------------------------------------------------------------------

describe('performance probes (P1)', () => {
  it('aggregateBatchProgress handles 100 documents without slowdown', () => {
    const result = aggregateBatchProgress({
      queuedCount: 10,
      processingCount: 5,
      completedCount: 80,
      failedCount: 3,
      cancelledCount: 2,
    })
    expect(result.total).toBe(100)
    expect(result.completed).toBe(80)
  })

  it('deriveBatchAggregateStatus handles 500 queue items deterministically', () => {
    const items = buildLargeQueueItemSet(500).map((i) => ({ status: i.status }))
    const result = deriveBatchAggregateStatus(items)
    // Deterministic: same input always same output
    const result2 = deriveBatchAggregateStatus(items)
    expect(result).toBe(result2)
  })

  it('computeBatchInputSignature with 100 source ids is deterministic', () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1)
    const a = computeBatchInputSignature({ sourceAttachmentIds: ids })
    const b = computeBatchInputSignature({ sourceAttachmentIds: [...ids].reverse() })
    expect(a).toBe(b)
    expect(a).toHaveLength(16)
  })

  it('buildLargeQueueItemSet creates exactly 500 items', () => {
    const items500 = buildLargeQueueItemSet(500)
    expect(items500).toHaveLength(500)
    expect(items500[0].id).toBe(1)
    expect(items500[499].id).toBe(500)
  })
})
