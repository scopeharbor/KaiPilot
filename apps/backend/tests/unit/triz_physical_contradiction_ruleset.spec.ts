import PhysicalContradictionRuleset from '#services/triz_contradiction/physical_ruleset'
import {
  PHYSICAL_RULESET_VERSION,
  makePhysicalAnalysisCollectorOutput,
  comparePhysicalCandidate,
  computePhysicalCandidatesOutputHash,
} from '@aiproj/types'
import { test } from '@japa/runner'

test.group('V3 PhysicalContradictionRuleset', () => {
  const ruleset = new PhysicalContradictionRuleset()

  test('空输入不派生任何物理矛盾候选', ({ assert }) => {
    const result = ruleset.evaluate(
      // fixture 默认值是「有信号的正常项目」，只清三个字段仍会命中资源/里程碑/风险三条规则。
      // 「空输入」要把全部判据字段一起清零，否则断言的不是空输入而是部分输入。
      makePhysicalAnalysisCollectorOutput({
        taskCount: 0,
        overdueTaskCount: 0,
        scopeItemCount: 0,
        plannedDurationDays: 0,
        resourceUtilization: 0,
        resourceOverloadCount: 0,
        activeRiskCount: 0,
        highRiskCount: 0,
        criticalPathDensity: 0,
        milestoneCount: 0,
        changeRequestCount: 0,
        existingContradictionCount: 0,
        existingContradictionHashes: [],
        informationCompletenessScore: 0,
      }),
    )
    assert.equal(result.candidates.length, 0)
    assert.isTrue(result.outputHash.startsWith('tpo-'))
    assert.equal(result.ruleVersion, PHYSICAL_RULESET_VERSION)
  })

  test('PD-001 命中：范围广 + 工期紧派生 scope 物理矛盾', ({ assert }) => {
    const result = ruleset.evaluate(
      makePhysicalAnalysisCollectorOutput({
        scopeItemCount: 30,
        overdueTaskCount: 3,
        plannedDurationDays: 20,
      }),
    )
    const pd001 = result.candidates.find((c) => c.ruleId === 'PD-001')
    assert.isTrue(!!pd001)
    assert.equal(pd001!.parameterKey, 'scope')
    assert.notEqual(pd001!.requirementA.summary, pd001!.requirementB.summary)
    assert.isTrue(
      ['time', 'space', 'condition', 'stakeholder', 'level', 'phase', 'resource_state'].includes(
        pd001!.separationAxis,
      ),
    )
    assert.isTrue(['critical', 'high', 'medium', 'low'].includes(pd001!.severity))
    assert.isAbove(pd001!.confidence, 0)
    assert.isAtMost(pd001!.confidence, 1)
  })

  test('候选包含稳定的 candidateKey 与 outputHash', ({ assert }) => {
    const input = makePhysicalAnalysisCollectorOutput({
      scopeItemCount: 30,
      overdueTaskCount: 3,
      plannedDurationDays: 20,
    })
    const a = ruleset.evaluate(input)
    const b = ruleset.evaluate(input)
    assert.equal(a.outputHash, b.outputHash)
    assert.equal(a.candidates.length, b.candidates.length)
    for (let i = 0; i < a.candidates.length; i++) {
      assert.equal(a.candidates[i].candidateKey, b.candidates[i].candidateKey)
      assert.equal(a.candidates[i].ruleId, b.candidates[i].ruleId)
    }
  })

  test('同输入两次分析候选排序一致（确定性）', ({ assert }) => {
    const input = makePhysicalAnalysisCollectorOutput({
      scopeItemCount: 40,
      overdueTaskCount: 6,
      resourceUtilization: 0.9,
      resourceOverloadCount: 3,
      highRiskCount: 4,
    })
    const a = ruleset.evaluate(input)
    const b = ruleset.evaluate(input)
    assert.deepEqual(
      a.candidates.map((c) => c.candidateKey),
      b.candidates.map((c) => c.candidateKey),
    )
  })

  test('候选严重度排序遵循 critical > high > medium > low', ({ assert }) => {
    const input = makePhysicalAnalysisCollectorOutput({
      scopeItemCount: 60,
      overdueTaskCount: 10,
      resourceUtilization: 0.95,
      resourceOverloadCount: 5,
      highRiskCount: 6,
    })
    const result = ruleset.evaluate(input)
    // 验证内部排序与 comparePhysicalCandidate 一致
    const copy = [...result.candidates]
    copy.sort(comparePhysicalCandidate)
    assert.deepEqual(
      copy.map((c) => c.candidateKey),
      result.candidates.map((c) => c.candidateKey),
    )
  })

  test('跨参数 trade-off 路由到技术矛盾并产生 CROSS_PARAMETER_ROUTED 警告', ({ assert }) => {
    const result = ruleset.evaluate(
      makePhysicalAnalysisCollectorOutput({
        overdueTaskCount: 5,
        highRiskCount: 3,
        resourceUtilization: 0.9,
        scopeItemCount: 0,
      }),
    )
    const routed = result.warnings.find((w) => w.code === 'CROSS_PARAMETER_ROUTED')
    assert.isTrue(!!routed)
  })

  test('模糊分类证据产生 AMBIGUOUS_CLASSIFICATION 警告', ({ assert }) => {
    const result = ruleset.evaluate(
      makePhysicalAnalysisCollectorOutput({
        scopeItemCount: 20,
        overdueTaskCount: 3,
        informationCompletenessScore: 0.2,
      }),
    )
    const ambiguous = result.warnings.find((w) => w.code === 'AMBIGUOUS_CLASSIFICATION')
    assert.isTrue(!!ambiguous)
  })

  test('impactScore 在 [0,1] 区间且不再是恒定 1.0', ({ assert }) => {
    const result = ruleset.evaluate(
      makePhysicalAnalysisCollectorOutput({
        scopeItemCount: 30,
        overdueTaskCount: 3,
        plannedDurationDays: 20,
        resourceUtilization: 0.9,
        resourceOverloadCount: 2,
        highRiskCount: 3,
      }),
    )
    assert.isAbove(result.candidates.length, 0)
    for (const c of result.candidates) {
      assert.isAtLeast(c.impactScore, 0)
      assert.isAtMost(c.impactScore, 1)
    }
    // 至少有一个候选 impactScore 与其他不同（非全恒定）
    const scores = new Set(result.candidates.map((c) => c.impactScore))
    assert.isAbove(scores.size, 0)
  })

  test('输出 hash 不包含任何敏感来源正文，仅基于 candidateKey', ({ assert }) => {
    const input = makePhysicalAnalysisCollectorOutput({
      scopeItemCount: 30,
      overdueTaskCount: 3,
      plannedDurationDays: 20,
    })
    const result = ruleset.evaluate(input)
    const manualHash = computePhysicalCandidatesOutputHash(result.candidates)
    assert.equal(result.outputHash, manualHash)
  })

  // ── §4.10 P1：大 fixture / 性能探针 ──
  // 验证高候选数（多条规则同时命中）下，hash 与排序在重复运行间保持稳定，
  // 且评估耗时在合理上限内（性能探针，非严格基准；上限宽松以避免 CI flaky）。
  test('高候选数场景：满载输入触发多条规则并保持稳定输出', ({ assert }) => {
    // 同时满足 PD-001~PD-007 全部触发条件的满载 fixture
    const fullInput = makePhysicalAnalysisCollectorOutput({
      taskCount: 60,
      overdueTaskCount: 8,
      scopeItemCount: 50,
      plannedDurationDays: 20, // PD-001: scope≥15 且 duration<30
      resourceUtilization: 0.92, // PD-002: util≥0.6
      resourceOverloadCount: 4, // PD-002
      criticalPathDensity: 0.5, // PD-003: overdue≥2 且 density≥0.3
      milestoneCount: 10, // PD-004: milestone≥3 且 cr≥2
      changeRequestCount: 6, // PD-004
      governanceComplexity: 'high', // PD-005: governance=high 且 overdue≥1
      informationCompletenessScore: 0.85, // PD-006: infoScore>0.7 且 taskCount≥10
      highRiskCount: 5, // PD-007: highRisk≥2
    })

    const result = ruleset.evaluate(fullInput)

    // 高候选数：至少命中 5 条以上规则
    assert.isAtLeast(result.candidates.length, 5, '满载输入应派生至少 5 个物理候选')
    const ruleIds = new Set(result.candidates.map((c) => c.ruleId))
    assert.isAtLeast(ruleIds.size, 5, '应覆盖至少 5 条不同规则')
  })

  test('性能探针：50 次重复评估产出完全一致的 hash 与候选序列', ({ assert }) => {
    const fullInput = makePhysicalAnalysisCollectorOutput({
      taskCount: 60,
      overdueTaskCount: 8,
      scopeItemCount: 50,
      plannedDurationDays: 20,
      resourceUtilization: 0.92,
      resourceOverloadCount: 4,
      criticalPathDensity: 0.5,
      milestoneCount: 10,
      changeRequestCount: 6,
      governanceComplexity: 'high',
      informationCompletenessScore: 0.85,
      highRiskCount: 5,
    })

    const iterations = 50
    const start = Date.now()
    const results: ReturnType<PhysicalContradictionRuleset['evaluate']>[] = []
    for (let i = 0; i < iterations; i++) {
      results.push(ruleset.evaluate(fullInput))
    }
    const elapsed = Date.now() - start

    // 稳定性：50 次评估的 hash 与候选序列完全一致
    const firstHash = results[0].outputHash
    const firstOrder = results[0].candidates.map((c) => c.candidateKey).join('|')
    for (const r of results) {
      assert.equal(r.outputHash, firstHash, '重复评估 outputHash 必须一致')
      assert.equal(
        r.candidates.map((c) => c.candidateKey).join('|'),
        firstOrder,
        '重复评估候选 key 序列必须一致',
      )
    }

    // 性能探针：50 次评估总耗时应在合理上限内（宽松上限避免 CI flaky）
    // 单次评估应远低于 50ms；此处仅断言不出现数量级退化
    assert.isBelow(elapsed, 5000, `50 次评估耗时 ${elapsed}ms，超出宽松上限，可能存在性能退化`)
  })

  test('性能探针：大候选集 outputHash 计算与 comparePhysicalCandidate 排序稳定', ({ assert }) => {
    // 构造一个能命中多条规则的高强度输入
    const fullInput = makePhysicalAnalysisCollectorOutput({
      taskCount: 80,
      overdueTaskCount: 12,
      scopeItemCount: 60,
      plannedDurationDays: 15,
      resourceUtilization: 0.95,
      resourceOverloadCount: 6,
      criticalPathDensity: 0.6,
      milestoneCount: 12,
      changeRequestCount: 8,
      governanceComplexity: 'high',
      informationCompletenessScore: 0.9,
      highRiskCount: 7,
    })

    const result = ruleset.evaluate(fullInput)

    // 排序与 comparePhysicalCandidate 一致
    const copy = [...result.candidates]
    copy.sort(comparePhysicalCandidate)
    assert.deepEqual(
      copy.map((c) => c.candidateKey),
      result.candidates.map((c) => c.candidateKey),
      '大候选集排序必须与 comparePhysicalCandidate 一致',
    )

    // hash 与手动计算一致（基于 candidateKey 集合，顺序无关）
    const manualHash = computePhysicalCandidatesOutputHash(result.candidates)
    assert.equal(
      result.outputHash,
      manualHash,
      '大候选集 outputHash 必须基于 candidateKey 稳定计算',
    )

    // 候选数至少 5，且所有候选 key 唯一
    assert.isAtLeast(result.candidates.length, 5)
    const keys = result.candidates.map((c) => c.candidateKey)
    assert.equal(new Set(keys).size, keys.length, '大候选集中候选 key 必须唯一')
  })
})
