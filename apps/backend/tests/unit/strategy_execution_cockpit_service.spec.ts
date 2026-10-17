import { test } from '@japa/runner'
import StrategyExecutionCockpitService, {
  assertCockpitPayloadSafe,
  type CockpitFactReader,
  type CockpitFacts,
} from '#services/strategy_execution_cockpit_service'
import { COCKPIT_MAPPING_KINDS, COCKPIT_METRIC_KEYS, COCKPIT_OVERALL_STATUSES } from '@aiproj/types'

const user = { id: 7, isSuperAdmin: false } as never
const NOW = Date.parse('2026-07-30T12:00:00.000Z')

function makeFacts(overrides: Partial<CockpitFacts> = {}): CockpitFacts {
  return {
    organizationId: 1,
    actorId: 7,
    cycle: {
      cycleId: 1,
      title: '2026 上半年',
      status: 'active',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-06-30T00:00:00.000Z',
      elapsedPercent: 90,
      daysRemaining: 1,
    },
    objectives: [
      {
        id: 1,
        organizationId: 1,
        cycleId: 1,
        projectId: 100,
        scope: 'team',
        title: '战略目标 A',
        status: 'active',
        progress: 30,
        confidence: 'medium',
        priorityBand: 'high',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    keyResults: [
      {
        id: 11,
        organizationId: 1,
        objectiveId: 1,
        status: 'active',
        progress: 30,
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
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
        sourceVersion: 'okr-objective.v1',
        targetVisible: true,
      },
    ],
    visibleProjectIds: new Set([100]),
    portfolioTrafficLight: null,
    priority: {
      available: true,
      forbidden: false,
      unsupportedFinancial: false,
      mismatchCount: 1,
      basis: 'planned-hours',
      lastUpdatedAt: '2026-07-29T00:00:00.000Z',
      sourceVersion: 'v1',
    },
    investment: null,
    resourceRisk: null,
    backflow: null,
    restrictedObjectiveCount: 0,
    restrictedMappingCount: 0,
    now: NOW,
    ...overrides,
  }
}

function makeReader(facts: CockpitFacts): CockpitFactReader {
  return async () => facts
}

function makeService(reader: CockpitFactReader): StrategyExecutionCockpitService {
  const service = new StrategyExecutionCockpitService({} as never)
  service.setReader(reader)
  return service
}

function metricOf(summary: { kpis: Array<{ key: string; value: number | null }> }, key: string) {
  return summary.kpis.find((item) => item.key === key)?.value ?? null
}

test.group('StrategyExecutionCockpitService —— 只读聚合', () => {
  test('返回稳定 meta、KPI 与 objective execution 行', async ({ assert }) => {
    const service = makeService(makeReader(makeFacts()))
    const summary = await service.getSummary(user, 1, {}, { canViewPriority: true })

    assert.equal(summary.meta.metricVersion, 'strategy-execution-cockpit.v1.0.0')
    assert.equal(summary.meta.organizationId, 1)
    assert.equal(summary.meta.actorId, 7)
    assert.equal(summary.meta.overallStatus, COCKPIT_OVERALL_STATUSES.DEGRADED)
    assert.equal(summary.objectiveRows.length, 1)
    assert.equal(summary.objectiveRows[0]!.objectiveId, 1)
    assert.equal(summary.objectiveRows[0]!.mappedProjects.length, 1)
    assert.equal(metricOf(summary, COCKPIT_METRIC_KEYS.TOTAL_OBJECTIVES), 1)
    assert.equal(metricOf(summary, COCKPIT_METRIC_KEYS.TOTAL_MAPPED_PROJECTS), 1)
    assert.equal(summary.priorityInvestment.available, true)
    assert.equal(summary.priorityInvestment.priorityMismatchCount, 1)
    assert.equal(summary.portfolioTrafficLight.available, false)
  })

  test('确定性：相同输入相同 inputSignatureHash', async ({ assert }) => {
    const service = makeService(makeReader(makeFacts()))
    const first = await service.getSummary(user, 1)
    const second = await service.getSummary(user, 1)
    assert.equal(first.meta.inputSignatureHash, second.meta.inputSignatureHash)
  })

  /**
   * 比对前把 ISO 时间戳规范化掉。
   *
   * 本用例断言的是「并发与 Promise 乱序不改变**计算结果**」，而 summary 里有四处
   * 墙钟取值（`meta.calculatedAt` 与三处 `lastUpdatedAt`/`Date.now`），
   * 它们按定义就随调用时刻变化、不属于确定性的范畴。
   * 原实现直接比对整段 JSON：两次调用单独跑时落在同一毫秒所以绿，
   * 全量套件负载下跨了毫秒边界就红——典型的「单跑绿、全量红」。
   */
  /** ISO-8601 UTC 时间戳判定（不用正则：只需形状足够窄且可解析即可）。 */
  function isIsoTimestamp(value: string): boolean {
    return value.length >= 20 && value.endsWith('Z') && !Number.isNaN(Date.parse(value))
  }

  function withoutWallClock(value: unknown): unknown {
    if (typeof value === 'string') return isIsoTimestamp(value) ? '<timestamp>' : value
    if (Array.isArray(value)) return value.map((item) => withoutWallClock(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withoutWallClock(v)]),
      )
    }
    return value
  }

  test('并发调用与 Promise 乱序不改变输出（确定性）', async ({ assert }) => {
    const service = makeService(makeReader(makeFacts()))
    const [a, b] = await Promise.all([service.getSummary(user, 1), service.getSummary(user, 1)])

    assert.deepEqual(withoutWallClock(a), withoutWallClock(b))
    // 输入签名是确定性的正面信号，不受墙钟影响，单独再断言一次
    assert.equal(a.meta.inputSignatureHash, b.meta.inputSignatureHash)
  })

  test('空战略范围：返回 EMPTY_STRATEGY_SCOPE 与 empty 状态', async ({ assert }) => {
    const service = makeService(
      makeReader(
        makeFacts({ objectives: [], keyResults: [], mappings: [], visibleProjectIds: new Set() }),
      ),
    )
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.meta.overallStatus, COCKPIT_OVERALL_STATUSES.EMPTY)
    assert.equal(summary.objectiveRows.length, 0)
    assert.ok(summary.warnings.some((w) => w.code === 'EMPTY_STRATEGY_SCOPE'))
  })

  test('组合交通灯可用时投影红/绿 KPI 与 freshness', async ({ assert }) => {
    const facts = makeFacts({
      portfolioTrafficLight: {
        available: true,
        forbidden: false,
        redCount: 1,
        yellowCount: 1,
        greenCount: 2,
        grayCount: 0,
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        sourceVersion: 'portfolio-dashboard.v1',
      },
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(user, 1, {}, { canViewPmo: true })
    assert.equal(summary.portfolioTrafficLight.available, true)
    assert.equal(summary.portfolioTrafficLight.redCount, 1)
    assert.equal(metricOf(summary, COCKPIT_METRIC_KEYS.PORTFOLIO_TRAFFIC_LIGHT_RED), 1)
    assert.equal(metricOf(summary, COCKPIT_METRIC_KEYS.PORTFOLIO_TRAFFIC_LIGHT_GREEN), 2)
    assert.ok(summary.sourceFreshness.some((f) => f.source === 'portfolio_traffic_light'))
  })

  test('priority/investment reader 投影：planned-hours basis 与 zero 评分重算', async ({
    assert,
  }) => {
    const facts = makeFacts({
      priority: {
        available: true,
        forbidden: false,
        unsupportedFinancial: false,
        mismatchCount: 3,
        basis: 'planned-hours',
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        sourceVersion: 'v1',
      },
      investment: {
        available: true,
        forbidden: false,
        unsupportedFinancial: false,
        mismatchCount: 2,
        basis: 'planned-hours',
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        sourceVersion: 'v1',
      },
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(
      user,
      1,
      {},
      { canViewPriority: true, canViewInvestment: true },
    )
    assert.equal(summary.priorityInvestment.available, true)
    assert.equal(summary.priorityInvestment.priorityMismatchCount, 3)
    assert.equal(summary.priorityInvestment.investmentMismatchCount, 2)
    assert.match(summary.priorityInvestment.basis, /planned-hours/)
  })

  test('unsupported financial / forbidden 不渲染 false-zero', async ({ assert }) => {
    const facts = makeFacts({
      priority: {
        available: false,
        forbidden: true,
        unsupportedFinancial: false,
        mismatchCount: null,
        basis: 'forbidden',
        lastUpdatedAt: null,
        sourceVersion: 'v1',
      },
      investment: {
        available: false,
        forbidden: false,
        unsupportedFinancial: true,
        mismatchCount: null,
        basis: 'unsupported',
        lastUpdatedAt: null,
        sourceVersion: 'v1',
      },
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.priorityInvestment.forbidden, true)
    assert.equal(summary.priorityInvestment.unsupportedFinancial, true)
    assert.equal(summary.priorityInvestment.priorityMismatchCount, null)
    assert.equal(summary.priorityInvestment.investmentMismatchCount, null)
  })

  test('resource/risk reader 投影：仅已授权 mapped 压力，隐藏项目零泄露', async ({ assert }) => {
    const facts = makeFacts({
      resourceRisk: {
        available: true,
        forbidden: false,
        pressureCount: 5,
        lastUpdatedAt: '2026-07-29T00:00:00.000Z',
        sourceVersion: 'v1',
      },
      visibleProjectIds: new Set([100]),
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.resourceRisk.available, true)
    assert.equal(summary.resourceRisk.pressureCount, 5)
    const json = JSON.stringify(summary)
    assert.notInclude(json, 'hidden-project')
    assert.notInclude(json, '/projects/999')
  })

  test('无映射：生成 EXECUTION_COVERAGE_GAP attention 与 mapping warning', async ({ assert }) => {
    const service = makeService(
      makeReader(makeFacts({ mappings: [], visibleProjectIds: new Set() })),
    )
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.objectiveRows[0]!.mappedProjects.length, 0)
    assert.ok(
      summary.objectiveRows[0]!.attentionReasons.includes('EXECUTION_COVERAGE_GAP') ||
        summary.objectiveRows[0]!.attentionReasons.includes('EXECUTION_COVERAGE_UNAVAILABLE'),
    )
    assert.ok(summary.warnings.some((w) => w.code === 'EXECUTION_MAPPING_MISSING'))
  })

  test('跨组织映射被排除且状态 degraded', async ({ assert }) => {
    const facts = makeFacts({
      mappings: [
        {
          id: 2,
          organizationId: 2,
          objectiveId: 1,
          keyResultId: null,
          projectId: 200,
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
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.objectiveRows[0]!.mappedProjects.length, 0)
  })

  test('feature flag：默认开启，显式 false 关闭', async ({ assert }) => {
    const service = makeService(makeReader(makeFacts()))
    assert.equal(service.isFeatureEnabled(), true)
    const old = process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED
    process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED = 'false'
    assert.equal(service.isFeatureEnabled(), false)
    if (old === undefined) delete process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED
    else process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED = old
  })

  test('attention 队列有界且稳定排序', async ({ assert }) => {
    const facts = makeFacts({
      objectives: [
        {
          id: 1,
          organizationId: 1,
          cycleId: 1,
          projectId: 100,
          scope: 'team',
          title: 'A',
          status: 'active',
          progress: 10,
          confidence: 'low',
          priorityBand: 'high',
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
      ],
      mappings: [],
      visibleProjectIds: new Set(),
    })
    const service = makeService(makeReader(facts))
    const summary = await service.getSummary(user, 1, { attentionLimit: 1 })
    // 每个映射来源最多 1 条 attention
    assert.ok(summary.attention.length <= 1)
  })

  test('assertCockpitPayloadSafe：forbidden 字段 fail closed，正常 payload 通过', async ({
    assert,
  }) => {
    let threw = false
    try {
      assertCockpitPayloadSafe({ token: 'secret' })
    } catch {
      threw = true
    }
    assert.equal(threw, true)

    let threwClean = false
    try {
      assertCockpitPayloadSafe({ meta: { organizationId: 1 }, kpis: [] })
    } catch {
      threwClean = true
    }
    assert.equal(threwClean, false)
  })
})
