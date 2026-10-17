/**
 * v3-pmo-decision-intelligence-workbench —— 证据 adapter registry 负例与预算
 * （tasks 5.1，design D2）。
 *
 * 覆盖：duplicate id/version 拒绝、未知 id 拒绝、timeout→unavailable、
 * throw→unavailable（isolate-drop）、oversize→truncated、乱序合并确定性。
 * 纯内存测试：不触 DB / 网络 / provider。
 */
import { test } from '@japa/runner'
import {
  EvidenceSourceRegistry,
  boundSourceResult,
  buildBuiltinAdapters,
  collectAllSources,
  makeSourceBudget,
  toSourceBlock,
} from '#services/decision_workbench/evidence_snapshot_service'
import type {
  DecisionEvidenceSourceAdapter,
  SourceCollectResult,
} from '#services/decision_workbench/evidence_snapshot_service'
import { PMO_DECISION_SOURCES, PMO_DECISION_SOURCE_STATES } from '@aiproj/types'

function fakeAdapter(
  id: string,
  resultOrFactory: SourceCollectResult | (() => Promise<SourceCollectResult>),
  required = false,
): DecisionEvidenceSourceAdapter {
  return {
    id: id as never,
    required,
    requiredPermissions: 'portfolio:view' as never,
    async collect() {
      return typeof resultOrFactory === 'function' ? await resultOrFactory() : resultOrFactory
    },
  }
}

test.group('决策工作台 —— EvidenceSourceRegistry（task 5.1）', () => {
  test('重复注册同 id 即拒绝；未知 id 拒绝', ({ assert }) => {
    const registry = new EvidenceSourceRegistry()
    registry.register(fakeAdapter(PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD, {}))
    assert.throws(
      () => registry.register(fakeAdapter(PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD, {})),
      /duplicate/,
    )
    assert.throws(
      () => registry.register(fakeAdapter('crm_pipeline' as never, {})),
      /unknown decision source/,
    )
  })

  test('registry.list 稳定排序（按 id 字典序）', ({ assert }) => {
    const registry = new EvidenceSourceRegistry()
    registry.register(fakeAdapter(PMO_DECISION_SOURCES.RISK_REGISTER, {}))
    registry.register(fakeAdapter(PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD, {}))
    const ids = registry.list().map((adapter) => adapter.id)
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a.localeCompare(b)),
    )
  })
})

test.group('决策工作台 —— 预算截断与状态合成（task 5.1/D2）', () => {
  test('facts/refs 超预算被截断并标记 truncated', ({ assert }) => {
    const budget = makeSourceBudget(Date.now() + 1000)
    const bounded = boundSourceResult(
      {
        facts: Array.from({ length: 500 }, (_, index) => ({ key: `k${index}`, value: index })),
        refs: Array.from({ length: 400 }, (_, index) => `ref-${index}`),
      },
      budget,
    )
    assert.isTrue(bounded.truncated)
    assert.equal(bounded.facts!.length, budget.maxFacts)
    assert.equal(bounded.refs!.length, budget.maxRefs)
  })

  test('toSourceBlock 状态合成优先级：forbidden > unavailable > stale > truncated > available', ({
    assert,
  }) => {
    const now = Date.now()
    const base = { id: PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD as never, required: true }
    assert.equal(
      toSourceBlock(base, { forbidden: true }, 60_000, now).state,
      PMO_DECISION_SOURCE_STATES.FORBIDDEN,
    )
    assert.equal(
      toSourceBlock(base, { unavailable: true }, 60_000, now).state,
      PMO_DECISION_SOURCE_STATES.UNAVAILABLE,
    )
    // stale：lastUpdatedAt 早于阈值
    const staleBlock = toSourceBlock(
      base,
      { lastUpdatedAt: new Date(now - 120_000).toISOString(), facts: [{ key: 'k', value: 1 }] },
      60_000,
      now,
    )
    assert.equal(staleBlock.state, PMO_DECISION_SOURCE_STATES.STALE)
    const truncatedBlock = toSourceBlock(base, { truncated: true, facts: [] }, 60_000, now)
    assert.equal(truncatedBlock.state, PMO_DECISION_SOURCE_STATES.TRUNCATED)
    const okBlock = toSourceBlock(
      base,
      { lastUpdatedAt: new Date(now - 1000).toISOString(), facts: [{ key: 'k', value: 1 }] },
      60_000,
      now,
    )
    assert.equal(okBlock.state, PMO_DECISION_SOURCE_STATES.AVAILABLE)
    // forbidden/unavailable 不携带任何事实（不得以零值冒充）
    assert.equal(
      toSourceBlock(base, { forbidden: true, facts: [{ key: 'k', value: 0 }] }, 60_000, now).facts
        .length,
      0,
    )
    assert.equal(
      toSourceBlock(base, { unavailable: true, facts: [{ key: 'k', value: 0 }] }, 60_000, now).facts
        .length,
      0,
    )
  })
})

test.group('决策工作台 —— 并行收集与 isolate-drop（task 5.1）', () => {
  test('单来源超时降级为 unavailable，其余来源不受影响', async ({ assert }) => {
    const registry = new EvidenceSourceRegistry()
    registry.register(
      fakeAdapter(
        PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
        { facts: [{ key: 'k', value: 1 }] },
        true,
      ),
    )
    registry.register(
      fakeAdapter(PMO_DECISION_SOURCES.RISK_REGISTER, () => new Promise(() => undefined)),
    )
    const collected = await collectAllSources({
      registry,
      user: { id: 7 } as never,
      organizationId: 1,
      evidenceRefs: [],
      now: Date.now(),
      staleThresholdMs: 3_600_000,
      timeoutMs: 50,
    })
    const dashboard = collected.blocks.find(
      (block) => block.source === PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
    )
    const risk = collected.blocks.find(
      (block) => block.source === PMO_DECISION_SOURCES.RISK_REGISTER,
    )
    assert.equal(dashboard!.state, PMO_DECISION_SOURCE_STATES.AVAILABLE)
    assert.equal(risk!.state, PMO_DECISION_SOURCE_STATES.UNAVAILABLE)
    // optional 失败 → degraded；required 可用
    assert.equal(collected.readiness, 'degraded')
  })

  test('required 来源失败 → readiness blocked', async ({ assert }) => {
    const registry = new EvidenceSourceRegistry()
    registry.register(
      fakeAdapter(
        PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
        () => {
          throw new Error('boom')
        },
        true,
      ),
    )
    const collected = await collectAllSources({
      registry,
      user: { id: 7 } as never,
      organizationId: 1,
      evidenceRefs: [],
      now: Date.now(),
      timeoutMs: 500,
    })
    assert.equal(collected.readiness, 'blocked')
    assert.equal(collected.blocks[0]!.state, PMO_DECISION_SOURCE_STATES.UNAVAILABLE)
  })

  test('相同输入两次收集得到相同 contentHash（确定性合并，乱序注册不影响）', async ({ assert }) => {
    const makeRegistry = (reverse: boolean) => {
      const registry = new EvidenceSourceRegistry()
      const adapters = [
        fakeAdapter(
          PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
          {
            facts: [
              { key: 'totalProjects', value: 10 },
              { key: 'activeProjects', value: 4 },
            ],
          },
          true,
        ),
        fakeAdapter(
          PMO_DECISION_SOURCES.PRIORITY_SCORING,
          {
            facts: [{ key: 'scoredProjectCount', value: 8 }],
          },
          false,
        ),
      ]
      for (const adapter of reverse ? [...adapters].reverse() : adapters) registry.register(adapter)
      return registry
    }
    const input = {
      user: { id: 7 } as never,
      organizationId: 1,
      evidenceRefs: [] as string[],
      now: Date.parse('2026-08-25T00:00:00Z'),
      staleThresholdMs: 86_400_000,
      timeoutMs: 2_000,
    }
    const first = await collectAllSources({ ...input, registry: makeRegistry(false) })
    const second = await collectAllSources({ ...input, registry: makeRegistry(true) })
    assert.equal(first.contentHash, second.contentHash)
  })

  test('内置 adapter 工厂可构建且包含全部闭集来源', ({ assert }) => {
    // deps 用最小桩：本用例只验证注册完整性，不触发真实收集。
    const stub = {} as never
    const policy = { canView: async () => true, can: async () => true } as never
    const registry = buildBuiltinAdapters({
      dashboard: stub,
      priority: stub,
      investment: stub,
      contention: stub,
      riskWorkbench: stub,
      trafficLight: stub as never,
      policy,
    })
    const ids = registry.list().map((adapter) => adapter.id)
    assert.equal(ids.length, Object.values(PMO_DECISION_SOURCES).length)
  })
})
