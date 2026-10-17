/**
 * v3-ocr-batch-and-queue-processing — OCR 批量/队列共享契约 fixtures。
 *
 * 为测试提供确定性构建器与预置 fixture 集。
 * 红线：不包含真实 OCR 文本、provider payloads、prompts、API keys、绝对路径。
 */

import type {
  OcrBatchStatus,
  OcrBatchAggregateStatus,
  OcrQueueItemStatus,
  OcrQueueWorkKind,
  OcrQueueFailureCategory,
  OcrBatchSourceInput,
  OcrBatchCreateRequest,
  OcrBatchSourceSummary,
  OcrBatchSummary,
  OcrBatchDetail,
  OcrQueueItemSummary,
  OcrQueueProjectSummary,
  OcrBatchWarning,
  OcrBatchCostSummary,
} from './ocr-batch-and-queue-processing.js'

// Extended type for internal/fixture use with raw lock fields
interface OcrQueueItemInternal extends OcrQueueItemSummary {
  lockOwner?: string | null
  lockedAt?: string | null
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildBatchSourceInput(
  overrides?: Partial<OcrBatchSourceInput>,
): OcrBatchSourceInput {
  return {
    sourceAttachmentId: 101,
    sourceKind: 'attachment',
    ...overrides,
  }
}

export function buildBatchCreateRequest(
  overrides?: Partial<OcrBatchCreateRequest>,
): OcrBatchCreateRequest {
  return {
    sources: [buildBatchSourceInput(), buildBatchSourceInput({ sourceAttachmentId: 102 })],
    connectionId: 1,
    modelId: 1,
    promptHint: null,
    pageLimit: null,
    idempotencyKey: 'test-batch-key-1',
    ...overrides,
  }
}

export function buildBatchSourceSummary(
  overrides?: Partial<OcrBatchSourceSummary>,
): OcrBatchSourceSummary {
  return {
    sourceIndex: 0,
    sourceAttachmentId: 101,
    sourceFileName: 'test-doc.png',
    sourceMimeType: 'image/png',
    sourceHash: 'abc123def',
    ocrJobId: 1,
    status: 'reviewable',
    warningCodes: [],
    ...overrides,
  }
}

export function buildBatchWarning(overrides?: Partial<OcrBatchWarning>): OcrBatchWarning {
  return {
    code: 'SOURCE_STALE',
    message: '源文件已变更',
    sourceIndex: null,
    ...overrides,
  }
}

export function buildBatchCostSummary(
  overrides?: Partial<OcrBatchCostSummary>,
): OcrBatchCostSummary {
  return {
    totalInputTokens: 1000,
    totalOutputTokens: 200,
    totalTokens: 1200,
    estimatedCost: 0.01,
    currency: 'USD',
    ...overrides,
  }
}

export function buildBatchSummary(overrides?: Partial<OcrBatchSummary>): OcrBatchSummary {
  return {
    id: 1,
    organizationId: 1,
    projectId: 100,
    createdBy: 10,
    status: 'queued' as OcrBatchStatus,
    aggregateStatus: 'queued' as OcrBatchAggregateStatus,
    sourceCount: 2,
    completedCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    queuedCount: 2,
    processingCount: 0,
    idempotencyKeyHash: 'keyhash1',
    inputSignature: 'sig1',
    provider: 'anthropic',
    model: 'claude-fable-5',
    warningCodes: [],
    costSummary: null,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  }
}

export function buildBatchDetail(overrides?: Partial<OcrBatchDetail>): OcrBatchDetail {
  const base = buildBatchSummary(overrides)
  return {
    ...base,
    connectionId: 1,
    modelId: 1,
    promptHint: null,
    sources: [
      buildBatchSourceSummary(),
      buildBatchSourceSummary({ sourceIndex: 1, sourceAttachmentId: 102, ocrJobId: 2 }),
    ],
    warnings: [],
    allowedActions: ['view', 'create', 'inspect_queue', 'retry', 'cancel'],
    ...overrides,
  }
}

export function buildQueueItemSummary(
  overrides?: Partial<OcrQueueItemSummary>,
): OcrQueueItemSummary {
  return {
    id: 1,
    organizationId: 1,
    projectId: 100,
    batchId: 1,
    jobId: 1,
    pageId: null,
    workKind: 'job' as OcrQueueWorkKind,
    priority: 0,
    status: 'queued' as OcrQueueItemStatus,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    retryAfter: null,
    sourceHash: 'abc123def',
    failureCategory: 'none' as OcrQueueFailureCategory,
    warningCodes: [],
    provider: null,
    model: null,
    sourceRef: 'attachment/101',
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  }
}

export function buildQueueProjectSummary(
  overrides?: Partial<OcrQueueProjectSummary>,
): OcrQueueProjectSummary {
  return {
    projectId: 100,
    total: 2,
    queued: 2,
    processing: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    budgetBlocked: 0,
    rateLimited: 0,
    staleBlocked: 0,
    oldestQueuedAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fixture sets
// ---------------------------------------------------------------------------

/** 单文档 batch */
export const fixtureSingleDocumentBatch: OcrBatchCreateRequest = buildBatchCreateRequest({
  sources: [buildBatchSourceInput()],
  idempotencyKey: 'single-doc-batch',
})

/** 多文档 batch */
export const fixtureMultiDocumentBatch: OcrBatchCreateRequest = buildBatchCreateRequest({
  sources: [
    buildBatchSourceInput({ sourceAttachmentId: 101 }),
    buildBatchSourceInput({ sourceAttachmentId: 102 }),
    buildBatchSourceInput({ sourceAttachmentId: 103 }),
  ],
  idempotencyKey: 'multi-doc-batch',
})

/** 混合图片/PDF batch */
export const fixtureMixedImagePdfBatch: OcrBatchCreateRequest = buildBatchCreateRequest({
  sources: [
    buildBatchSourceInput({ sourceAttachmentId: 201 }),
    buildBatchSourceInput({ sourceAttachmentId: 202, sourceKind: 'upload' }),
  ],
  idempotencyKey: 'mixed-batch',
})

/** 已完成 batch 详情 */
export const fixtureCompletedBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'completed',
  aggregateStatus: 'succeeded',
  sourceCount: 2,
  completedCount: 2,
  failedCount: 0,
  queuedCount: 0,
  processingCount: 0,
})

/** 部分失败 batch 详情 */
export const fixturePartialFailureBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'partial',
  aggregateStatus: 'partial',
  sourceCount: 2,
  completedCount: 1,
  failedCount: 1,
  queuedCount: 0,
  processingCount: 0,
  warnings: [
    buildBatchWarning({ code: 'PARTIAL_FAILURE', message: '1 个源处理失败', sourceIndex: 1 }),
  ],
})

/** 已取消 batch 详情 */
export const fixtureCancelledBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'cancelled',
  aggregateStatus: 'cancelled',
  sourceCount: 2,
  completedCount: 0,
  failedCount: 0,
  cancelledCount: 2,
  queuedCount: 0,
  processingCount: 0,
  warnings: [buildBatchWarning({ code: 'CANCELLED_PENDING', message: '批量操作已取消' })],
  allowedActions: ['view', 'inspect_queue', 'create'],
})

/** 预算阻断 batch 详情 */
export const fixtureBudgetBlockedBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'processing',
  aggregateStatus: 'budget_blocked',
  sourceCount: 1,
  completedCount: 0,
  failedCount: 0,
  queuedCount: 0,
  processingCount: 1,
  warnings: [buildBatchWarning({ code: 'BUDGET_BLOCK', message: '预算硬限已达' })],
})

/** 限流 batch 详情 */
export const fixtureRateLimitedBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'processing',
  aggregateStatus: 'rate_limited',
  sourceCount: 1,
  completedCount: 0,
  failedCount: 0,
  queuedCount: 0,
  processingCount: 1,
  warnings: [buildBatchWarning({ code: 'RATE_LIMIT_WAIT', message: 'RPM/TPM 限流等待中' })],
})

/** stale source 阻断 batch 详情 */
export const fixtureStaleBlockedBatchDetail: OcrBatchDetail = buildBatchDetail({
  status: 'partial',
  aggregateStatus: 'stale_blocked',
  sourceCount: 2,
  completedCount: 1,
  failedCount: 1,
  queuedCount: 0,
  processingCount: 0,
  warnings: [
    buildBatchWarning({
      code: 'SOURCE_STALE',
      message: '源文件已更改，请重新提交',
      sourceIndex: 1,
    }),
  ],
})

/** 只读降级 batch 详情 */
export const fixtureReadOnlyBatchDetail: OcrBatchDetail = buildBatchDetail({
  allowedActions: ['view', 'inspect_queue'],
})

/** 重复调度测试——两个 dispatcher 竞争同一 queue item */
export const fixtureDuplicateDispatchQueueItem: OcrQueueItemInternal = buildQueueItemSummary({
  id: 1,
  status: 'processing',
  attemptCount: 1,
}) as OcrQueueItemInternal
// Add internal lock fields
fixtureDuplicateDispatchQueueItem.lockOwner = 'dispatcher-a'
fixtureDuplicateDispatchQueueItem.lockedAt = '2026-08-03T10:00:01.000Z'

/** 超时锁定项 */
export const fixtureStaleLockedQueueItem: OcrQueueItemInternal = buildQueueItemSummary({
  id: 2,
  status: 'claimed',
}) as OcrQueueItemInternal
fixtureStaleLockedQueueItem.lockedAt = '2026-08-03T09:50:00.000Z' // 10+ minutes ago
fixtureStaleLockedQueueItem.lockOwner = 'dispatcher-dead'

/** 大数量 queue items（用于性能探针） */
export function buildLargeQueueItemSet(count: number): OcrQueueItemSummary[] {
  return Array.from({ length: count }, (_, i) =>
    buildQueueItemSummary({
      id: i + 1,
      jobId: i + 1,
      sourceHash: `hash${i.toString(16)}`,
      status: i % 5 === 0 ? 'succeeded' : i % 3 === 0 ? 'queued' : 'processing',
    }),
  )
}

/** 多种 queue item 状态混合集 */
export const fixtureMixedQueueItems: OcrQueueItemSummary[] = [
  buildQueueItemSummary({ id: 1, status: 'queued' }),
  buildQueueItemSummary({ id: 2, status: 'processing' }),
  buildQueueItemSummary({ id: 3, status: 'succeeded' }),
  buildQueueItemSummary({
    id: 4,
    status: 'failed',
    failureCategory: 'timeout',
    attemptCount: 1,
    warningCodes: ['SOURCE_STALE'],
  }),
  buildQueueItemSummary({ id: 5, status: 'budget_blocked', failureCategory: 'budget_blocked' }),
  buildQueueItemSummary({ id: 6, status: 'cancelled' }),
  buildQueueItemSummary({ id: 7, status: 'rate_limited', retryAfter: '2026-08-03T10:05:00.000Z' }),
  buildQueueItemSummary({ id: 8, status: 'stale_blocked', warningCodes: ['SOURCE_STALE'] }),
]
