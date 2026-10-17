import { test } from '@japa/runner'
import TrizEvolutionTrendRuleEngine from '#services/triz_evolution_trend_rule_engine'
import {
  makeEvolutionTrendCollectorOutput,
  makeSubsystemImbalanceCollectorOutput,
  makeRoleGapCollectorOutput,
  makeExternalDependencyBottleneckCollectorOutput,
  makeIdealityDeclineCollectorOutput,
  makeMissingSourceCollectorOutput,
  compareTrendRiskCandidate,
  compareTrendScore,
  EVOLUTION_TREND_IDS,
  TREND_RISK_TYPE_TREND_MAP,
  EVOLUTION_TREND_RULESET_VERSION,
  type EvolutionTrendCollectorOutput,
} from '@aiproj/types'

// ===========================================================================
// TRIZ 进化趋势规则引擎测试（v3-triz-evolution-trend-analysis §4.4–§4.6）
//
// 规则引擎是纯确定性逻辑：不碰数据库、不调 AI、不写任何正式数据。
// 本套件对 8 大趋势评分与 8 类风险候选逐类断言，覆盖缺失证据降级、
// 确定性排序与 advisory-only 边界。
// ===========================================================================

const engine = new TrizEvolutionTrendRuleEngine()

function riskTypesOf(input: EvolutionTrendCollectorOutput): string[] {
  return engine.evaluate(input).risks.map((r) => r.riskType)
}

test.group('TrizEvolutionTrendRuleEngine — 8 大趋势评分', () => {
  test('默认健康输入产出 8 个趋势评分', ({ assert }) => {
    const { trends } = engine.evaluate(makeEvolutionTrendCollectorOutput())
    assert.lengthOf(trends, 8)
    const trendIds = trends.map((t) => t.trendId)
    for (const id of EVOLUTION_TREND_IDS) {
      assert.isTrue(trendIds.includes(id), `缺少趋势 ${id}`)
    }
  })

  test('每个趋势评分携带稳定 trendKey / 阶段 / 严重度 / 方向', ({ assert }) => {
    const { trends } = engine.evaluate(makeEvolutionTrendCollectorOutput())
    for (const t of trends) {
      assert.match(t.trendKey, /^trk-/)
      assert.isString(t.stage)
      assert.isNumber(t.score)
      assert.isAtLeast(t.score, 0)
      assert.isAtMost(t.score, 1)
      assert.isNumber(t.confidence)
      assert.isAbove(t.confidence, 0)
      assert.isAtMost(t.confidence, 1)
      assert.isString(t.severity)
      assert.isString(t.direction)
    }
  })

  test('相同输入两次运行产出相同趋势 key 序列', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput()
    const first = engine.evaluate(input).trends.map((t) => t.trendKey)
    const second = engine.evaluate(input).trends.map((t) => t.trendKey)
    assert.deepEqual(first, second)
  })

  test('趋势评分经共享比较器排序后结果稳定', ({ assert }) => {
    const { trends } = engine.evaluate(makeEvolutionTrendCollectorOutput())
    const sorted1 = [...trends].sort(compareTrendScore).map((t) => t.trendKey)
    const sorted2 = [...trends].sort(compareTrendScore).map((t) => t.trendKey)
    assert.deepEqual(sorted1, sorted2)
  })

  test('规则版本与共享契约一致', ({ assert }) => {
    assert.equal(EVOLUTION_TREND_RULESET_VERSION, '1.0.0')
  })

  test('角色缺口场景降低完备性趋势评分', ({ assert }) => {
    const healthy = engine.evaluate(makeEvolutionTrendCollectorOutput())
    const gap = engine.evaluate(makeRoleGapCollectorOutput())
    const healthyCompleteness = healthy.trends.find((t) => t.trendId === 'completeness')!
    const gapCompleteness = gap.trends.find((t) => t.trendId === 'completeness')!
    assert.isBelow(gapCompleteness.score, healthyCompleteness.score)
  })

  test('子系统不均衡场景降低不均衡进化趋势评分', ({ assert }) => {
    const healthy = engine.evaluate(makeEvolutionTrendCollectorOutput())
    const imbalanced = engine.evaluate(makeSubsystemImbalanceCollectorOutput())
    const healthyUneven = healthy.trends.find((t) => t.trendId === 'uneven_subsystem_evolution')!
    const imbalancedUneven = imbalanced.trends.find(
      (t) => t.trendId === 'uneven_subsystem_evolution',
    )!
    assert.isBelow(imbalancedUneven.score, healthyUneven.score)
  })
})

test.group('TrizEvolutionTrendRuleEngine — 8 类风险候选', () => {
  test('角色缺口场景产出 role_gap 候选', ({ assert }) => {
    assert.include(riskTypesOf(makeRoleGapCollectorOutput()), 'role_gap')
  })

  test('阻塞任务多产出 information_flow_delay 候选', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({
      blockedTaskCount: 5,
      averageBlockedWaitDays: 8,
    })
    assert.include(riskTypesOf(input), 'information_flow_delay')
    // 无阻塞时不产出
    assert.notInclude(
      riskTypesOf(
        makeEvolutionTrendCollectorOutput({ blockedTaskCount: 0, averageBlockedWaitDays: 0 }),
      ),
      'information_flow_delay',
    )
  })

  test('高返工比产出 process_rigidity 候选', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({ reworkRatio: 0.4 })
    assert.include(riskTypesOf(input), 'process_rigidity')
    assert.notInclude(
      riskTypesOf(makeEvolutionTrendCollectorOutput({ reworkRatio: 0.05 })),
      'process_rigidity',
    )
  })

  test('子系统进度差大产出 subsystem_imbalance 候选', ({ assert }) => {
    assert.include(riskTypesOf(makeSubsystemImbalanceCollectorOutput()), 'subsystem_imbalance')
  })

  test('外部依赖不健康产出 external_dependency_bottleneck 候选', ({ assert }) => {
    assert.include(
      riskTypesOf(makeExternalDependencyBottleneckCollectorOutput()),
      'external_dependency_bottleneck',
    )
    // 无外部依赖时不产出
    assert.notInclude(
      riskTypesOf(
        makeEvolutionTrendCollectorOutput({
          externalDependencyCount: 0,
          unhealthyExternalDependencyCount: 0,
        }),
      ),
      'external_dependency_bottleneck',
    )
  })

  test('大项目或粗粒度任务产出 complexity_granularity_risk 候选', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({
      taskTotal: 40,
      averageTaskGranularityDays: 10,
    })
    assert.include(riskTypesOf(input), 'complexity_granularity_risk')
  })

  test('理想度恶化场景产出 ideality_decline 候选', ({ assert }) => {
    assert.include(riskTypesOf(makeIdealityDeclineCollectorOutput()), 'ideality_decline')
  })

  test('协调失配产出 coordination_drift 候选', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({
      dependencyRhythmMismatchCount: 4,
      resourceLoadSyncSpread: 0.6,
    })
    assert.include(riskTypesOf(input), 'coordination_drift')
  })

  test('每类风险都关联到正确的趋势', ({ assert }) => {
    const { risks } = engine.evaluate(
      makeEvolutionTrendCollectorOutput({
        blockedTaskCount: 5,
        averageBlockedWaitDays: 8,
        reworkRatio: 0.4,
        subsystemProgressSpread: 0.85,
        externalDependencyCount: 5,
        unhealthyExternalDependencyCount: 3,
        taskTotal: 40,
        averageTaskGranularityDays: 10,
        deliveredValueItemCount: 1,
        costGrowthSignals: 5,
        harmOrRiskGrowthSignals: 6,
        dependencyRhythmMismatchCount: 4,
        resourceLoadSyncSpread: 0.6,
        memberCount: 2,
        distinctRoleCount: 1,
        singlePersonRoleCount: 1,
      }),
    )
    for (const risk of risks) {
      assert.equal(
        risk.trendId,
        TREND_RISK_TYPE_TREND_MAP[risk.riskType as keyof typeof TREND_RISK_TYPE_TREND_MAP],
      )
    }
  })
})

test.group('TrizEvolutionTrendRuleEngine — 确定性与 advisory 边界', () => {
  test('相同输入两次运行产出相同风险 key 序列', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({
      blockedTaskCount: 5,
      reworkRatio: 0.4,
      subsystemProgressSpread: 0.85,
    })
    const first = engine.evaluate(input).risks.map((r) => r.riskKey)
    const second = engine.evaluate(input).risks.map((r) => r.riskKey)
    assert.deepEqual(first, second)
  })

  test('风险候选经共享比较器排序后结果稳定', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({
      blockedTaskCount: 5,
      reworkRatio: 0.4,
      subsystemProgressSpread: 0.85,
      externalDependencyCount: 5,
      unhealthyExternalDependencyCount: 3,
    })
    const { risks } = engine.evaluate(input)
    const sorted1 = [...risks].sort(compareTrendRiskCandidate).map((r) => r.riskKey)
    const sorted2 = [...risks].sort(compareTrendRiskCandidate).map((r) => r.riskKey)
    assert.deepEqual(sorted1, sorted2)
  })

  test('候选一律为 unreviewed 且不携带审查人/AI 引用', ({ assert }) => {
    const { risks } = engine.evaluate(
      makeEvolutionTrendCollectorOutput({
        blockedTaskCount: 5,
        reworkRatio: 0.4,
      }),
    )
    assert.isAtLeast(risks.length, 1)
    for (const risk of risks) {
      assert.equal(risk.status, 'unreviewed')
      assert.isNull(risk.reviewedBy)
      assert.isNull(risk.reviewedAt)
      assert.isNull(risk.aiExplanationRef)
      assert.isNumber(risk.impactScore)
      assert.isAbove(risk.impactScore, 0)
      assert.match(risk.outputHash, /^tet-ro-/)
      assert.isString(risk.ruleId)
    }
  })

  test('建议动作只用审查导向措辞，不含自动执行文案', ({ assert }) => {
    const { risks } = engine.evaluate(
      makeEvolutionTrendCollectorOutput({
        blockedTaskCount: 5,
        reworkRatio: 0.4,
        subsystemProgressSpread: 0.85,
      }),
    )
    const banned = ['自动应用', '一键优化', '自动规划', '自动解决', '自动导出', '一键执行']
    assert.isAtLeast(risks.length, 1)
    for (const risk of risks) {
      for (const action of risk.suggestedActions) {
        for (const word of banned) {
          assert.notInclude(action, word)
        }
      }
    }
  })

  test('规则引擎不修改传入的收集输出（无副作用）', ({ assert }) => {
    const input = makeEvolutionTrendCollectorOutput({ blockedTaskCount: 5 })
    const before = JSON.stringify(input)
    engine.evaluate(input)
    assert.equal(JSON.stringify(input), before)
  })

  test('缺失来源时降低置信度并产出 warning，不编造阶段/评分', ({ assert }) => {
    const { trends } = engine.evaluate(
      makeMissingSourceCollectorOutput({ distinctRoleCount: 0, memberCount: 0 }),
    )
    assert.lengthOf(trends, 8)
    // 完备性趋势在 distinctRoleCount=0 时应有 INSUFFICIENT_TREND_SOURCE warning
    const completeness = trends.find((t) => t.trendId === 'completeness')!
    assert.isTrue(completeness.warningCodes.includes('INSUFFICIENT_TREND_SOURCE'))
    // 仍产出有效评分（不编造，但维度齐全）
    assert.isNumber(completeness.score)
  })

  test('无任何风险信号时不产出风险而非编造风险', ({ assert }) => {
    const healthy = makeEvolutionTrendCollectorOutput({
      blockedTaskCount: 0,
      averageBlockedWaitDays: 0,
      reworkRatio: 0,
      subsystemProgressSpread: 0.1,
      externalDependencyCount: 0,
      unhealthyExternalDependencyCount: 0,
      taskTotal: 5,
      averageTaskGranularityDays: 1,
      deliveredValueItemCount: 10,
      costGrowthSignals: 0,
      harmOrRiskGrowthSignals: 0,
      dependencyRhythmMismatchCount: 0,
      resourceLoadSyncSpread: 0.05,
      distinctRoleCount: 6,
      singlePersonRoleCount: 0,
    })
    const { risks } = engine.evaluate(healthy)
    assert.lengthOf(risks, 0)
  })

  test('500 候选大输入在本地预算内完成（<1s）', ({ assert }) => {
    // 构造可触发多类风险的满载输入
    const input = makeEvolutionTrendCollectorOutput({
      taskTotal: 500,
      blockedTaskCount: 50,
      averageBlockedWaitDays: 10,
      reworkRatio: 0.5,
      subsystemProgressSpread: 0.9,
      externalDependencyCount: 50,
      unhealthyExternalDependencyCount: 30,
      averageTaskGranularityDays: 15,
      deliveredValueItemCount: 1,
      costGrowthSignals: 10,
      harmOrRiskGrowthSignals: 12,
      dependencyRhythmMismatchCount: 20,
      resourceLoadSyncSpread: 0.8,
    })

    const started = performance.now()
    for (let i = 0; i < 50; i++) {
      engine.evaluate(input)
    }
    const elapsed = performance.now() - started
    // 50 次满载评估应在 1s 内
    assert.isBelow(elapsed, 1000)
  })
})
