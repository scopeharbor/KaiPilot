/**
 * CostAttributionService 单元测试（§4 成本归属）。
 *
 * 覆盖：
 * - 影子成本单独归属，不混入生产成本
 * - 影子成本受配额约束
 * - 调用翻倍在账本中可见
 * - 成本看板中影子与生产可区分
 */

import { test } from '@japa/runner'
import { CostAttributionService } from '../../../app/services/ai-experiment/cost_attribution_service.js'
import { createShadowExperimentFixture } from '@aiproj/types'

test.group('CostAttributionService', (group) => {
  let service: CostAttributionService

  group.each.setup(() => {
    service = new CostAttributionService()
  })

  test('should record production cost', ({ assert }) => {
    const entry = service.recordProductionCost('exp-1', 1, 0.05)

    assert.equal(entry.scope, 'production')
    assert.equal(entry.costUsd, 0.05)
    assert.equal(entry.experimentId, 'exp-1')
  })

  test('should record shadow cost separately', ({ assert }) => {
    const entry = service.recordShadowCost('exp-1', 1, 0.03)

    assert.equal(entry.scope, 'shadow')
    assert.equal(entry.costUsd, 0.03)
  })

  test('should keep shadow and production costs distinguishable', ({ assert }) => {
    service.recordProductionCost('exp-1', 1, 0.1)
    service.recordProductionCost('exp-1', 1, 0.2)
    service.recordShadowCost('exp-1', 1, 0.05)
    service.recordShadowCost('exp-1', 1, 0.03)

    const summary = service.getSummary('exp-1')

    assert.equal(summary.productionCostUsd, 0.3)
    assert.equal(summary.shadowCostUsd, 0.08)
    assert.equal(summary.totalCostUsd, 0.38)
  })

  test('shadow budget exhaustion should not affect production', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-budget', 1, 1)
    config.shadowBudgetCapUsd = 0.1

    // 记录影子成本
    service.recordShadowCost('exp-budget', 1, 0.05)
    service.recordShadowCost('exp-budget', 1, 0.06)

    const check = service.checkShadowBudget(config)
    assert.isTrue(check.exceeded)

    // 生产成本不受影响
    service.recordProductionCost('exp-budget', 1, 1.0)
    const summary = service.getSummary('exp-budget')
    assert.equal(summary.productionCostUsd, 1.0)
  })

  test('should show doubled invocations in ledger', ({ assert }) => {
    // 模拟影子造成的调用翻倍
    for (let i = 0; i < 10; i++) {
      service.recordProductionCost('exp-double', 1, 0.01)
      service.recordShadowCost('exp-double', 1, 0.005)
    }

    const summary = service.getSummary('exp-double')

    assert.equal(summary.productionInvocationCount, 10)
    assert.equal(summary.shadowInvocationCount, 10)
    // 总调用次数是生产的两倍
    assert.equal(summary.productionInvocationCount + summary.shadowInvocationCount, 20)
  })

  test('should provide cost dashboard with per-experiment breakdown', ({ assert }) => {
    service.recordProductionCost('exp-a', 1, 0.1)
    service.recordShadowCost('exp-a', 1, 0.02)
    service.recordProductionCost('exp-b', 1, 0.2)
    service.recordShadowCost('exp-b', 1, 0.04)

    const dashboard = service.getCostDashboard(1)

    assert.isTrue(dashboard.byExperiment.has('exp-a'))
    assert.isTrue(dashboard.byExperiment.has('exp-b'))

    const expA = dashboard.byExperiment.get('exp-a')!
    assert.equal(expA.productionCostUsd, 0.1)
    assert.equal(expA.shadowCostUsd, 0.02)

    assert.equal(dashboard.total.productionCostUsd, 0.3)
    assert.equal(dashboard.total.shadowCostUsd, 0.06)
  })

  test('should isolate costs by organization', ({ assert }) => {
    service.recordProductionCost('exp-1', 1, 0.1)
    service.recordShadowCost('exp-1', 1, 0.02)
    service.recordProductionCost('exp-2', 2, 0.3)

    const org1 = service.getOrganizationSummary(1)
    assert.equal(org1.productionCostUsd, 0.1)
    assert.equal(org1.shadowCostUsd, 0.02)

    const org2 = service.getOrganizationSummary(2)
    assert.equal(org2.productionCostUsd, 0.3)
    assert.equal(org2.shadowCostUsd, 0)
  })

  test('should handle unlimited shadow budget', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-unlimited', 1, 1)
    // 显式移除预算上限，表示无限制
    config.shadowBudgetCapUsd = undefined

    service.recordShadowCost('exp-unlimited', 1, 1000)

    const check = service.checkShadowBudget(config)
    assert.isFalse(check.exceeded)
    assert.equal(check.capUsd, Infinity)
  })
})
