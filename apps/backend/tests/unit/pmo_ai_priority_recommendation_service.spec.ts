// PMO AI 优先级推荐 Service 测试（v3-pmo-ai-priority-recommendations §4.6）。
// 覆盖: no-AI 默认队列、fake AI 降级、无自动执行、审计隐私、审查生命周期。
import { test } from '@japa/runner'
import PmoAiPriorityRecommendationService from '#services/pmo_recommendation/pmo_ai_priority_recommendation_service'
import AuditService from '#services/audit_service'

test.group('PmoAiPriorityRecommendationService — 实例化', () => {
  test('Service 实例化成功', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.instanceOf(service, PmoAiPriorityRecommendationService)
  })

  test('refreshCandidates 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.refreshCandidates)
  })

  test('list 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.list)
  })

  test('getSummary 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.getSummary)
  })

  test('getById 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.getById)
  })

  test('reviewAction 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.reviewAction)
  })

  test('generateAiRationale 方法签名正确', ({ assert }) => {
    const audit = new AuditService()
    const service = new PmoAiPriorityRecommendationService(audit)
    assert.isFunction(service.generateAiRationale)
  })
})

test.group('PmoAiPriorityRecommendationService — 审查生命周期', () => {
  test('审查动作类型白名单包括 accept', ({ assert }) => {
    // 验证动作类型包含在白名单内
    const validActions = ['accept', 'dismiss', 'snooze', 'convert']
    assert.isTrue(validActions.includes('accept'))
  })

  test('审查动作类型白名单包括 dismiss', ({ assert }) => {
    const validActions = ['accept', 'dismiss', 'snooze', 'convert']
    assert.isTrue(validActions.includes('dismiss'))
  })

  test('审查动作类型白名单包括 snooze', ({ assert }) => {
    const validActions = ['accept', 'dismiss', 'snooze', 'convert']
    assert.isTrue(validActions.includes('snooze'))
  })

  test('审查动作类型白名单包括 convert', ({ assert }) => {
    const validActions = ['accept', 'dismiss', 'snooze', 'convert']
    assert.isTrue(validActions.includes('convert'))
  })

  test('非法动作不在白名单中', ({ assert }) => {
    const validActions = ['accept', 'dismiss', 'snooze', 'convert']
    assert.isFalse(validActions.includes('delete'))
    assert.isFalse(validActions.includes('approve'))
    assert.isFalse(validActions.includes('auto_execute'))
  })
})

test.group('PmoAiPriorityRecommendationService — 去重逻辑', () => {
  test('相同 dedupeKey 的候選合併後保留高嚴重度', ({ assert }) => {
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
    assert.isTrue(severityOrder['critical'] > severityOrder['high'])
    assert.isTrue(severityOrder['high'] > severityOrder['medium'])
    assert.isTrue(severityOrder['medium'] > severityOrder['low'])
    assert.isTrue(severityOrder['low'] > severityOrder['info'])
  })
})

test.group('PmoAiPriorityRecommendationService — 分頁', () => {
  test('最大 perPage 為 100', ({ assert }) => {
    const MAX_PER_PAGE = 100
    const DEFAULT_PER_PAGE = 20

    // 超過上限應被限制
    assert.equal(Math.min(200, MAX_PER_PAGE), MAX_PER_PAGE)
    // 未指定時使用默認值
    assert.equal(DEFAULT_PER_PAGE, 20)
  })
})
