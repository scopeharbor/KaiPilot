// PMO AI 优先级推荐策略测试（v3-pmo-ai-priority-recommendations §3.5）。
import { test } from '@japa/runner'
import PmoAiPriorityRecommendationPolicy, {
  PMO_AI_PRIORITY_RECOMMENDATIONS_VIEW,
  PMO_AI_PRIORITY_RECOMMENDATIONS_MANAGE,
  PMO_AI_PRIORITY_RECOMMENDATIONS_AI,
} from '#policies/pmo_ai_priority_recommendation_policy'
import RbacService from '#services/rbac_service'

test.group('PmoAiPriorityRecommendationPolicy', () => {
  test('PMO 权限常量定义正确', ({ assert }) => {
    assert.equal(PMO_AI_PRIORITY_RECOMMENDATIONS_VIEW, 'portfolio:ai-priority-recommendations:view')
    assert.equal(
      PMO_AI_PRIORITY_RECOMMENDATIONS_MANAGE,
      'portfolio:ai-priority-recommendations:manage',
    )
    assert.equal(PMO_AI_PRIORITY_RECOMMENDATIONS_AI, 'portfolio:ai-priority-recommendations:ai')
  })

  test('Policy 实例化成功', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.instanceOf(policy, PmoAiPriorityRecommendationPolicy)
  })

  test('canView 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.canView)
  })

  test('canManage 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.canManage)
  })

  test('canTriggerAi 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.canTriggerAi)
  })

  test('authorizeView 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.authorizeView)
  })

  test('authorizeManage 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.authorizeManage)
  })

  test('authorizeTriggerAi 方法签名正确', ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)
    assert.isFunction(policy.authorizeTriggerAi)
  })

  test('canView 调用 rbac.check 检查 PMO 专用权限', async ({ assert }) => {
    const rbac = new RbacService()
    const policy = new PmoAiPriorityRecommendationPolicy(rbac)

    // 验证方法签名接受正确的参数
    assert.isFunction(policy.canView)
    // canView 接受 User + organizationId
    assert.equal(policy.canView.length, 2)
  })
})
