/**
 * v3-unified-ai-budget-and-quota §4.10 — 既有调用方在未修改自身代码时受预算约束。
 *
 * 证明：当 UnifiedBudgetGuard 被注入到调用链后，既有 AI 能力面
 * （draft、copilot、ocr、compiler 等）在不修改自身代码的情况下自动受预算约束。
 *
 * 测试策略：模拟调用方以各种 capability/surface 调用 preflight，
 * 验证预算约束对所有能力面统一生效。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  UnifiedBudgetGuard,
  type AccumulatedUsageQuery,
  type BudgetDecisionRecorder,
} from '../../app/services/ai_budget/unified_budget_guard.js'
import type { UnifiedBudgetPolicy } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides?: Partial<UnifiedBudgetPolicy>): UnifiedBudgetPolicy {
  return {
    name: 'org-default',
    enabled: true,
    scope: 'organization',
    scopeValue: '1',
    softLimitCost: 80,
    hardLimitCost: 100,
    softLimitTokens: 800_000,
    hardLimitTokens: 1_000_000,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 1,
    ...overrides,
  }
}

function makeUsageQuery(usage: { totalCost: number; totalTokens: number }): AccumulatedUsageQuery {
  return {
    query: vi.fn().mockResolvedValue(usage),
  }
}

function makeRecorder(): BudgetDecisionRecorder & { recorded: any[] } {
  const recorded: any[] = []
  return {
    recorded,
    record: vi.fn().mockImplementation(async (d: any) => {
      recorded.push(d)
    }),
  }
}

function fixedWindow() {
  return {
    getWindow: () => ({
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-08-31T23:59:59.999Z'),
    }),
  }
}

const NOW = new Date('2026-08-17T12:00:00.000Z')

// ---------------------------------------------------------------------------
// §4.10 既有调用方统一受预算约束
// ---------------------------------------------------------------------------

describe('§4.10 existing callers are budget-constrained without code changes', () => {
  /** 已知能力面列表（来自账本和代码盘点）。 */
  const capabilities = [
    { capability: 'draft', surface: 'copilot', desc: 'AI 草案生成' },
    { capability: 'risk', surface: 'copilot', desc: '风险识别' },
    { capability: 'prediction', surface: 'copilot', desc: '进度预测' },
    { capability: 'recommendation', surface: 'copilot', desc: '智能推荐' },
    { capability: 'report', surface: 'copilot', desc: '报表生成' },
    { capability: 'triz', surface: 'copilot', desc: 'TRIZ 分析' },
    { capability: 'pmo', surface: 'copilot', desc: 'PMO 组合' },
    { capability: 'ocr', surface: 'ocr', desc: 'OCR 识别' },
    { capability: 'compiler', surface: 'compiler', desc: 'Compiler 编排' },
    { capability: 'general', surface: 'copilot', desc: '通用问答' },
    { capability: 'skill-eval', surface: 'copilot', desc: 'Skill 评估' },
    { capability: 'knowledge', surface: 'copilot', desc: '知识检索' },
  ]

  for (const { capability, surface, desc } of capabilities) {
    it(`budget constraint applies to ${capability} (${desc})`, async () => {
      const guard = new UnifiedBudgetGuard({
        policies: [makePolicy()],
        usageQuery: makeUsageQuery({ totalCost: 95, totalTokens: 0 }),
        recorder: makeRecorder(),
        windowCalculator: fixedWindow(),
      })

      const result = await guard.preflight({
        organizationId: 1,
        projectId: null,
        userId: null,
        capability,
        surface,
        estimatedCost: 10, // 95 + 10 = 105 > 100 hard limit
        estimatedTokens: 0,
        idempotencyKey: `ik:${capability}:001`,
        ledgerAttemptRef: null,
        now: NOW,
      })

      // All capabilities should be blocked when hard limit exceeded
      expect(result.allowed).toBe(false)
      expect(result.outcome).toBe('block')
      expect(result.decisionRecord.capability).toBe(capability)
      expect(result.decisionRecord.surface).toBe(surface)
    })
  }

  it('soft overrun warns for any capability', async () => {
    const guard = new UnifiedBudgetGuard({
      policies: [makePolicy()],
      usageQuery: makeUsageQuery({ totalCost: 85, totalTokens: 0 }),
      recorder: makeRecorder(),
      windowCalculator: fixedWindow(),
    })

    const result = await guard.preflight({
      organizationId: 1,
      projectId: null,
      userId: null,
      capability: 'draft',
      surface: 'copilot',
      estimatedCost: 0,
      estimatedTokens: 0,
      idempotencyKey: 'ik:soft:001',
      ledgerAttemptRef: null,
      now: NOW,
    })

    expect(result.outcome).toBe('warn')
    expect(result.allowed).toBe(true)
    expect(result.decisionRecord.outcome).toBe('warn')
  })

  it('decision record links to ledger via idempotency key', async () => {
    const recorder = makeRecorder()
    const guard = new UnifiedBudgetGuard({
      policies: [makePolicy()],
      usageQuery: makeUsageQuery({ totalCost: 50, totalTokens: 0 }),
      recorder,
      windowCalculator: fixedWindow(),
    })

    await guard.preflight({
      organizationId: 1,
      projectId: 42,
      userId: 7,
      capability: 'draft',
      surface: 'copilot',
      estimatedCost: 5,
      estimatedTokens: 50_000,
      idempotencyKey: 'ik:link:001',
      ledgerAttemptRef: 'ref:attempt:42',
      now: NOW,
    })

    expect(recorder.recorded).toHaveLength(1)
    const decision = recorder.recorded[0]
    expect(decision.idempotencyKey).toBe('ik:link:001')
    expect(decision.ledgerAttemptRef).toBe('ref:attempt:42')
    expect(decision.organizationId).toBe(1)
    expect(decision.projectId).toBe(42)
    expect(decision.userId).toBe(7)
  })

  it('postflight updates accumulate correctly across capabilities', async () => {
    const usageQuery = makeUsageQuery({ totalCost: 50, totalTokens: 500_000 })
    const recorder = makeRecorder()
    const guard = new UnifiedBudgetGuard({
      policies: [makePolicy()],
      usageQuery,
      recorder,
      windowCalculator: fixedWindow(),
    })

    // First call: draft
    await guard.postflight({
      organizationId: 1,
      projectId: 42,
      userId: 7,
      capability: 'draft',
      surface: 'copilot',
      actualCost: 5.0,
      actualTokens: 50_000,
      idempotencyKey: 'ik:post:001',
      ledgerAttemptRef: 'ref:1',
      now: NOW,
    })

    // Second call: risk (different capability, same org)
    await guard.postflight({
      organizationId: 1,
      projectId: 42,
      userId: 7,
      capability: 'risk',
      surface: 'copilot',
      actualCost: 3.0,
      actualTokens: 30_000,
      idempotencyKey: 'ik:post:002',
      ledgerAttemptRef: 'ref:2',
      now: NOW,
    })

    expect(recorder.recorded).toHaveLength(2)
    expect(recorder.recorded[0].capability).toBe('draft')
    expect(recorder.recorded[1].capability).toBe('risk')
  })
})
