/**
 * V3 OCR UI In Documents — 夹具
 *
 * 为每个工作区状态和代表性文档/附件行提供预定义夹具，
 * 供测试和开发使用。不调用真实 OCR provider。
 */

import type { OcrDocumentJobSummary } from './ocr-document-upload.js'
import type {
  OcrDocumentWorkspaceRowSummary,
  OcrDocumentWorkspaceStatus,
  OcrDocumentWorkspaceFilters,
  OcrDocumentWorkspaceSortConfig,
} from './ocr-ui-in-documents.js'

// ---------------------------------------------------------------------------
// OCR 作业夹具构建器
// ---------------------------------------------------------------------------

let _mockJobId = 1000
function nextJobId(): number {
  return ++_mockJobId
}

export function buildOcrJobFixture(
  overrides: Partial<OcrDocumentJobSummary> = {},
): OcrDocumentJobSummary {
  return {
    id: nextJobId(),
    organizationId: 1,
    projectId: 1,
    sourceKind: 'attachment',
    sourceAttachmentId: 1,
    sourceFileName: 'test-document.pdf',
    sourceMimeType: 'application/pdf',
    sourceHash: 'abc123hash',
    status: 'reviewable',
    pageCount: 5,
    succeededPages: 5,
    failedPages: 0,
    provider: 'mock-provider',
    model: 'mock-model-v1',
    warningCodes: [],
    costSummary: {
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
      totalTokens: 7000,
      estimatedCost: 0.015,
      currency: 'USD',
    },
    idempotencyKeyHash: 'ik-abc123',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:05:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 工作区行摘要夹具构建器
// ---------------------------------------------------------------------------

export function buildWorkspaceRowSummary(
  overrides: Partial<OcrDocumentWorkspaceRowSummary> = {},
): OcrDocumentWorkspaceRowSummary {
  return {
    sourceId: 1,
    sourceKind: 'attachment',
    sourceFileName: 'project-plan-v2.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'no_job',
    latestJobId: null,
    latestJobStatus: null,
    latestJobCreatedAt: null,
    succeededPages: null,
    totalPages: null,
    warningCodes: [],
    warningReasons: [],
    blockReason: null,
    allowedActions: ['create_ocr', 'view_governance'],
    estimatedCost: null,
    costCurrency: null,
    isStale: false,
    hasAcceptedExtraction: false,
    acceptedExtractionId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 每个工作区状态的预构建夹具
// ---------------------------------------------------------------------------

/** 不支持的文件类型 */
export function unsupportedRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 10,
    sourceFileName: 'logo.svg',
    sourceMimeType: 'image/svg+xml',
    isSupported: false,
    status: 'unsupported',
    allowedActions: [],
    ...overrides,
  })
}

/** 无作业的受支持文件 */
export function noJobRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 20,
    sourceFileName: 'meeting-notes.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'no_job',
    allowedActions: ['create_ocr', 'view_governance'],
    ...overrides,
  })
}

/** 排队中的作业 */
export function queuedRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 30,
    sourceFileName: 'contract-v3.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'queued',
    latestJobId: 100,
    latestJobStatus: 'queued',
    latestJobCreatedAt: '2026-07-15T09:00:00.000Z',
    allowedActions: ['view_governance'],
    ...overrides,
  })
}

/** 处理中的作业 */
export function processingRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 40,
    sourceFileName: 'annual-report.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'processing',
    latestJobId: 101,
    latestJobStatus: 'processing',
    latestJobCreatedAt: '2026-07-15T09:05:00.000Z',
    succeededPages: 3,
    totalPages: 12,
    allowedActions: ['view_governance'],
    ...overrides,
  })
}

/** 失败的作业 */
export function failedRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 50,
    sourceFileName: 'corrupted-scan.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'failed',
    latestJobId: 102,
    latestJobStatus: 'failed',
    latestJobCreatedAt: '2026-07-15T08:00:00.000Z',
    warningCodes: ['PROVIDER_UNAVAILABLE'],
    warningReasons: ['provider_degradation'],
    allowedActions: ['retry_ocr', 'create_ocr', 'view_governance'],
    ...overrides,
  })
}

/** 待审查的作业 */
export function reviewableRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 60,
    sourceFileName: 'design-spec.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'reviewable',
    latestJobId: 103,
    latestJobStatus: 'reviewable',
    latestJobCreatedAt: '2026-07-15T10:00:00.000Z',
    succeededPages: 10,
    totalPages: 10,
    estimatedCost: 0.025,
    costCurrency: 'USD',
    allowedActions: ['review', 'retry_ocr', 'view_governance'],
    ...overrides,
  })
}

/** 已确认的提取 */
export function confirmedRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 70,
    sourceFileName: 'quarterly-results.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'confirmed',
    latestJobId: 104,
    latestJobStatus: 'reviewable',
    latestJobCreatedAt: '2026-07-14T14:00:00.000Z',
    succeededPages: 8,
    totalPages: 8,
    estimatedCost: 0.018,
    costCurrency: 'USD',
    hasAcceptedExtraction: true,
    acceptedExtractionId: 200,
    allowedActions: [
      'review',
      'retry_ocr',
      'export',
      'copy',
      'search_index',
      'structured_extraction',
      'entity_linking',
      'view_governance',
    ],
    ...overrides,
  })
}

/** Stale 源（源文件已变更，需重新 OCR） */
export function staleRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 80,
    sourceFileName: 'updated-proposal.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'stale',
    latestJobId: 105,
    latestJobStatus: 'reviewable',
    latestJobCreatedAt: '2026-07-13T11:00:00.000Z',
    succeededPages: 6,
    totalPages: 6,
    isStale: true,
    warningCodes: ['STALE_SOURCE'],
    warningReasons: ['stale_source'],
    allowedActions: ['retry_ocr', 'review', 'view_governance'],
    ...overrides,
  })
}

/** 保留策略阻止 */
export function retentionHoldRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 90,
    sourceFileName: 'legal-hold-doc.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'blocked',
    latestJobId: 106,
    latestJobStatus: 'reviewable',
    latestJobCreatedAt: '2026-07-10T08:00:00.000Z',
    blockReason: 'retention_hold',
    hasAcceptedExtraction: true,
    acceptedExtractionId: 201,
    allowedActions: ['view_governance'],
    ...overrides,
  })
}

/** 隐私策略阻止 */
export function privacyBlockRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 100,
    sourceFileName: null, // 隐藏
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'blocked',
    latestJobId: null,
    latestJobStatus: null,
    latestJobCreatedAt: null,
    blockReason: 'privacy_block',
    allowedActions: ['view_governance'],
    warningReasons: ['privacy_constrained'],
    ...overrides,
  })
}

/** 只读降级 */
export function readOnlyDegradedRow(overrides: Partial<OcrDocumentWorkspaceRowSummary> = {}) {
  return buildWorkspaceRowSummary({
    sourceId: 110,
    sourceFileName: 'readonly-team-doc.pdf',
    sourceMimeType: 'application/pdf',
    isSupported: true,
    status: 'degraded',
    latestJobId: 107,
    latestJobStatus: 'reviewable',
    latestJobCreatedAt: '2026-07-12T15:00:00.000Z',
    blockReason: 'permission_denied',
    allowedActions: ['view_governance'],
    warningReasons: ['read_only'],
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// 多作业测试数据（用于验证 selectLatestOcrJobForSource）
// ---------------------------------------------------------------------------

export function multiJobFixtures(): OcrDocumentJobSummary[] {
  const baseAttachmentId = 500
  return [
    buildOcrJobFixture({
      id: 10,
      sourceAttachmentId: baseAttachmentId,
      status: 'failed',
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:05:00.000Z',
    }),
    buildOcrJobFixture({
      id: 11,
      sourceAttachmentId: baseAttachmentId,
      status: 'reviewable',
      createdAt: '2026-07-02T10:00:00.000Z',
      updatedAt: '2026-07-02T10:05:00.000Z',
    }),
    buildOcrJobFixture({
      id: 12,
      sourceAttachmentId: baseAttachmentId,
      status: 'processing',
      createdAt: '2026-07-03T10:00:00.000Z',
      updatedAt: '2026-07-03T10:05:00.000Z',
    }),
  ]
}

// ---------------------------------------------------------------------------
// 1000 行大规模测试数据
// ---------------------------------------------------------------------------

export function largeWorkspaceRows(count: number = 1000): OcrDocumentWorkspaceRowSummary[] {
  const rows: OcrDocumentWorkspaceRowSummary[] = []
  const statuses: OcrDocumentWorkspaceStatus[] = [
    'no_job',
    'queued',
    'processing',
    'failed',
    'reviewable',
    'confirmed',
    'stale',
    'unsupported',
  ]

  for (let i = 0; i < count; i++) {
    const status = statuses[i % statuses.length]
    const hasJob = !(status === 'no_job' || status === 'unsupported')
    rows.push(
      buildWorkspaceRowSummary({
        sourceId: i + 1,
        sourceFileName: `doc-${String(i).padStart(4, '0')}.pdf`,
        status,
        latestJobId: hasJob ? 200 + i : null,
        latestJobStatus: hasJob ? 'reviewable' : null,
        latestJobCreatedAt: hasJob
          ? new Date(Date.UTC(2026, 6, 1) + i * 3600_000).toISOString()
          : null,
        allowedActions:
          status === 'no_job'
            ? ['create_ocr', 'view_governance']
            : status === 'reviewable'
              ? ['review', 'retry_ocr', 'view_governance']
              : status === 'confirmed'
                ? [
                    'review',
                    'retry_ocr',
                    'export',
                    'copy',
                    'search_index',
                    'structured_extraction',
                    'entity_linking',
                    'view_governance',
                  ]
                : status === 'failed'
                  ? ['retry_ocr', 'create_ocr', 'view_governance']
                  : ['view_governance'],
      }),
    )
  }

  return rows
}

// ---------------------------------------------------------------------------
// 默认筛选 / 排序配置
// ---------------------------------------------------------------------------

export const defaultOcrWorkspaceFilters: OcrDocumentWorkspaceFilters = {
  status: null,
  isSupported: null,
  search: null,
}

export const defaultOcrWorkspaceSort: OcrDocumentWorkspaceSortConfig = {
  field: 'latestJobCreatedAt',
  direction: 'desc',
}
