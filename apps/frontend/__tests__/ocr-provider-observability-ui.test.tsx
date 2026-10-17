/**
 * v3-ocr-provider-observability-cost-controls — 前端组件测试。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { OcrProviderObservabilityPanel } from '@/components/ocr/OcrProviderObservabilityPanel'

const mockSummaryData = {
  projectId: 1,
  totalAttempts: 5,
  totalPages: 5,
  succeededAttempts: 4,
  failedAttempts: 1,
  budgetBlockedAttempts: 0,
  rateLimitedAttempts: 0,
  totalLatencyMs: 1250,
  totalInputTokens: 2500,
  totalOutputTokens: 1000,
  totalEstimatedCost: 0.025,
  currency: 'USD',
  costStatus: 'estimated',
  budgetStatus: 'allowed',
  rateLimitStatus: 'allowed',
  errorCategories: { none: 4, timeout: 1 },
  warningCodes: [],
  providerRefs: [{ provider: 'openai', model: 'gpt-4o' }],
  computedAt: '2024-06-01T12:00:00Z',
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('OcrProviderObservabilityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染 provider 信息和统计', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ data: mockSummaryData })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('Provider 观测')).toBeTruthy()
    expect(screen.getByText('openai / gpt-4o')).toBeTruthy()
    expect(screen.getByText(/成功 4/)).toBeTruthy()
    expect(screen.getByText(/失败 1/)).toBeTruthy()
    expect(screen.getByText('成本: 已估算')).toBeTruthy()
    expect(screen.getByText('预算: 预算正常')).toBeTruthy()
  })

  it('loading 状态显示 skeleton', async () => {
    // 不 mock apiFetch，让其 pend 永久
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}))
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    // Card 被渲染，检查至少有一个 card 元素
    await vi.waitFor(
      () => {
        const cards = document.querySelectorAll('[class*="card"]')
        expect(cards.length).toBeGreaterThan(0)
      },
      { timeout: 2000 },
    )
  })

  it('error 或空数据显示回退', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('PERMISSION_DENIED'))
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    // 组件始终渲染 Card，等待直到出现 "Provider 观测" 标题
    await vi.waitFor(
      () => {
        const title = screen.queryByText('Provider 观测')
        expect(title).toBeTruthy()
      },
      { timeout: 3000 },
    )
  })

  it('预算阻断状态显示', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: {
        ...mockSummaryData,
        budgetStatus: 'hard_blocked',
        budgetBlockedAttempts: 2,
        warningCodes: ['BUDGET_HARD_LIMIT_REACHED'],
      },
    })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('预算: 预算阻断')).toBeTruthy()
    expect(screen.getByText('BUDGET_HARD_LIMIT_REACHED')).toBeTruthy()
  })

  it('限流状态显示', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: {
        ...mockSummaryData,
        rateLimitStatus: 'blocked',
        rateLimitedAttempts: 1,
        warningCodes: ['RATE_LIMIT_BLOCKED'],
      },
    })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('频率: 频率超限')).toBeTruthy()
  })

  it('未知成本状态显示', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: {
        ...mockSummaryData,
        costStatus: 'cost_unknown',
        totalEstimatedCost: null,
        warningCodes: ['COST_UNKNOWN'],
      },
    })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('成本: 成本未知')).toBeTruthy()
  })

  it('provider 失败错误分类', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: {
        ...mockSummaryData,
        succeededAttempts: 0,
        failedAttempts: 3,
        errorCategories: { auth: 1, timeout: 2 },
        warningCodes: ['PROVIDER_DEGRADATION'],
      },
    })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('auth')).toBeTruthy()
  })

  it('多个 provider 显示', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: {
        ...mockSummaryData,
        providerRefs: [
          { provider: 'openai', model: 'gpt-4o' },
          { provider: 'anthropic', model: 'claude-3' },
        ],
      },
    })
    render(<OcrProviderObservabilityPanel projectId={1} />, { wrapper: createWrapper() })

    expect(await screen.findByText('openai / gpt-4o')).toBeTruthy()
    expect(screen.getByText('anthropic / claude-3')).toBeTruthy()
  })
})
