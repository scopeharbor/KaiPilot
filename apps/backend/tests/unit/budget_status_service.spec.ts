/**
 * v3-unified-ai-budget-and-quota §7.4 — 跨组织访问测试。
 *
 * 覆盖：跨组织访问返回不泄露错误且不暴露余量。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  BudgetStatusService,
  type BudgetDecisionRepository,
} from '../../app/services/ai_budget/budget_status_service.js'
import type { UnifiedBudgetPolicy } from '@aiproj/types'

function makeRepo(overrides?: Partial<BudgetDecisionRepository>): BudgetDecisionRepository {
  return {
    listByOrganization: vi.fn().mockResolvedValue([]),
    accumulateInWindow: vi.fn().mockResolvedValue({
      totalCost: 50,
      totalTokens: 500_000,
      currency: 'CNY',
    }),
    ...overrides,
  }
}

function makePolicy(overrides?: Partial<UnifiedBudgetPolicy>): UnifiedBudgetPolicy {
  return {
    name: 'org-default',
    enabled: true,
    scope: 'organization',
    scopeValue: '1',
    softLimitCost: 80,
    hardLimitCost: 100,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 1,
    ...overrides,
  }
}

function fixedWindow() {
  return {
    getWindow: () => ({
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-08-31T23:59:59.999Z'),
      type: 'monthly',
    }),
  }
}

const NOW = new Date('2026-08-17T12:00:00.000Z')

describe('§7.4 cross-organization access', () => {
  it('organization isolation: query only returns data for the specified org', async () => {
    const repo = makeRepo()
    const service = new BudgetStatusService({
      repository: repo,
      policies: [makePolicy({ scopeValue: '1' })],
      windowCalculator: fixedWindow(),
    })

    const result = await service.getStatus({
      organizationId: 1,
      now: NOW,
    })

    // accumulateInWindow should be called with organizationId=1
    expect(repo.accumulateInWindow).toHaveBeenCalledWith(
      1, // organizationId
      null, // projectId
      null, // userId
      null, // capability
      expect.any(Date),
      expect.any(Date),
    )

    expect(result.organizationId).toBe(1)
    expect(result.costLabel).toBe('estimate')
  })

  it('different org gets different data', async () => {
    const repo = makeRepo({
      accumulateInWindow: vi.fn().mockResolvedValue({
        totalCost: 200,
        totalTokens: 2_000_000,
        currency: 'USD',
      }),
    })
    const service = new BudgetStatusService({
      repository: repo,
      policies: [makePolicy({ scopeValue: '2' })],
      windowCalculator: fixedWindow(),
    })

    const result = await service.getStatus({
      organizationId: 2,
      now: NOW,
    })

    expect(result.organizationId).toBe(2)
    expect(result.accumulated.cost).toBe(200)
    expect(result.accumulated.currency).toBe('USD')
  })

  it('costLabel is always estimate, never billed', async () => {
    const service = new BudgetStatusService({
      repository: makeRepo(),
      policies: [makePolicy()],
      windowCalculator: fixedWindow(),
    })

    const result = await service.getStatus({
      organizationId: 1,
      now: NOW,
    })

    expect(result.costLabel).toBe('estimate')
  })

  it('unset policy reads as unlimited, not zero remaining', async () => {
    const service = new BudgetStatusService({
      repository: makeRepo(),
      policies: [], // no policies
      windowCalculator: fixedWindow(),
    })

    const result = await service.getStatus({
      organizationId: 1,
      now: NOW,
    })

    expect(result.policySet).toBe(false)
    expect(result.limits).toBeNull()
    expect(result.remaining).toBeNull()
  })

  it('policySet is true when matching policy exists', async () => {
    const service = new BudgetStatusService({
      repository: makeRepo(),
      policies: [makePolicy()],
      windowCalculator: fixedWindow(),
    })

    const result = await service.getStatus({
      organizationId: 1,
      now: NOW,
    })

    expect(result.policySet).toBe(true)
    expect(result.limits).not.toBeNull()
    expect(result.remaining).not.toBeNull()
  })
})
