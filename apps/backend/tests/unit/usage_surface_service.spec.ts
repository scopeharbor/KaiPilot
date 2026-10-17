// apps/backend/tests/unit/usage_surface_service.spec.ts — §3–§5 聚合与非泄露测试
// v3-copilot-usage-and-quota-surface

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UsagePermissionDimensions } from '../../app/services/copilot_usage/usage_surface_service.js'

// ---------------------------------------------------------------------------
// Mock 所有外部依赖
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLedgerRow(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    organizationId: 1,
    projectId: 10,
    userId: 100,
    capability: 'copilot',
    provider: 'openai',
    model: 'gpt-4o',
    estimatedCost: 0.01,
    currency: 'CNY',
    pricingSnapshotId: 'snap-1',
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    occurredAt: new Date('2026-08-15T10:00:00Z'),
    ...overrides,
  }
}

function makeFullPermissions(): UsagePermissionDimensions {
  return {
    allowedDimensions: new Set(['organization', 'project', 'user', 'capability', 'model']),
    allowedProjectIds: null,
    allowedUserIds: null,
    allowedCapabilities: null,
  }
}

function setupMocks() {
  mockOrgQuery.mockReturnValue({
    where: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: 1, timezone: 'Asia/Shanghai' }),
    }),
  })
  mockRateLimitGetStatus.mockResolvedValue({
    organizationId: 1,
    dimensions: [
      {
        dimension: 'rpm',
        limit: 1000,
        currentCount: 100,
        remaining: 900,
        windowStart: '',
        windowEnd: '',
        isUnlimited: false,
      },
    ],
    recentDecisions: [],
  })
  mockBudgetGetStatus.mockResolvedValue({
    organizationId: 1,
    window: { type: 'monthly', start: '2026-08-01T00:00:00.000Z', end: '2026-08-31T23:59:59.999Z' },
    accumulated: { cost: 0.05, tokens: 5000, currency: 'CNY' },
    limits: { softCost: 50, hardCost: 100, softTokens: null, hardTokens: null },
    remaining: { cost: 99.95, tokens: null },
    recentDecisions: [],
    costLabel: 'estimate',
    policySet: true,
  })
}

async function createService(options: Record<string, unknown> = {}) {
  const { UsageSurfaceService } =
    await import('../../app/services/copilot_usage/usage_surface_service.js')
  return new UsageSurfaceService({
    rateLimitQuery: { getStatus: mockRateLimitGetStatus } as any,
    budgetStatus: { getStatus: mockBudgetGetStatus } as any,
    ...options,
  } as any)
}

describe('currency-safe cost aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('preserves PostgreSQL decimal strings for newly priced calls', async () => {
    setupLedgerQuery([
      makeLedgerRow({ estimatedCost: '0.0012340000', currency: 'USD' }),
      makeLedgerRow({ estimatedCost: '0.0020000000', currency: 'USD' }),
    ])
    const service = await createService()
    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })
    expect(result.totalCost?.value).toBe(0.003234)
    expect(result.dimensions.find((d) => d.dimension === 'model')?.cost?.value).toBe(0.003234)
    expect(result.recentCalls?.[0]?.cost?.value).toBe(0.001234)
    expect(result.costCoverage).toEqual({ pricedCalls: 2, unpricedCalls: 0, unconvertedCalls: 0 })
  })

  it('null costs with snapshots do not hide valid costs or become zero', async () => {
    const rows = [
      makeLedgerRow({ estimatedCost: null }),
      makeLedgerRow({ estimatedCost: 0.02 }),
      makeLedgerRow({ estimatedCost: 0 }),
    ]
    setupLedgerQuery(rows)
    const service = await createService()
    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })
    expect(result.totalCost?.value).toBe(0.02)
    expect(result.costCoverage).toEqual({ pricedCalls: 2, unpricedCalls: 1, unconvertedCalls: 0 })
    expect(result.recentCalls?.[0]?.cost).toBeNull()
    expect(result.recentCalls?.[2]?.cost?.value).toBe(0)
    expect(rows[0].estimatedCost).toBeNull()
  })

  it.each([undefined, '', '  ', 'invalid', Number.NaN, Infinity, '-0.01', true])(
    'keeps invalid costs unknown: %s',
    async (estimatedCost) => {
      setupLedgerQuery([makeLedgerRow({ estimatedCost })])
      const service = await createService()
      const result = await service.getUsageSurface({
        organizationId: 1,
        windowStart: new Date('2026-08-01'),
        windowEnd: new Date('2026-08-31'),
        permissions: makeFullPermissions(),
      })
      expect(result.totalCost).toBeNull()
      expect(result.recentCalls?.[0]?.cost).toBeNull()
      expect(result.costCoverage?.unpricedCalls).toBe(1)
    },
  )

  it('reports conversion gaps rather than summing only convertible costs', async () => {
    setupLedgerQuery([
      makeLedgerRow({ estimatedCost: '0.02', currency: 'USD' }),
      makeLedgerRow({ estimatedCost: 1, currency: 'CNY' }),
    ])
    const service = await createService({
      convertCost: (value: number, from: string) => (from === 'USD' ? value : null),
    })
    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })
    expect(result.totalCost).toBeNull()
    expect(result.costCoverage).toEqual({ pricedCalls: 2, unpricedCalls: 0, unconvertedCalls: 1 })
  })

  it('never adds different currencies when no converter is available', async () => {
    setupLedgerQuery([
      makeLedgerRow({ id: 1, estimatedCost: 1, currency: 'USD', pricingSnapshotId: 'usd' }),
      makeLedgerRow({ id: 2, estimatedCost: 7, currency: 'CNY', pricingSnapshotId: 'cny' }),
    ])
    const service = await createService()
    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })
    expect(result.totalCost).toBeNull()
  })

  it('converts every row to the configured display currency before summing', async () => {
    setupLedgerQuery([
      makeLedgerRow({ id: 1, estimatedCost: 1, currency: 'USD', pricingSnapshotId: 'usd' }),
      makeLedgerRow({ id: 2, estimatedCost: 7, currency: 'CNY', pricingSnapshotId: 'cny' }),
    ])
    const service = await createService({
      displayCurrency: 'CNY',
      convertCost: (value: number, from: string) => (from === 'USD' ? value * 7 : value),
    })
    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })
    expect(result.totalCost).toMatchObject({ value: 14, currency: 'CNY' })
  })
})

function setupLedgerQuery(rows: any[]) {
  const chainMock = {
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(rows),
  }
  mockLedgerQuery.mockReturnValue(chainMock)
  return chainMock
}

// ---------------------------------------------------------------------------
// §3.3 — 非泄露测试：两个 actor 仅差一项权限，总计也必须不同
// ---------------------------------------------------------------------------

describe('§3.3 non-leakage: totals differ when permissions differ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('actor with project permission sees more dimensions than actor without', async () => {
    const rows = [
      makeLedgerRow({ projectId: 10, estimatedCost: 0.01, totalTokens: 150 }),
      makeLedgerRow({ projectId: 11, estimatedCost: 0.02, totalTokens: 300 }),
      makeLedgerRow({ projectId: 12, estimatedCost: 0.03, totalTokens: 450 }),
    ]

    setupLedgerQuery(rows)

    const permsWithProject: UsagePermissionDimensions = {
      allowedDimensions: new Set(['organization', 'project', 'model']),
      allowedProjectIds: null,
      allowedUserIds: null,
      allowedCapabilities: null,
    }

    const permsWithoutProject: UsagePermissionDimensions = {
      allowedDimensions: new Set(['organization', 'model']),
      allowedProjectIds: null,
      allowedUserIds: null,
      allowedCapabilities: null,
    }

    const service = await createService()

    const withProject = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: permsWithProject,
    })

    const withoutProject = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: permsWithoutProject,
    })

    // withProject 有 organization + 3 project + 1 model = 5 个维度
    // withoutProject 有 organization + 1 model = 2 个维度
    expect(withProject.dimensions.length).toBeGreaterThan(withoutProject.dimensions.length)
  })
})

// ---------------------------------------------------------------------------
// §3.5 — 无权限维度不出现在响应中
// ---------------------------------------------------------------------------

describe('§3.5 unpermitted dimension is absent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('dimensions not in allowedDimensions are absent from response', async () => {
    const rows = [makeLedgerRow()]
    setupLedgerQuery(rows)

    const perms: UsagePermissionDimensions = {
      allowedDimensions: new Set(['model']), // 只有 model 维度
      allowedProjectIds: null,
      allowedUserIds: null,
      allowedCapabilities: null,
    }

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: perms,
    })

    // 只有 model 维度
    const dimTypes = result.dimensions.map((d) => d.dimension)
    expect(dimTypes).toEqual(['model'])
    expect(dimTypes).not.toContain('organization')
    expect(dimTypes).not.toContain('project')
    expect(dimTypes).not.toContain('user')
    expect(dimTypes).not.toContain('capability')
  })
})

// ---------------------------------------------------------------------------
// §3.7 — 跨组织用量恒不可见
// ---------------------------------------------------------------------------

describe('§3.7 cross-organization usage is never visible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('queries with organization_id filter exclude other organizations', async () => {
    const chainMock = setupLedgerQuery([])

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })

    // 验证查询附加了 organization_id 过滤（跨组织数据不会被查出）
    expect(chainMock.where).toHaveBeenCalledWith('organization_id', 1)
    // 组织维度仍然存在但 callCount=0（无数据），totalCost 为 null
    expect(result.totalCost).toBeNull()
    expect(result.totalCallCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §3.9 — Top N 截断标注计数正确
// ---------------------------------------------------------------------------

describe('§3.9 Top N truncation count is correct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('topModels reports correct omittedCount when list exceeds topN', async () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeLedgerRow({
        provider: 'provider',
        model: `model-${i}`,
        estimatedCost: 0.001 * (15 - i),
      }),
    )
    setupLedgerQuery(rows)

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
      topN: 10,
    })

    expect(result.topModels.total).toBe(15)
    expect(result.topModels.items.length).toBe(10)
    expect(result.topModels.truncated).toBe(true)
    expect(result.topModels.omittedCount).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// §4.3 — 视图余量与守卫实际判定一致
// ---------------------------------------------------------------------------

describe('§4.3 view allowance matches guard decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('rate limit remaining comes from rate_limit_query_service', async () => {
    mockRateLimitGetStatus.mockResolvedValue({
      organizationId: 1,
      dimensions: [
        {
          dimension: 'rpm',
          limit: 100,
          currentCount: 80,
          remaining: 20,
          windowStart: '',
          windowEnd: '',
          isUnlimited: false,
        },
      ],
      recentDecisions: [],
    })

    setupLedgerQuery([])

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })

    const rpmAllowance = result.allowances.find((a) => a.dimension === 'rpm')
    expect(rpmAllowance).toBeDefined()
    expect(rpmAllowance!.remaining).toBe(20)
    expect(rpmAllowance!.limit).toBe(100)
    expect(rpmAllowance!.used).toBe(80)
    expect(rpmAllowance!.isUnlimited).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §4.5 — 未设限与已设限两条路径
// ---------------------------------------------------------------------------

describe('§4.5 unlimited vs limited paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('unlimited dimension shows isUnlimited=true and remaining=null', async () => {
    mockRateLimitGetStatus.mockResolvedValue({
      organizationId: 1,
      dimensions: [
        {
          dimension: 'rpm',
          limit: null,
          currentCount: 50,
          remaining: null,
          windowStart: '',
          windowEnd: '',
          isUnlimited: true,
        },
      ],
      recentDecisions: [],
    })

    setupLedgerQuery([])

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })

    const rpmAllowance = result.allowances.find((a) => a.dimension === 'rpm')
    expect(rpmAllowance).toBeDefined()
    expect(rpmAllowance!.isUnlimited).toBe(true)
    expect(rpmAllowance!.limit).toBeNull()
    expect(rpmAllowance!.remaining).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §5.3 — 有时区与缺时区两条路径
// ---------------------------------------------------------------------------

describe('§5.3 timezone paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    setupLedgerQuery([])
  })

  it('uses organization timezone when configured', async () => {
    mockOrgQuery.mockReturnValue({
      where: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ id: 1, timezone: 'Asia/Shanghai' }),
      }),
    })

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })

    expect(result.window.timezone).toBe('Asia/Shanghai')
    expect(result.window.utcFallback).toBe(false)
  })

  it('falls back to UTC and marks fallback when no timezone configured', async () => {
    mockOrgQuery.mockReturnValue({
      where: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ id: 1, timezone: null }),
      }),
    })

    const service = await createService()

    const result = await service.getUsageSurface({
      organizationId: 1,
      windowStart: new Date('2026-08-01'),
      windowEnd: new Date('2026-08-31'),
      permissions: makeFullPermissions(),
    })

    expect(result.window.timezone).toBe('UTC')
    expect(result.window.utcFallback).toBe(true)
  })
})
