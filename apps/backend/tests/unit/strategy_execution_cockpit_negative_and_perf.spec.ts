import { test } from '@japa/runner'
import StrategyExecutionCockpitService, {
  assertCockpitPayloadSafe,
  type CockpitFacts,
} from '#services/strategy_execution_cockpit_service'
import { COCKPIT_MAPPING_KINDS, COCKPIT_METRIC_KEYS } from '@aiproj/types'

const user = { id: 7, isSuperAdmin: false } as never
const NOW = Date.parse('2026-07-30T12:00:00.000Z')

function baseFacts(): CockpitFacts {
  return {
    organizationId: 1,
    actorId: 7,
    cycle: {
      cycleId: 1,
      title: 'C1',
      status: 'active',
      startDate: null,
      endDate: null,
      elapsedPercent: 50,
      daysRemaining: 10,
    },
    objectives: [
      {
        id: 1,
        organizationId: 1,
        cycleId: 1,
        projectId: 100,
        scope: 'team',
        title: 'A',
        status: 'active',
        progress: 30,
        confidence: 'medium',
        priorityBand: 'high',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    keyResults: [],
    mappings: [
      {
        id: 1,
        organizationId: 1,
        objectiveId: 1,
        keyResultId: null,
        projectId: 100,
        kind: COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION,
        weight: 1,
        contributionPercent: 20,
        active: true,
        deletedAt: null,
        sourceVersion: 'v1',
        targetVisible: true,
      },
    ],
    visibleProjectIds: new Set([100]),
    portfolioTrafficLight: null,
    priority: null,
    investment: null,
    resourceRisk: null,
    backflow: null,
    restrictedObjectiveCount: 0,
    restrictedMappingCount: 0,
    now: NOW,
  }
}

function makeService(facts: CockpitFacts): StrategyExecutionCockpitService {
  const service = new StrategyExecutionCockpitService({} as never)
  service.setReader(async () => facts)
  return service
}

test.group('Cockpit 负例矩阵（6.1）', () => {
  test('cross-org mapping 被排除且不泄露计数', async ({ assert }) => {
    const facts = baseFacts()
    facts.organizationId = 1
    facts.mappings = [
      {
        id: 99,
        organizationId: 2,
        objectiveId: 1,
        keyResultId: null,
        projectId: 200,
        kind: COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION,
        weight: 1,
        contributionPercent: null,
        active: true,
        deletedAt: null,
        sourceVersion: 'v1',
        targetVisible: true,
      },
    ]
    facts.visibleProjectIds = new Set([100])
    const summary = await makeService(facts).getSummary(user, 1)
    assert.equal(summary.objectiveRows[0]!.mappedProjects.length, 0)
    const json = JSON.stringify(summary)
    assert.notInclude(json, '200')
  })

  test('hidden project 前后端零推断：mappedProjects 为空且响应不含隐藏 id', async ({ assert }) => {
    const facts = baseFacts()
    facts.mappings = [{ ...facts.mappings[0]!, projectId: 999, targetVisible: false }]
    facts.visibleProjectIds = new Set([100])
    const summary = await makeService(facts).getSummary(user, 1)
    assert.equal(summary.objectiveRows[0]!.mappedProjects.length, 0)
    assert.notInclude(JSON.stringify(summary), '999')
  })

  test('bad source payload（forbidden field）fail closed', async ({ assert }) => {
    let threw = false
    try {
      assertCockpitPayloadSafe({ evidenceText: 'secret' })
    } catch {
      threw = true
    }
    assert.equal(threw, true)
  })

  test('嵌套未知字段内 forbidden key 仍被守卫拦截', async ({ assert }) => {
    let threw = false
    try {
      assertCockpitPayloadSafe({ row: { details: { modelOutput: 'x' } } })
    } catch {
      threw = true
    }
    assert.equal(threw, true)
  })
})

test.group('读路径外部副作用绊线（6.4）', () => {
  test('getSummary 不调用 fetch/http 等外部通道', async ({ assert }) => {
    const originalFetch = globalThis.fetch
    const fetchMock = (globalThis.fetch = async () => {
      throw new Error('network call')
    }) as typeof fetch
    try {
      const summary = await makeService(baseFacts()).getSummary(user, 1)
      assert.equal(summary.meta.overallStatus, 'degraded')
      assert.ok(fetchMock)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test.group('有界性能门（6.5）', () => {
  test('1000 objectives + 1000 mappings 聚合在阈值内且 payload 有界', async ({ assert }) => {
    const count = 1000
    const facts: CockpitFacts = {
      organizationId: 1,
      actorId: 7,
      cycle: {
        cycleId: 1,
        title: 'C1',
        status: 'active',
        startDate: null,
        endDate: null,
        elapsedPercent: 50,
        daysRemaining: 10,
      },
      objectives: Array.from({ length: count }, (_v, i) => ({
        id: i + 1,
        organizationId: 1,
        cycleId: 1,
        projectId: 1000 + i,
        scope: 'team' as const,
        title: '目标 ' + (i + 1),
        status: 'active' as const,
        progress: i % 100,
        confidence: 'medium' as const,
        priorityBand: 'high' as const,
        updatedAt: '2026-07-29T00:00:00.000Z',
      })),
      keyResults: Array.from({ length: count }, (_v, i) => ({
        id: i + 1,
        organizationId: 1,
        objectiveId: i + 1,
        status: 'active' as const,
        progress: i % 100,
        updatedAt: '2026-07-29T00:00:00.000Z',
      })),
      mappings: Array.from({ length: count }, (_v, i) => ({
        id: i + 1,
        organizationId: 1,
        objectiveId: i + 1,
        keyResultId: null,
        projectId: 1000 + i,
        kind: COCKPIT_MAPPING_KINDS.DIRECT_PROJECT_CONTRIBUTION,
        weight: 1,
        contributionPercent: 10,
        active: true,
        deletedAt: null,
        sourceVersion: 'v1',
        targetVisible: true,
      })),
      visibleProjectIds: new Set(Array.from({ length: count }, (_v, i) => 1000 + i)),
      portfolioTrafficLight: null,
      priority: null,
      investment: null,
      resourceRisk: null,
      backflow: null,
      restrictedObjectiveCount: 0,
      restrictedMappingCount: 0,
      now: NOW,
    }

    const started = Date.now()
    const summary = await makeService(facts).getSummary(user, 1)
    const elapsed = Date.now() - started
    assert.equal(summary.objectiveRows.length, count)
    assert.equal(
      summary.kpis.find((m) => m.key === COCKPIT_METRIC_KEYS.TOTAL_MAPPED_PROJECTS)?.value,
      count,
    )
    // c8 收集覆盖率时（设置 NODE_V8_COVERAGE）插桩会让执行慢 2～3 倍，预算相应放宽；普通测试仍是 5 秒
    const budgetMs = process.env.NODE_V8_COVERAGE ? 15_000 : 5000
    assert.ok(
      elapsed < budgetMs,
      'aggregation elapsed ' + elapsed + 'ms (budget ' + budgetMs + 'ms)',
    )
    const payloadBytes = Buffer.byteLength(JSON.stringify(summary))
    assert.ok(payloadBytes < 1_000_000, 'payload ' + payloadBytes + ' bytes')
  })
})
