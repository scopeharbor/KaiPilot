/**
 * v3-ai-quality-cost-console-deferred-p1 —— SLO 阈值兜底合并纯函数单测（Japa，无 DB）。
 *
 * 覆盖 mergeSloDefinitionsWithDefaults：
 * - 空表 → 五指标全默认兜底（可空表启动）；
 * - 持久化行优先于默认；
 * - 缺失指标用默认补齐；
 * - 非法 indicator 行被跳过；
 * - 声明式默认带 runbook 与来源标记（D2 硬约束）。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import { AI_SLO_INDICATORS } from '@aiproj/types'
import {
  DECLARED_DEFAULT_SOURCE,
  mergeSloDefinitionsWithDefaults,
  type SloThresholdRowLike,
} from '#services/ai_slo/slo_threshold_service'

function buildRow(overrides: Partial<SloThresholdRowLike> = {}): SloThresholdRowLike {
  return {
    id: 1,
    organizationId: 42,
    indicator: 'failure_rate',
    warningOperator: 'gt',
    warningValue: 0.03,
    warningUnit: 'ratio',
    criticalOperator: 'gt',
    criticalValue: 0.15,
    criticalUnit: 'ratio',
    windowMs: 3_600_000,
    runbookRef: 'runbook://custom/failure-rate',
    thresholdSource: 'operator_set',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  }
}

test.group('SLO 阈值声明式默认兜底（D2）', () => {
  test('空表 → 五指标全部回退到声明式默认（可空表启动）', ({ assert }) => {
    const defs = mergeSloDefinitionsWithDefaults([], 42)

    assert.lengthOf(defs, AI_SLO_INDICATORS.length)
    assert.deepEqual(
      defs.map((d) => d.indicator),
      [...AI_SLO_INDICATORS],
    )
    for (const def of defs) {
      assert.equal(def.organizationId, 42)
      assert.equal(def.warning.source, DECLARED_DEFAULT_SOURCE)
      assert.equal(def.critical.source, DECLARED_DEFAULT_SOURCE)
      assert.isTrue(def.runbookRef.length > 0)
      assert.isTrue(def.windowMs > 0)
    }
  })

  test('持久化行优先于默认，缺失指标用默认补齐', ({ assert }) => {
    const defs = mergeSloDefinitionsWithDefaults([buildRow()], 42)

    const failureRate = defs.find((d) => d.indicator === 'failure_rate')
    assert.isDefined(failureRate)
    assert.equal(failureRate!.warning.value, 0.03)
    assert.equal(failureRate!.critical.value, 0.15)
    assert.equal(failureRate!.windowMs, 3_600_000)
    assert.equal(failureRate!.runbookRef, 'runbook://custom/failure-rate')
    assert.equal(failureRate!.warning.source, 'operator_set')
    assert.equal(failureRate!.id, 'persisted-1')
    assert.equal(failureRate!.createdAt, '2026-08-01T00:00:00.000Z')

    const ttft = defs.find((d) => d.indicator === 'ttft')
    assert.isDefined(ttft)
    assert.equal(ttft!.warning.source, DECLARED_DEFAULT_SOURCE)
    assert.equal(ttft!.id, 'default-ttft')
  })

  test('非法 indicator 行被跳过，对应指标仍由默认兜底', ({ assert }) => {
    const defs = mergeSloDefinitionsWithDefaults(
      [buildRow({ indicator: 'not_a_real_indicator' })],
      42,
    )

    assert.lengthOf(defs, AI_SLO_INDICATORS.length)
    const failureRate = defs.find((d) => d.indicator === 'failure_rate')
    assert.equal(failureRate!.warning.source, DECLARED_DEFAULT_SOURCE)
    assert.isUndefined(defs.find((d) => (d.indicator as string) === 'not_a_real_indicator'))
  })

  test('同一指标多行时后行覆盖前行（Map 语义，唯一约束外的防御）', ({ assert }) => {
    const defs = mergeSloDefinitionsWithDefaults(
      [buildRow({ id: 1, warningValue: 0.03 }), buildRow({ id: 2, warningValue: 0.09 })],
      42,
    )

    const failureRate = defs.find((d) => d.indicator === 'failure_rate')
    assert.equal(failureRate!.warning.value, 0.09)
    assert.equal(failureRate!.id, 'persisted-2')
  })

  test('时间列容忍 Date / ISO 字符串 / 非法值', ({ assert }) => {
    const defs = mergeSloDefinitionsWithDefaults(
      [
        buildRow({ id: 1, createdAt: '2026-07-01T12:00:00.000Z', updatedAt: 'garbage' }),
        buildRow({ id: 2, indicator: 'ttft', createdAt: null, updatedAt: undefined }),
      ],
      42,
    )

    const failureRate = defs.find((d) => d.indicator === 'failure_rate')
    assert.equal(failureRate!.createdAt, '2026-07-01T12:00:00.000Z')
    assert.equal(failureRate!.updatedAt, '2026-01-01T00:00:00.000Z')

    const ttft = defs.find((d) => d.indicator === 'ttft')
    assert.equal(ttft!.createdAt, '2026-01-01T00:00:00.000Z')
  })
})
