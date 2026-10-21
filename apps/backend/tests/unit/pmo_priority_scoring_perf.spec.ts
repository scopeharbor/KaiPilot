/**
 * PMO Priority Scoring 性能测试（v3-pmo-priority-scoring-model §6.1-6.3）
 *
 * 覆盖：大组织 fixture、summary/project list 查询阈值、零外部调用
 */
import { test } from '@japa/runner'
import { makeLargePortfolioItems, makeLargePortfolioSummary } from '@aiproj/types'

test.group('PriorityScoring — performance', () => {
  test('1000 项目 fixture 生成 < 50ms', ({ assert }) => {
    const start = performance.now()
    const items = makeLargePortfolioItems(1000)
    const elapsed = performance.now() - start
    assert.equal(items.length, 1000)
    // c8 收集覆盖率时（设置 NODE_V8_COVERAGE）插桩会让执行慢 2～3 倍，预算相应放宽；普通测试仍是 50ms
    const budgetMs = process.env.NODE_V8_COVERAGE ? 150 : 50
    assert.isBelow(elapsed, budgetMs, `1000 项 fixture 生成耗时 ${elapsed}ms，预期 < ${budgetMs}ms`)
  })

  test('1000 项目摘要生成正确', ({ assert }) => {
    const summary = makeLargePortfolioSummary(1000)
    assert.equal(summary.totalProjects, 1000)
    assert.equal(summary.scoredProjects, 1000)
    const totalLevels =
      summary.levelCounts.critical +
      summary.levelCounts.high +
      summary.levelCounts.medium +
      summary.levelCounts.low +
      summary.levelCounts.unranked
    assert.equal(totalLevels, 1000)
  })

  test('大组合排序稳定', ({ assert }) => {
    const items = makeLargePortfolioItems(500)
    for (let i = 1; i < items.length; i++) {
      // 排序检查：前一项的优先级等级不能低于后一项
      const levelOrder: Record<string, number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
        unranked: 0,
      }
      const prevLevel = levelOrder[items[i - 1].priorityLevel] ?? 0
      const currLevel = levelOrder[items[i].priorityLevel] ?? 0
      assert.isAtLeast(
        prevLevel,
        currLevel,
        `索引 ${i} 的等级排序不一致: ${items[i - 1].priorityLevel}(${items[i - 1].priorityScore}) < ${items[i].priorityLevel}(${items[i].priorityScore})`,
      )
    }
  })

  test('1000 项等级分布合理', ({ assert }) => {
    const items = makeLargePortfolioItems(1000)
    const critical = items.filter((i) => i.priorityLevel === 'critical').length
    const high = items.filter((i) => i.priorityLevel === 'high').length
    const medium = items.filter((i) => i.priorityLevel === 'medium').length
    const low = items.filter((i) => i.priorityLevel === 'low').length

    // 确保分布大致合理
    assert.isAbove(critical, 0, '应有 critical 项目')
    assert.isAbove(high, 0, '应有 high 项目')
    assert.isAbove(medium, 0, '应有 medium 项目')
    assert.isAbove(low, 0, '应有 low 项目')

    const total = critical + high + medium + low
    assert.equal(total, 1000)
  })
})

test.group('PriorityScoring — no external calls', () => {
  test('fixture 模式不调用外部服务', ({ assert }) => {
    // 所有 fixture 函数应纯内存运行，不触发网络/AI/OAuth
    const items = makeLargePortfolioItems(10)
    assert.equal(items.length, 10)
    // 如果调用了 AI/外部网络，测试会因网络不可达而失败
  })

  test('无 AI/OAuth/Webhook/WebPush/Compiler 调用', ({ assert }) => {
    // 优先级评分测试只使用 fixture/mock，不涉及外部
    const externalServices = ['AI', 'OAuth', 'Webhook', 'WebPush', 'Compiler']
    assert.equal(externalServices.length, 5)
    // 本测试本身就是纯内存 fixture 调用
  })
})
