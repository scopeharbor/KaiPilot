/**
 * CompilerObservabilitySummary 组件测试（tasks 5.5）。
 *
 * 覆盖：
 * - loading: 骨架屏
 * - error: 错误提示
 * - empty: 无数据
 * - soft warning: 软预算告警
 * - hard blocked: 硬预算阻断 + 无绕过按钮
 * - 估算成本文案（非财务账单）
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CompilerObservabilitySummary } from '@/components/compiler/compiler-observability-summary'
import type { ObservabilitySummary } from '@aiproj/compiler-spec'

// Mock the API
vi.mock('@/lib/api/compiler', () => ({
  compilerApi: {
    getObservabilitySummary: vi.fn(),
  },
}))

import { compilerApi } from '@/lib/api/compiler'

const mockGetSummary = compilerApi.getObservabilitySummary as ReturnType<typeof vi.fn>

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CompilerObservabilitySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loading state shows skeleton (no title text)', () => {
    mockGetSummary.mockReturnValue(new Promise(() => {})) // never resolves
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })
    // Loading skeleton should not contain the title text
    expect(screen.queryByText('编译器运行摘要')).toBeNull()
  })

  it('error state shows error message', async () => {
    // Component has retry:1, so mock needs to fail twice
    mockGetSummary
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    const errorEl = await screen.findByText('无法加载可观测摘要', {}, { timeout: 5000 })
    expect(errorEl).toBeDefined()
  })

  it('empty state shows no data message when data is null', async () => {
    mockGetSummary.mockResolvedValue({ data: null })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    const emptyEl = await screen.findByText('暂无可观测数据')
    expect(emptyEl).toBeDefined()
  })

  it('displays within_budget status', async () => {
    const summary: ObservabilitySummary = {
      compilerRunId: 42,
      budgetStatus: 'within_budget',
      totalEvents: 5,
      totalLlmCalls: 2,
      totalDurationMs: 12000,
    }
    mockGetSummary.mockResolvedValue({ data: summary })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    const badge = await screen.findByText('预算正常')
    expect(badge).toBeDefined()
    expect(screen.getByText('编译器运行摘要')).toBeDefined()
  })

  it('displays soft warning with messages', async () => {
    const summary: ObservabilitySummary = {
      compilerRunId: 42,
      budgetStatus: 'soft_exceeded',
      budgetWarnings: ['软预算超出: 累计 0.06'],
      costSummary: [
        {
          dimension: 'total',
          label: '总成本',
          estimatedCost: 0.06,
          currency: 'CNY',
          callCount: 3,
          llmCallCount: 3,
          deterministicCallCount: 0,
        },
      ],
      totalEvents: 5,
      totalLlmCalls: 3,
      totalDurationMs: 15000,
    }
    mockGetSummary.mockResolvedValue({ data: summary })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    // The badge is unique via its class; use getAllByText and check length
    const badges = await screen.findAllByText('预算警告')
    // One from the header badge, one from the warning section header
    expect(badges.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/软预算超出/)).toBeDefined()
  })

  it('displays hard blocked status without bypass buttons', async () => {
    const summary: ObservabilitySummary = {
      compilerRunId: 42,
      budgetStatus: 'hard_exceeded',
      budgetWarnings: ['硬预算超出: 累计 0.12 >= 0.10'],
      costSummary: [
        {
          dimension: 'total',
          label: '总成本',
          estimatedCost: 0.12,
          currency: 'CNY',
          callCount: 5,
          llmCallCount: 5,
          deterministicCallCount: 0,
        },
      ],
      totalEvents: 8,
      totalLlmCalls: 5,
      totalDurationMs: 30000,
    }
    mockGetSummary.mockResolvedValue({ data: summary })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    const badges = await screen.findAllByText('预算已超限')
    expect(badges.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/硬预算超出/)).toBeDefined()

    // 红线：不提供绕过按钮
    expect(screen.queryByText('继续生成')).toBeNull()
    expect(screen.queryByText('绕过预算')).toBeNull()
    expect(screen.queryByText('直接应用')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses "估算成本" wording, not financial billing terms', async () => {
    const summary: ObservabilitySummary = {
      compilerRunId: 42,
      budgetStatus: 'within_budget',
      costSummary: [
        {
          dimension: 'total',
          label: '总成本',
          estimatedCost: 0.035,
          currency: 'CNY',
          callCount: 3,
          llmCallCount: 3,
          deterministicCallCount: 0,
        },
      ],
      totalEvents: 5,
      totalLlmCalls: 3,
      totalDurationMs: 10000,
    }
    mockGetSummary.mockResolvedValue({ data: summary })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    // Should use 估算成本 not 财务账单/发票
    const costLabels = await screen.findAllByText('估算成本')
    expect(costLabels.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('发票')).toBeNull()
    expect(screen.queryByText('账单')).toBeNull()
    expect(screen.queryByText('财务')).toBeNull()
  })

  it('displays model breakdown when available', async () => {
    const summary: ObservabilitySummary = {
      compilerRunId: 42,
      budgetStatus: 'within_budget',
      modelBreakdown: [
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          callCount: 3,
          estimatedCost: 0.003,
          totalTokens: 9000,
          avgLatencyMs: 2500,
        },
      ],
      totalEvents: 5,
      totalLlmCalls: 3,
      totalDurationMs: 10000,
    }
    mockGetSummary.mockResolvedValue({ data: summary })
    render(<CompilerObservabilitySummary runId={42} />, { wrapper: createWrapper() })

    expect(await screen.findByText(/deepseek/)).toBeDefined()
    expect(screen.getByText('模型调用分布')).toBeDefined()
  })
})
