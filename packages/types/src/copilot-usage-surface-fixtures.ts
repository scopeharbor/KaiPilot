// @aiproj/types — V3 Copilot 用量视图 fixtures（五态）
// v3-copilot-usage-and-quota-surface §2.8

import type {
  UsageSurfaceResponse,
  UsageCostEntry,
  UsageAggregationDimension,
  UsageAllowanceEntry,
  UsageTruncatedList,
  UsageSurfaceFixtureKind,
} from './copilot-usage-surface.js'

// ---------------------------------------------------------------------------
// 公共 helpers
// ---------------------------------------------------------------------------

function makeCostEntry(overrides?: Partial<UsageCostEntry>): UsageCostEntry {
  return {
    value: 0.012345,
    currency: 'CNY',
    pricingSnapshotId: 'snap-2026-08-001',
    costBasis: 'estimate',
    ...overrides,
  }
}

function makeDimension(
  dim: UsageAggregationDimension['dimension'],
  key: string,
  label: string,
  overrides?: Partial<UsageAggregationDimension>,
): UsageAggregationDimension {
  return {
    dimension: dim,
    key,
    label,
    cost: makeCostEntry(),
    tokens: { prompt: 1200, completion: 800, total: 2000 },
    callCount: 5,
    ...overrides,
  }
}

function makeAllowance(
  dimension: string,
  overrides?: Partial<UsageAllowanceEntry>,
): UsageAllowanceEntry {
  return {
    dimension,
    isUnlimited: false,
    limit: 10000,
    used: 3500,
    remaining: 6500,
    windowStart: '2026-08-01T00:00:00.000Z',
    windowEnd: '2026-08-31T23:59:59.999Z',
    ...overrides,
  }
}

function makeTopModels(
  items?: UsageAggregationDimension[],
): UsageTruncatedList<UsageAggregationDimension> {
  const defaultItems = items ?? [
    makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o'),
    makeDimension('model', 'anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4'),
  ]
  return {
    items: defaultItems,
    total: defaultItems.length,
    truncated: false,
    omittedCount: 0,
  }
}

// ---------------------------------------------------------------------------
// 态 1：全维可见（full_visibility）
// ---------------------------------------------------------------------------

export function usageSurfaceFullVisibilityFixture(): UsageSurfaceResponse {
  return {
    organizationId: 1,
    window: {
      type: 'monthly',
      start: '2026-08-01T00:00:00.000+08:00',
      end: '2026-08-31T23:59:59.999+08:00',
      timezone: 'Asia/Shanghai',
      utcFallback: false,
    },
    dimensions: [
      makeDimension('organization', '1', '组织 A'),
      makeDimension('project', '10', '项目 Alpha'),
      makeDimension('project', '11', '项目 Beta'),
      makeDimension('user', '100', '张三'),
      makeDimension('user', '101', '李四'),
      makeDimension('capability', 'copilot', 'Copilot'),
      makeDimension('capability', 'compiler', 'Compiler'),
      makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o'),
      makeDimension('model', 'anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4'),
    ],
    totalCost: makeCostEntry({ value: 0.0865 }),
    totalTokens: { prompt: 12000, completion: 8000, total: 20000 },
    totalCallCount: 50,
    allowances: [
      makeAllowance('rpm', { limit: 1000, used: 350, remaining: 650 }),
      makeAllowance('tpm', { limit: 100000, used: 35000, remaining: 65000 }),
      makeAllowance('cost', { limit: 100, used: 0.0865, remaining: 99.9135 }),
    ],
    topModels: makeTopModels([
      makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o', {
        cost: makeCostEntry({ value: 0.0543 }),
        tokens: { prompt: 8000, completion: 5000, total: 13000 },
        callCount: 30,
      }),
      makeDimension('model', 'anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4', {
        cost: makeCostEntry({ value: 0.0322 }),
        tokens: { prompt: 4000, completion: 3000, total: 7000 },
        callCount: 20,
      }),
    ]),
    aggregatedAt: '2026-08-19T10:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 态 2：部分维度无权限（partial_dimensions）
// ---------------------------------------------------------------------------

export function usageSurfacePartialDimensionsFixture(): UsageSurfaceResponse {
  return {
    organizationId: 1,
    window: {
      type: 'monthly',
      start: '2026-08-01T00:00:00.000+08:00',
      end: '2026-08-31T23:59:59.999+08:00',
      timezone: 'Asia/Shanghai',
      utcFallback: false,
    },
    dimensions: [
      // 只有项目维度和模型维度，没有用户维度和能力面维度
      makeDimension('project', '10', '项目 Alpha'),
      makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o'),
    ],
    totalCost: makeCostEntry({ value: 0.0543 }),
    totalTokens: { prompt: 8000, completion: 5000, total: 13000 },
    totalCallCount: 30,
    allowances: [makeAllowance('rpm', { limit: 1000, used: 300, remaining: 700 })],
    topModels: makeTopModels([
      makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o', {
        cost: makeCostEntry({ value: 0.0543 }),
        tokens: { prompt: 8000, completion: 5000, total: 13000 },
        callCount: 30,
      }),
    ]),
    aggregatedAt: '2026-08-19T10:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 态 3：零用量（zero_usage）
// ---------------------------------------------------------------------------

export function usageSurfaceZeroUsageFixture(): UsageSurfaceResponse {
  return {
    organizationId: 2,
    window: {
      type: 'monthly',
      start: '2026-08-01T00:00:00.000+08:00',
      end: '2026-08-31T23:59:59.999+08:00',
      timezone: 'Asia/Shanghai',
      utcFallback: false,
    },
    dimensions: [],
    totalCost: null,
    totalTokens: { prompt: 0, completion: 0, total: 0 },
    totalCallCount: 0,
    allowances: [
      makeAllowance('rpm', { used: 0, remaining: 1000 }),
      makeAllowance('tpm', { used: 0, remaining: 100000 }),
    ],
    topModels: { items: [], total: 0, truncated: false, omittedCount: 0 },
    aggregatedAt: '2026-08-19T10:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 态 4：快照缺失（missing_snapshot）—— 成本条目无 pricingSnapshotId，不应呈现
// ---------------------------------------------------------------------------

export function usageSurfaceMissingSnapshotFixture(): UsageSurfaceResponse {
  return {
    organizationId: 3,
    window: {
      type: 'monthly',
      start: '2026-08-01T00:00:00.000+08:00',
      end: '2026-08-31T23:59:59.999+08:00',
      timezone: 'Asia/Shanghai',
      utcFallback: false,
    },
    dimensions: [
      makeDimension('project', '10', '项目 Alpha', {
        // 故意没有 pricingSnapshotId — 按 spec 该条目的 cost 应为 null
        cost: null,
      }),
    ],
    // 总成本也应为 null（因为没有带标注的成本条目）
    totalCost: null,
    totalTokens: { prompt: 1200, completion: 800, total: 2000 },
    totalCallCount: 5,
    allowances: [],
    topModels: {
      items: [
        makeDimension('model', 'openai/gpt-4o', 'openai/gpt-4o', {
          cost: null,
          tokens: { prompt: 1200, completion: 800, total: 2000 },
          callCount: 5,
        }),
      ],
      total: 1,
      truncated: false,
      omittedCount: 0,
    },
    aggregatedAt: '2026-08-19T10:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 态 5：时区缺失（missing_timezone）—— 回落到 UTC 并标注
// ---------------------------------------------------------------------------

export function usageSurfaceMissingTimezoneFixture(): UsageSurfaceResponse {
  return {
    organizationId: 4,
    window: {
      type: 'monthly',
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T23:59:59.999Z',
      timezone: 'UTC',
      utcFallback: true, // 显式标注回落
    },
    dimensions: [makeDimension('organization', '4', '组织 D')],
    totalCost: makeCostEntry({ value: 0.012345 }),
    totalTokens: { prompt: 1200, completion: 800, total: 2000 },
    totalCallCount: 5,
    allowances: [],
    topModels: makeTopModels(),
    aggregatedAt: '2026-08-19T10:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 统一 fixture 工厂
// ---------------------------------------------------------------------------

export function usageSurfaceFixture(kind: UsageSurfaceFixtureKind): UsageSurfaceResponse {
  switch (kind) {
    case 'full_visibility':
      return usageSurfaceFullVisibilityFixture()
    case 'partial_dimensions':
      return usageSurfacePartialDimensionsFixture()
    case 'zero_usage':
      return usageSurfaceZeroUsageFixture()
    case 'missing_snapshot':
      return usageSurfaceMissingSnapshotFixture()
    case 'missing_timezone':
      return usageSurfaceMissingTimezoneFixture()
  }
}
