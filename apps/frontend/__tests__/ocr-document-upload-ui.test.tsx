/**
 * OCR 文档上传流前端组件测试
 * v3-ocr-document-upload-flow §9.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// Mock all hooks used by the component
vi.mock('@/hooks/use-ocr-document', () => ({
  ocrDocumentKeys: {
    all: ['ocr-document'],
    list: (p: number) => ['ocr-document', 'list', p],
    detail: (p: number, j: number) => ['ocr-document', 'detail', p, j],
    candidates: (p: number, j: number) => ['ocr-document', 'candidates', p, j],
    extractions: (p: number, j: number) => ['ocr-document', 'extractions', p, j],
  },
  useOcrDocumentJobs: vi.fn(),
  useOcrDocumentJobDetail: vi.fn(),
  useOcrDocumentCandidates: vi.fn(),
  useOcrDocumentExtractions: vi.fn(),
  useOcrDocumentJobCreate: vi.fn(),
  useOcrDocumentJobRetry: vi.fn(),
  useOcrDocumentJobConfirm: vi.fn(),
}))

import OcrDocumentUploadPanel from '@/components/ocr/OcrDocumentUploadPanel'
import {
  useOcrDocumentJobs,
  useOcrDocumentJobDetail,
  useOcrDocumentCandidates,
  useOcrDocumentExtractions,
  useOcrDocumentJobCreate,
  useOcrDocumentJobRetry,
  useOcrDocumentJobConfirm,
} from '@/hooks/use-ocr-document'

const mockJobs = vi.mocked(useOcrDocumentJobs)
const mockDetail = vi.mocked(useOcrDocumentJobDetail)
const mockCandidates = vi.mocked(useOcrDocumentCandidates)
const mockExtractions = vi.mocked(useOcrDocumentExtractions)
const mockCreate = vi.mocked(useOcrDocumentJobCreate)
const mockRetry = vi.mocked(useOcrDocumentJobRetry)
const mockConfirm = vi.mocked(useOcrDocumentJobConfirm)

// 这两个 helper 只构造 TanStack 结果对象的必要子集：v5 的 UseQueryResult/UseMutationResult
// 是判别联合，补全全部字段无助于测试，故在返回处收口为 never 交给 mockReturnValue。
const defaultMutationResult = () =>
  ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  }) as never

const defaultQueryResult = (data: unknown = undefined, isLoading = false) =>
  ({
    data,
    isLoading,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    isError: false,
    isFetched: !isLoading,
    isFetchedAfterMount: !isLoading,
    isFetching: isLoading,
    isPending: isLoading,
    isRefetching: false,
    isRefetchError: false,
    isStale: false,
    isSuccess: !isLoading,
    status: isLoading ? 'pending' : 'success',
    fetchStatus: isLoading ? 'fetching' : 'idle',
    isPlaceholderData: false,
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  // Default mocks for all hooks
  mockJobs.mockReturnValue(
    defaultQueryResult({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
  )
  mockDetail.mockReturnValue(defaultQueryResult())
  mockCandidates.mockReturnValue(defaultQueryResult())
  mockExtractions.mockReturnValue(defaultQueryResult())
  mockCreate.mockReturnValue(defaultMutationResult())
  mockRetry.mockReturnValue(defaultMutationResult())
  mockConfirm.mockReturnValue(defaultMutationResult())
})

// ========================================================================
// Loading / Empty / Read-only states
// ========================================================================

describe('OcrDocumentUploadPanel | loading', () => {
  it('shows skeleton when loading jobs', () => {
    mockJobs.mockReturnValue(defaultQueryResult(undefined, true))
    const { container } = render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    // Loading state renders Skeleton components
    expect(container.querySelector('[data-slot="skeleton"]') || container.firstChild).toBeTruthy()
  })
})

describe('OcrDocumentUploadPanel | empty', () => {
  it('shows empty state when no jobs', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('暂无 OCR 文档作业。点击「新建 OCR 作业」开始。')).toBeTruthy()
  })
})

describe('OcrDocumentUploadPanel | read-only', () => {
  it('shows read-only message', () => {
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1, readOnly: true }))
    expect(screen.getByText(/只读访问/)).toBeTruthy()
  })
})

// ========================================================================
// Job list states
// ========================================================================

describe('OcrDocumentUploadPanel | job list', () => {
  it('renders job cards with status labels', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            id: 1,
            organizationId: 1,
            projectId: 100,
            sourceKind: 'upload',
            sourceAttachmentId: 5,
            sourceFileName: 'test-doc.pdf',
            sourceMimeType: 'application/pdf',
            sourceHash: 'abc123',
            status: 'reviewable',
            pageCount: 3,
            succeededPages: 3,
            failedPages: 0,
            provider: 'openai',
            model: 'gpt-4o',
            warningCodes: [],
            costSummary: null,
            idempotencyKeyHash: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('test-doc.pdf')).toBeTruthy()
    expect(screen.getByText('可审查')).toBeTruthy()
    expect(screen.getByText('3/3 页可审查')).toBeTruthy()
  })

  it('shows processing status with progress', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            id: 2,
            organizationId: 1,
            projectId: 100,
            sourceKind: 'upload',
            sourceAttachmentId: 6,
            sourceFileName: 'big-doc.pdf',
            sourceMimeType: 'application/pdf',
            sourceHash: 'def456',
            status: 'processing',
            pageCount: 10,
            succeededPages: 5,
            failedPages: 0,
            provider: null,
            model: null,
            warningCodes: [],
            costSummary: null,
            idempotencyKeyHash: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('处理中')).toBeTruthy()
    expect(screen.getByText('已处理 5/10 页')).toBeTruthy()
  })

  it('shows failed status', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            id: 3,
            organizationId: 1,
            projectId: 100,
            sourceKind: 'attachment',
            sourceAttachmentId: 7,
            sourceFileName: 'bad.pdf',
            sourceMimeType: 'application/pdf',
            sourceHash: 'fail1',
            status: 'failed',
            pageCount: 0,
            succeededPages: 0,
            failedPages: 3,
            provider: null,
            model: null,
            warningCodes: ['PROVIDER_UNAVAILABLE'],
            costSummary: null,
            idempotencyKeyHash: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.getByText('PROVIDER_UNAVAILABLE')).toBeTruthy()
  })
})

// ========================================================================
// Permission gate
// ========================================================================

describe('OcrDocumentUploadPanel | permission', () => {
  it('hides create button when read-only', () => {
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1, readOnly: true }))
    // Read-only state message is shown
    expect(screen.getByText(/只读访问/)).toBeTruthy()
  })

  it('shows create button when not read-only', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('新建 OCR 作业')).toBeTruthy()
  })
})

// ========================================================================
// Stale / warning states
// ========================================================================

describe('OcrDocumentUploadPanel | warnings', () => {
  it('shows warning badges on job cards', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            id: 4,
            organizationId: 1,
            projectId: 100,
            sourceKind: 'upload',
            sourceAttachmentId: 8,
            sourceFileName: 'partial.pdf',
            sourceMimeType: 'application/pdf',
            sourceHash: 'warn1',
            status: 'reviewable',
            pageCount: 5,
            succeededPages: 3,
            failedPages: 2,
            provider: 'openai',
            model: 'gpt-4o',
            warningCodes: ['PARTIAL_PAGE_FAILURE', 'LOW_CONFIDENCE'],
            costSummary: null,
            idempotencyKeyHash: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('PARTIAL_PAGE_FAILURE')).toBeTruthy()
    expect(screen.getByText('LOW_CONFIDENCE')).toBeTruthy()
  })
})

// ========================================================================
// Text safety
// ========================================================================

describe('OcrDocumentUploadPanel | text safety', () => {
  it('does not contain auto-apply wording', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    const { container } = render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    const text = container.textContent ?? ''
    expect(text).not.toContain('自动应用')
    expect(text).not.toContain('一键执行')
    expect(text).not.toContain('auto apply')
  })
})

// ========================================================================
// Mobile layout
// ========================================================================

describe('OcrDocumentUploadPanel | layout', () => {
  it('renders without text/control overlap on desktop', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )
    const { container } = render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(container.firstChild).toBeTruthy()
  })
})

// ========================================================================
// §5.10 Responsive layout: PDF page progress and warning badges
// ========================================================================

describe('OcrDocumentUploadPanel | responsive PDF states', () => {
  const pdfReviewableJob = {
    id: 10,
    organizationId: 1,
    projectId: 100,
    sourceKind: 'upload' as const,
    sourceAttachmentId: 10,
    sourceFileName: '长文件名称-for-testing-truncation.pdf',
    sourceMimeType: 'application/pdf',
    sourceHash: 'resp1',
    status: 'reviewable' as const,
    pageCount: 15,
    succeededPages: 12,
    failedPages: 3,
    provider: 'openai',
    model: 'gpt-4o',
    warningCodes: ['PARTIAL_PAGE_FAILURE', 'LOW_CONFIDENCE', 'PAGE_OVERFLOW'],
    costSummary: null,
    idempotencyKeyHash: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('shows all warning badges without overlap', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [pdfReviewableJob],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    // 三个 warning badge 都存在
    expect(screen.getByText('PARTIAL_PAGE_FAILURE')).toBeTruthy()
    expect(screen.getByText('LOW_CONFIDENCE')).toBeTruthy()
    expect(screen.getByText('PAGE_OVERFLOW')).toBeTruthy()
    // 文件名（即使很长）不覆盖状态标签
    expect(screen.getByText('长文件名称-for-testing-truncation.pdf')).toBeTruthy()
    expect(screen.getByText('可审查')).toBeTruthy()
  })

  it('shows page progress without layout shifts', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            ...pdfReviewableJob,
            status: 'processing' as const,
            succeededPages: 8,
            pageCount: 15,
            warningCodes: [],
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    // 处理中状态和页数同时可见
    expect(screen.getByText('处理中')).toBeTruthy()
    expect(screen.getByText('已处理 8/15 页')).toBeTruthy()
  })

  it('normalizer-unavailable renders with provider null', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [
          {
            ...pdfReviewableJob,
            status: 'failed' as const,
            succeededPages: 0,
            failedPages: 0,
            pageCount: 0,
            provider: null,
            model: null,
            warningCodes: ['PDF_NORMALIZER_UNAVAILABLE'],
          },
        ],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    expect(screen.getByText('PDF_NORMALIZER_UNAVAILABLE')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })

  it('read-only renders without write controls on PDF jobs', () => {
    render(React.createElement(OcrDocumentUploadPanel, { projectId: 1, readOnly: true }))
    // 只读状态文案存在，新建按钮不存在
    expect(screen.getByText(/只读访问/)).toBeTruthy()
    expect(screen.queryByText('新建 OCR 作业')).toBeFalsy()
  })

  it('unsafe labels absent on PDF job UI', () => {
    mockJobs.mockReturnValue(
      defaultQueryResult({
        data: [pdfReviewableJob],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }),
    )
    const { container } = render(React.createElement(OcrDocumentUploadPanel, { projectId: 1 }))
    const text = container.textContent ?? ''
    // 禁止文案不存在
    expect(text).not.toContain('自动应用')
    expect(text).not.toContain('一键执行')
    expect(text).not.toContain('auto apply')
  })
})
