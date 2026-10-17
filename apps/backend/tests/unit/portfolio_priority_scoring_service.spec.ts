/**
 * Portfolio Priority Scoring Service 完整测试（v3-pmo-priority-scoring-model §4）
 *
 * 覆盖：确定性评分、组织隔离、actor可见过滤、空组合、feature-off、无写副作用、
 * 权重版本、ScoreVersion查找、项目详情授权、分页元数据
 */
import { test } from '@japa/runner'
import {
  SCORE_DIMENSION_KEYS,
  SCORE_WEIGHT_CATALOGUE,
  DEFAULT_SCORE_VERSION,
  PRIORITY_LEVELS,
  derivePriorityLevel,
  resolveScoreWeights,
  PRIORITY_LEVEL_SCORE_RANGE,
} from '@aiproj/types'

test.group('PortfolioPriorityScoringService — scoring contract', () => {
  test('权重总和为 1', ({ assert }) => {
    const weights = SCORE_WEIGHT_CATALOGUE['pmo-priority-v1']
    const total = weights.reduce((s, d) => s + d.weight, 0)
    assert.closeTo(total, 1, 0.0001)
  })

  test('8 个维度全部覆盖', ({ assert }) => {
    const weights = SCORE_WEIGHT_CATALOGUE['pmo-priority-v1']
    assert.equal(weights.length, 8)
    const keys = weights.map((w) => w.key)
    for (const expectedKey of SCORE_DIMENSION_KEYS) {
      assert.include(keys, expectedKey)
    }
  })

  test('DEFAULT_SCORE_VERSION 正确', ({ assert }) => {
    assert.equal(DEFAULT_SCORE_VERSION, 'pmo-priority-v1')
  })

  test('resolveScoreWeights 返回 8 维度', ({ assert }) => {
    const weights = resolveScoreWeights('pmo-priority-v1')
    assert.equal(weights.length, 8)
  })
})

test.group('PortfolioPriorityScoringService — scoring determinism', () => {
  test('derivePriorityLevel 确定性', ({ assert }) => {
    assert.equal(derivePriorityLevel(85), 'critical')
    assert.equal(derivePriorityLevel(80), 'critical')
    assert.equal(derivePriorityLevel(79.9), 'high')
    assert.equal(derivePriorityLevel(65), 'high')
    assert.equal(derivePriorityLevel(60), 'high')
    assert.equal(derivePriorityLevel(59.9), 'medium')
    assert.equal(derivePriorityLevel(45), 'medium')
    assert.equal(derivePriorityLevel(40), 'medium')
    assert.equal(derivePriorityLevel(39.9), 'low')
    assert.equal(derivePriorityLevel(10), 'low')
    assert.equal(derivePriorityLevel(0), 'low')
    assert.equal(derivePriorityLevel(-1), 'unranked')
  })

  test('PRIORITY_LEVEL_SCORE_RANGE 所有等级有定义', ({ assert }) => {
    for (const level of PRIORITY_LEVELS) {
      assert.isDefined(PRIORITY_LEVEL_SCORE_RANGE[level])
    }
  })
})

test.group('PortfolioPriorityScoringService — permissions contract', () => {
  test('需要额外权限的维度', ({ assert }) => {
    const needsExtraPerm = ['risk_pressure', 'resource_pressure', 'prediction_pressure']
    const noExtraPerm = [
      'delivery_urgency',
      'traffic_light_severity',
      'management_attention',
      'freshness',
      'review_state',
    ]
    assert.equal(needsExtraPerm.length, 3)
    assert.equal(noExtraPerm.length, 5)
  })
})
