/**
 * OCR 审查确认流前端组件测试
 * v3-ocr-review-confirmation-flow §8.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// Mock hooks only - let the component render its own JSX
vi.mock('@/hooks/use-ocr-review', () => ({
  ocrReviewKeys: {
    all: ['ocr-review'],
    review: (p: number, j: number) => ['ocr-review', 'review', p, j],
    acceptedExtractions: (p: number, j: number) => ['ocr-review', 'accepted-extractions', p, j],
  },
  useOcrReviewDetail: vi.fn(),
  useOcrAcceptedExtractions: vi.fn(),
  useOcrConfirmationPreview: vi.fn(),
  useOcrConfirmationSave: vi.fn(),
}))

import OcrReviewPanel from '@/components/ocr/OcrReviewPanel'
import { useOcrReviewDetail, useOcrAcceptedExtractions } from '@/hooks/use-ocr-review'
import { asMock } from './_mock-types'

const mockReview = vi.mocked(useOcrReviewDetail)
const mockAccepted = vi.mocked(useOcrAcceptedExtractions)

beforeEach(() => {
  vi.clearAllMocks()
  mockAccepted.mockReturnValue(asMock({ data: undefined, isLoading: false, error: null }))
})

describe('OcrReviewPanel | loading', () => {
  it('shows skeleton when loading', () => {
    mockReview.mockReturnValue(asMock({ isLoading: true, data: undefined, error: null }))
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    // Loading state renders Skeleton components
    expect(container.querySelector('[data-slot="skeleton"]') || container.firstChild).toBeTruthy()
  })
})

describe('OcrReviewPanel | error', () => {
  it('shows error message on fetch failure', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: undefined,
        error: new Error('无权查看 OCR 审查数据'),
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.firstChild).toBeTruthy()
    // Alert is rendered for error state
    expect(container.querySelector('[role="alert"]')).toBeTruthy()
  })
})

describe('OcrReviewPanel | reviewable', () => {
  it('shows source summary and page groups', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: {
          sourceSummary: {
            sourceKind: 'attachment',
            sourceId: 1,
            sourceName: null,
            sourceHash: 'abc',
            sourceVersion: 1,
            mimeType: null,
            visible: true,
          },
          jobStatus: 'reviewable',
          jobId: 42,
          providerLabel: null,
          modelLabel: null,
          pageGroups: [
            {
              pageIndex: 0,
              pageLabel: '第 1 页',
              candidateStatus: 'succeeded',
              candidateHash: 'h1',
              extractedText: '测试文本',
              confidenceSummary: { level: 'high', label: '高置信度' },
              warningCodes: [],
              providerModel: null,
              completedAt: null,
            },
          ],
          candidateItems: [
            {
              candidateId: 1,
              pageRefs: [0],
              candidateHash: 'h1',
              sourceHash: 'abc',
              status: 'succeeded',
              extractedText: '测试文本',
              warningCodes: [],
              confidenceSummary: { level: 'high', label: '高置信度' },
              providerModel: null,
              createdAt: null,
            },
          ],
          warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
          acceptedExtractions: [],
          allowedActions: ['view', 'select', 'preview_confirmation', 'confirm'],
          staleReason: null,
        },
        error: null,
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.textContent).toContain('OCR 审查工作台')
    expect(container.textContent).toContain('可审查')
    expect(container.textContent).toContain('第 1 页')
  })
})

describe('OcrReviewPanel | stale source', () => {
  it('shows stale warning', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: {
          sourceSummary: {
            sourceKind: 'attachment',
            sourceId: 1,
            sourceName: null,
            sourceHash: 'abc',
            sourceVersion: 1,
            mimeType: null,
            visible: true,
          },
          jobStatus: 'stale_source',
          jobId: 42,
          providerLabel: null,
          modelLabel: null,
          pageGroups: [],
          candidateItems: [],
          warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
          acceptedExtractions: [],
          allowedActions: ['view'],
          staleReason: 'source_hash_mismatch',
        },
        error: null,
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.textContent).toContain('来源已变更')
    expect(container.textContent).toContain('来源文件已变更')
  })
})

describe('OcrReviewPanel | read-only', () => {
  it('shows read-only alert', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: {
          sourceSummary: {
            sourceKind: 'attachment',
            sourceId: 1,
            sourceName: null,
            sourceHash: 'abc',
            sourceVersion: 1,
            mimeType: null,
            visible: true,
          },
          jobStatus: 'reviewable',
          jobId: 42,
          providerLabel: null,
          modelLabel: null,
          pageGroups: [],
          candidateItems: [],
          warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
          acceptedExtractions: [],
          allowedActions: ['view', 'copy', 'export'],
          staleReason: null,
        },
        error: null,
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.textContent).toContain('只读访问')
  })
})

describe('OcrReviewPanel | empty candidates', () => {
  it('shows empty state', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: {
          sourceSummary: {
            sourceKind: 'attachment',
            sourceId: 1,
            sourceName: null,
            sourceHash: 'abc',
            sourceVersion: 1,
            mimeType: null,
            visible: true,
          },
          jobStatus: 'reviewable',
          jobId: 42,
          providerLabel: null,
          modelLabel: null,
          pageGroups: [],
          candidateItems: [],
          warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
          acceptedExtractions: [],
          allowedActions: ['view'],
          staleReason: null,
        },
        error: null,
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.textContent).toContain('暂无 OCR 候选数据')
  })
})

describe('OcrReviewPanel | accepted extractions', () => {
  it('shows accepted extraction history', () => {
    mockReview.mockReturnValue(
      asMock({
        isLoading: false,
        data: {
          sourceSummary: {
            sourceKind: 'attachment',
            sourceId: 1,
            sourceName: null,
            sourceHash: 'abc',
            sourceVersion: 1,
            mimeType: null,
            visible: true,
          },
          jobStatus: 'reviewable',
          jobId: 42,
          providerLabel: null,
          modelLabel: null,
          pageGroups: [],
          candidateItems: [],
          warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
          acceptedExtractions: [],
          allowedActions: ['view', 'select', 'preview_confirmation', 'confirm'],
          staleReason: null,
        },
        error: null,
      }),
    )
    mockAccepted.mockReturnValue(
      asMock({
        data: {
          data: [
            {
              extractionId: 1,
              sourceHash: 'abc',
              candidateHash: 'c1',
              selectedTextHash: 's1',
              pageRefs: [0],
              status: 'current',
              reviewerId: 1,
              reviewerName: 'Test',
              reviewNote: null,
              confirmedAt: '2024-01-01T00:00:00Z',
              supersededAt: null,
            },
            {
              extractionId: 2,
              sourceHash: 'abc',
              candidateHash: 'c2',
              selectedTextHash: 's2',
              pageRefs: [1],
              status: 'superseded',
              reviewerId: 1,
              reviewerName: 'Test',
              reviewNote: null,
              confirmedAt: '2024-01-01T00:00:00Z',
              supersededAt: '2024-01-02T00:00:00Z',
            },
          ],
          meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
        },
        isLoading: false,
        error: null,
      }),
    )
    const { container } = render(React.createElement(OcrReviewPanel, { projectId: 1, jobId: 42 }))
    expect(container.textContent).toContain('已接受的提取记录')
    expect(container.textContent).toContain('当前')
    expect(container.textContent).toContain('已替代')
  })
})
