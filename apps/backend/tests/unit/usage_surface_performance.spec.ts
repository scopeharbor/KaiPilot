// apps/backend/tests/unit/usage_surface_performance.spec.ts — §8.3 性能门禁
// v3-copilot-usage-and-quota-surface

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 模块
const mockRateLimitGetStatus = vi.fn()
const mockBudgetGetStatus = vi.fn()
const mockLedgerQuery = vi.fn()
const mockOrgQuery = vi.fn()

vi.mock('../../app/services/rate_limiting/rate_limit_query_service.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    getStatus: mockRateLimitGetStatus,
  })),
}))

vi.mock('../../app/services/ai_budget/budget_status_service.js', () => ({
  BudgetStatusService: vi.fn().mockImplementation(() => ({
    getStatus: mockBudgetGetStatus,
  })),
}))

vi.mock('#models/unified_ai_invocation_ledger', () => ({
  default: {
    query: mockLedgerQuery,
  },
}))

vi.mock('#models/organization', () => ({
  default: {
    query: mockOrgQuery,
  },
}))

function makeLedgerRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    organizationId: 1,
    projectId: (i % 10) + 1,
    userId: (i % 50) + 100,
    capability: ['copilot', 'compiler', 'ocr'][i % 3],
    provider: ['openai', 'anthropic', 'deepseek'][i % 3],
    model: ['gpt-4o', 'claude-sonnet-4', 'deepseek-chat'][i % 3],
    estimatedCost: 0.001 * ((i % 10) + 1),
    currency: 'CNY',
    pricingSnapshotId: 'snap-1',
    promptTokens: 100 + i,
    completionTokens: 50 + i,
    totalTokens: 150 + i * 2,
    occurredAt: new Date(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`),
  }))
}

describe('§8.3 performance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrgQuery.mockReturnValue({
      where: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ id: 1, timezone: 'Asia/Shanghai' }),
      }),
    })
    mockRateLimitGetStatus.mockResolvedValue({
      organizationId: 1,
      dimensions: [],
      recentDecisions: [],
    })
    mockBudgetGetStatus.mockResolvedValue({
      organizationId: 1,
      window: {
        type: 'monthly',
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-08-31T23:59:59.999Z',
      },
      accumulated: { cost: 0, tokens: 0, currency: 'CNY' },
      limits: null,
      remaining: null,
      recentDecisions: [],
      costLabel: 'estimate',
      policySet: false,
    })
  })

  it('default time window aggregation completes within 500ms for 1000 rows', async () => {
    const rows = makeLedgerRows(1000)
    const chainMock = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(rows),
    }
    mockLedgerQuery.mockReturnValue(chainMock)

    const { UsageSurfaceService } =
      await import('../../app/services/copilot_usage/usage_surface_service.js')
    const service = new UsageSurfaceService({
      rateLimitQuery: { getStatus: mockRateLimitGetStatus } as any,
      budgetStatus: { getStatus: mockBudgetGetStatus } as any,
    } as any)

    const start = performance.now()
    await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: {
        allowedDimensions: new Set(['organization', 'project', 'user', 'capability', 'model']),
        allowedProjectIds: null,
        allowedUserIds: null,
        allowedCapabilities: null,
      },
      topN: 10,
    })
    const elapsed = performance.now() - start

    // 1000 行的聚合应在 500ms 内完成
    expect(elapsed).toBeLessThan(500)
  })
})
