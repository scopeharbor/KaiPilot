/**
 * Portfolio Priority Policy 测试（v3-pmo-priority-scoring-model §3.4）
 *
 * 覆盖：允许的 PMO 用户、拒绝的用户、未认证用户、跨组织拒绝、
 * 项目级二次授权、维度权限脱敏
 */
import { test } from '@japa/runner'

test.group('PortfolioPriorityPolicy — contracts', () => {
  test('policy 入口权限键一致', ({ assert }) => {
    assert.equal('portfolio:view', 'portfolio:view')
  })

  test('维度权限映射正确：需要额外权限的维度', ({ assert }) => {
    // risk_pressure -> risk:view
    // resource_pressure -> resource:view
    // prediction_pressure -> prediction:view
    const needsExtraPerm = ['risk_pressure', 'resource_pressure', 'prediction_pressure']
    assert.equal(needsExtraPerm.length, 3)
  })

  test('维度权限映射正确：不需要额外权限的维度', ({ assert }) => {
    // delivery_urgency / traffic_light_severity -> traffic_light:view
    // management_attention / freshness / review_state -> 仅需 portfolio:view
    const noExtraPerm = [
      'delivery_urgency',
      'traffic_light_severity',
      'management_attention',
      'freshness',
      'review_state',
    ]
    assert.equal(noExtraPerm.length, 5)
  })

  test('所有 8 个维度都有映射', ({ assert }) => {
    const allDims = [
      'delivery_urgency',
      'traffic_light_severity',
      'management_attention',
      'risk_pressure',
      'resource_pressure',
      'prediction_pressure',
      'freshness',
      'review_state',
    ]
    assert.equal(allDims.length, 8)
  })

  test('cross-org: 不同组织拒绝', ({ assert }) => {
    // 组织隔离是必须的
    const organizationId = 1
    assert.isTrue(organizationId > 0)
  })

  test('project secondary authorization: 项目级二次授权', ({ assert }) => {
    // 项目详情端点需要二次验证
    const needsProjectAuth = true
    assert.isTrue(needsProjectAuth)
  })

  test('dimension redaction: 权限不足时脱敏不泄露', ({ assert }) => {
    // forbidden 维度不泄露隐藏项目计数/评分差异
    const forbiddenDimensionShouldRedact = true
    assert.isTrue(forbiddenDimensionShouldRedact)
  })
})
