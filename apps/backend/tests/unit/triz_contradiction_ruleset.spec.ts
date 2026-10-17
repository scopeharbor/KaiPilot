import ContradictionDetectionRuleset, {
  RULESET_VERSION,
} from '#services/triz_contradiction/ruleset'
import { computeInputSignature, CONTRADICTION_RULESET_VERSION } from '@aiproj/types'
import { test } from '@japa/runner'
import type { ContradictionInputSnapshot } from '@aiproj/types'

function snapshot(over: Partial<ContradictionInputSnapshot> = {}): ContradictionInputSnapshot {
  return {
    organizationId: 1,
    projectId: 10,
    taskTotal: 20,
    overdueTaskCount: 0,
    criticalPathTaskCount: 0,
    criticalPathDensity: 0,
    resourceUtilization: null,
    resourceOverloadCount: 0,
    activeRiskCount: 0,
    highRiskCount: 0,
    milestoneTotal: 0,
    changeRequestCount: 0,
    plannedDurationDays: null,
    scopeItemCount: 0,
    warnings: [],
    ruleVersion: CONTRADICTION_RULESET_VERSION,
    ...over,
  }
}

test.group('V2 TRIZ ContradictionDetectionRuleset', () => {
  const ruleset = new ContradictionDetectionRuleset()

  test('空输入不派生任何矛盾', ({ assert }) => {
    const result = ruleset.evaluate(snapshot())
    assert.equal(result.candidates.length, 0)
    assert.isTrue(result.outputHash.startsWith('out-'))
    assert.equal(result.ruleVersion, RULESET_VERSION)
  })

  test('CD-001 工期压力命中：逾期任务驱动 technical duration↔cost/risk', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({ taskTotal: 20, overdueTaskCount: 6, highRiskCount: 0 }),
    )
    const cd001 = result.candidates.find((c) => c.ruleId === 'CD-001')
    assert.isTrue(!!cd001)
    assert.equal(cd001!.type, 'technical')
    assert.equal(cd001!.improvingParameterKey, 'duration')
    assert.isTrue(
      cd001!.worseningParameterKey === 'cost' || cd001!.worseningParameterKey === 'risk_level',
    )
  })

  test('CD-001 逾期率高时严重度更高', ({ assert }) => {
    const low = ruleset.evaluate(snapshot({ taskTotal: 20, overdueTaskCount: 2 }))
    const high = ruleset.evaluate(snapshot({ taskTotal: 20, overdueTaskCount: 12 }))
    const lowSev = low.candidates.find((c) => c.ruleId === 'CD-001')?.severity
    const highSev = high.candidates.find((c) => c.ruleId === 'CD-001')?.severity
    assert.isTrue(!!lowSev && !!highSev)
    // high 严重度序号应不低于 low（critical > high > medium > low）
    assert.isTrue(rank(highSev!) >= rank(lowSev!))
  })

  test('CD-001 不命中：无逾期', ({ assert }) => {
    const result = ruleset.evaluate(snapshot({ taskTotal: 20, overdueTaskCount: 0 }))
    assert.isUndefined(result.candidates.find((c) => c.ruleId === 'CD-001'))
  })

  test('CD-002 资源利用率与过载命中 technical resource_load↔stability', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({ resourceUtilization: 0.9, resourceOverloadCount: 2 }),
    )
    const cd002 = result.candidates.find((c) => c.ruleId === 'CD-002')
    assert.isTrue(!!cd002)
    assert.equal(cd002!.improvingParameterKey, 'resource_load')
    assert.equal(cd002!.worseningParameterKey, 'stability')
  })

  test('CD-003 范围广度命中 technical scope↔duration/quality', ({ assert }) => {
    const result = ruleset.evaluate(snapshot({ scopeItemCount: 30 }))
    const cd003 = result.candidates.find((c) => c.ruleId === 'CD-003')
    assert.isTrue(!!cd003)
    assert.equal(cd003!.improvingParameterKey, 'scope')
  })

  test('CD-004 高风险命中 technical risk_level↔cost/duration', ({ assert }) => {
    const result = ruleset.evaluate(snapshot({ highRiskCount: 3 }))
    const cd004 = result.candidates.find((c) => c.ruleId === 'CD-004')
    assert.isTrue(!!cd004)
    assert.equal(cd004!.improvingParameterKey, 'risk_level')
  })

  test('CD-004 不命中：高风险不足阈值', ({ assert }) => {
    const result = ruleset.evaluate(snapshot({ highRiskCount: 1 }))
    assert.isUndefined(result.candidates.find((c) => c.ruleId === 'CD-004'))
  })

  test('CD-005 关键路径密度高命中 technical throughput↔flexibility', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({ taskTotal: 20, criticalPathTaskCount: 10, criticalPathDensity: 0.5 }),
    )
    const cd005 = result.candidates.find((c) => c.ruleId === 'CD-005')
    assert.isTrue(!!cd005)
    assert.equal(cd005!.improvingParameterKey, 'throughput')
    assert.equal(cd005!.worseningParameterKey, 'flexibility')
  })

  test('CD-006 物理矛盾：范围广 + 工期短同时存在', ({ assert }) => {
    const result = ruleset.evaluate(snapshot({ scopeItemCount: 30, plannedDurationDays: 20 }))
    const cd006 = result.candidates.find((c) => c.ruleId === 'CD-006')
    assert.isTrue(!!cd006)
    assert.equal(cd006!.type, 'physical')
    assert.equal(cd006!.parameterKey, 'scope')
    assert.equal(cd006!.requirementA, '范围要完整覆盖')
    assert.equal(cd006!.requirementB, '交付要快速完成')
  })

  test('CD-006 不命中：仅范围广但工期宽裕', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({ scopeItemCount: 30, plannedDurationDays: 90, overdueTaskCount: 0 }),
    )
    assert.isUndefined(result.candidates.find((c) => c.ruleId === 'CD-006'))
  })

  test('候选按严重度稳定排序（critical 先于 low）', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({
        taskTotal: 20,
        overdueTaskCount: 16, // 强工期压力 → critical/high
        highRiskCount: 4,
        resourceUtilization: 0.95,
        resourceOverloadCount: 3,
        criticalPathTaskCount: 12,
        criticalPathDensity: 0.6,
        scopeItemCount: 40,
        plannedDurationDays: 20,
      }),
    )
    assert.isTrue(result.candidates.length > 1)
    for (let i = 1; i < result.candidates.length; i++) {
      assert.isTrue(
        rank(result.candidates[i - 1].severity) >= rank(result.candidates[i].severity),
        'severity 非递增',
      )
    }
  })

  test('output hash 稳定：同输入同结果同 hash（幂等）', ({ assert }) => {
    const snap = snapshot({ taskTotal: 20, overdueTaskCount: 6, highRiskCount: 3 })
    const r1 = ruleset.evaluate(snap)
    const r2 = ruleset.evaluate(structuredClone(snap))
    assert.equal(r1.outputHash, r2.outputHash)
    assert.deepEqual(
      r1.candidates.map((c) => c.ruleId),
      r2.candidates.map((c) => c.ruleId),
    )
  })

  test('输入签名一致判定无变化', ({ assert }) => {
    const snap = snapshot({ taskTotal: 20, overdueTaskCount: 6 })
    const sig1 = computeInputSignature(snap)
    const sig2 = computeInputSignature(structuredClone(snap))
    assert.equal(sig1, sig2)
  })

  test('warnings 透传数据源缺失标注', ({ assert }) => {
    const result = ruleset.evaluate(
      snapshot({
        warnings: [{ code: 'DATA_SOURCE_UNAVAILABLE', message: '资源不可用', source: 'resources' }],
      }),
    )
    assert.isTrue(result.warnings.some((w) => w.code === 'DATA_SOURCE_UNAVAILABLE'))
  })
})

function rank(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity] ?? 0
}
