/**
 * v3-pmo-decision-intelligence-workbench —— 内置权威来源 adapter 领域负例
 * （tasks 5.2–5.7，design D2）。
 *
 * 用最小桩替换权威服务，直接驱动每个内置 adapter 的 collect()：
 * 权限 forbidden / 服务抛错 unavailable / 正常投影 facts 键 / ref 驱动行为 /
 * 零重算零写入（桩只被读取）。纯内存：无 DB 写、无网络。
 */
import { test } from '@japa/runner'
import {
  buildBuiltinAdapters,
  type BuiltinAdapterDeps,
} from '#services/decision_workbench/evidence_snapshot_service'
import { PMO_DECISION_SOURCES } from '@aiproj/types'

function makeDeps(
  overrides?: Partial<BuiltinAdapterDeps> & { policyCanView?: boolean; policyCan?: boolean },
): BuiltinAdapterDeps {
  const allow = overrides?.policyCanView ?? true
  const allowDim = overrides?.policyCan ?? true
  return {
    dashboard: {
      getSummary: async () => ({ totalProjects: 12, activeProjects: 5 }),
    } as never,
    priority: {
      getSummary: async () => ({
        projectCount: 12,
        scoredProjectCount: 10,
        scoreVersion: 'priority-scoring.v3',
      }),
    } as never,
    investment: {
      getSummary: async () => ({ bucketCount: 4, redactedBucketCount: 0, visibleProjectCount: 12 }),
    } as never,
    contention: {
      getSummary: async () => ({ conflictCount: 2 }),
    } as never,
    riskWorkbench: {} as never,
    trafficLight: {
      counts: async () => ({ redCount: 1, yellowCount: 2, greenCount: 7, grayCount: 0 }),
    } as never,
    policy: {
      canView: async () => allow,
      can: async () => allowDim,
    } as never,
    ...overrides,
  }
}

const ctxFor = (orgId = 1) => ({
  user: { id: 7 } as never,
  organizationId: orgId,
  budget: { maxFacts: 200, maxRefs: 200, maxBytes: 65_536, deadlineAt: Date.now() + 5000 },
  evidenceRefs: [] as string[],
})

async function collectOne(deps: BuiltinAdapterDeps, id: string, ctx: ReturnType<typeof ctxFor>) {
  const registry = buildBuiltinAdapters(deps)
  const adapter = registry.list().find((entry) => entry.id === id)!
  return { adapter, result: await adapter.collect(ctx) }
}

test.group('内置 adapter —— 组合 Dashboard/交通灯（tasks 5.2）', () => {
  test('dashboard 可用时投影低敏计数键且带 sourceVersion', async ({ assert }) => {
    const { result } = await collectOne(
      makeDeps(),
      PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD,
      ctxFor(),
    )
    assert.equal(result.unavailable, undefined)
    assert.isTrue(
      (result.facts ?? []).some((fact) => fact.key === 'totalProjects' && fact.value === 12),
    )
    assert.equal(result.sourceVersion, 'portfolio-dashboard.v1')
  })

  test('traffic-light 投影灯色计数；权限缺失 → forbidden 且零事实', async ({ assert }) => {
    const ok = await collectOne(makeDeps(), PMO_DECISION_SOURCES.PORTFOLIO_TRAFFIC_LIGHT, ctxFor())
    assert.isTrue(
      (ok.result.facts ?? []).some((fact) => fact.key === 'greenCount' && fact.value === 7),
    )

    const denied = await collectOne(
      makeDeps({ policyCanView: false }),
      PMO_DECISION_SOURCES.PORTFOLIO_TRAFFIC_LIGHT,
      ctxFor(),
    )
    assert.equal(denied.result.forbidden, true)
    assert.equal(denied.result.facts, undefined)
  })

  test('dashboard 服务抛错 → unavailable（isolate-drop），不重算不写库', async ({ assert }) => {
    let calls = 0
    const deps = makeDeps({
      dashboard: {
        getSummary: async () => {
          calls += 1
          throw new Error('downstream down')
        },
      } as never,
    })
    const { result } = await collectOne(deps, PMO_DECISION_SOURCES.PORTFOLIO_DASHBOARD, ctxFor())
    assert.equal(result.unavailable, true)
    assert.equal(calls, 1) // 只调用一次既有只读面，无重试放大、无写路径
  })
})

test.group('内置 adapter —— 优先级/AI 推荐/投入（task 5.3/5.4）', () => {
  test('priority 复用权威 scoreVersion，不创建第二 rank', async ({ assert }) => {
    const { result } = await collectOne(makeDeps(), PMO_DECISION_SOURCES.PRIORITY_SCORING, ctxFor())
    assert.equal(result.sourceVersion, 'priority-scoring.v3')
    assert.isTrue((result.refs ?? []).includes('priority_scoring:summary'))
  })

  test('investment 投影桶计数且保持非财务口径（无金额键）', async ({ assert }) => {
    const { result } = await collectOne(
      makeDeps(),
      PMO_DECISION_SOURCES.INVESTMENT_DISTRIBUTION,
      ctxFor(),
    )
    const keys = (result.facts ?? []).map((fact) => fact.key)
    assert.isTrue(keys.includes('bucketCount'))
    assert.isFalse(keys.some((key) => /budget|cost|amount|roi/i.test(key)))
  })
})

test.group('内置 adapter —— 资源/风险/预测（tasks 5.5/5.6）', () => {
  test('资源维度权限缺失 → forbidden（维度权限独立于 view）', async ({ assert }) => {
    const { result } = await collectOne(
      makeDeps({ policyCanView: true, policyCan: false }),
      PMO_DECISION_SOURCES.RESOURCE_CONTENTION,
      ctxFor(),
    )
    assert.equal(result.forbidden, true)
  })

  test('progress_prediction 默认可用且只读（无 AI 重算入口）', async ({ assert }) => {
    const { result } = await collectOne(
      makeDeps(),
      PMO_DECISION_SOURCES.PROGRESS_PREDICTION,
      ctxFor(),
    )
    assert.isUndefined(result.unavailable)
    assert.isTrue((result.refs ?? []).includes('progress_prediction:dashboard'))
  })
})

test.group('内置 adapter —— 分配 preview 与影响分析（tasks 5.5/5.7）', () => {
  test('allocation_preview 无 draft 引用 → unavailable（不凭空构造预览）', async ({ assert }) => {
    const registry = buildBuiltinAdapters(makeDeps())
    const adapter = registry
      .list()
      .find((entry) => entry.id === PMO_DECISION_SOURCES.ALLOCATION_PREVIEW)!
    const result = await adapter.collect(ctxFor())
    assert.equal(result.unavailable, true)

    const withRef = await adapter.collect({
      ...ctxFor(),
      evidenceRefs: ['allocation_preview:draft-9'],
    })
    assert.equal(withRef.unavailable, undefined)
    assert.isTrue((withRef.refs ?? []).includes('allocation_preview:draft-9'))
  })

  test('multi_project_impact 无引用 → unavailable；有引用时保留原 refs 不改写', async ({
    assert,
  }) => {
    const registry = buildBuiltinAdapters(makeDeps())
    const adapter = registry
      .list()
      .find((entry) => entry.id === PMO_DECISION_SOURCES.MULTI_PROJECT_IMPACT)!
    const empty = await adapter.collect(ctxFor())
    assert.equal(empty.unavailable, true)

    const refs = ['multi_project_impact:snap-1', 'multi_project_impact:snap-2']
    const filled = await adapter.collect({ ...ctxFor(), evidenceRefs: refs })
    assert.deepEqual(filled.refs, refs)
    assert.isUndefined(filled.truncated)
  })
})
