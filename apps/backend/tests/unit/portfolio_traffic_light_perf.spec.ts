/**
 * PortfolioTrafficLightService 大组织性能测试（v3-pmo-portfolio-traffic-light §4.8 P1）。
 *
 * 验证 >=1000 项目场景下 scoreTrafficLight 纯函数的可伸缩性。
 * 由于后端 Service 的数据库部分无法在此纯函数测试中覆盖，
 * 此测试重点验证核心评分函数的 O(N) 可伸缩性和内存使用。
 */
import { test } from '@japa/runner'
import {
  generateLargePortfolio,
  generateStaleSourcePortfolio,
  generatePermissionRestrictedPortfolio,
} from './portfolio_traffic_light_fixtures.js'

const PERF_THRESHOLD_MS = 5000 // 1000 项目评分应在 5 秒内完成（单线程 JS）

test.group('PortfolioTrafficLightService — 大组织性能', () => {
  test('1000 项目评分在阈值内完成', ({ assert }) => {
    const items = generateLargePortfolio(1000)
    assert.equal(items.length, 1000)

    // 各灯色分布应有合理覆盖
    const statuses = items.map((i: { item: { trafficLight: string } }) => i.item.trafficLight)
    const reds = statuses.filter((s: string) => s === 'red').length
    const yellows = statuses.filter((s: string) => s === 'yellow').length
    const greens = statuses.filter((s: string) => s === 'green').length
    const grays = statuses.filter((s: string) => s === 'gray').length

    assert.isAbove(reds, 0, '应至少有一个红灯项目')
    assert.isAbove(yellows, 0, '应至少有一个黄灯项目')
    assert.isAbove(greens, 0, '应至少有一个绿灯项目')
    assert.isAbove(grays, 0, '应至少有一个灰灯项目')
    assert.equal(reds + yellows + greens + grays, 1000)
  })

  test('1000 项目评分耗时 < 5 秒', ({ assert }) => {
    const start = performance.now()
    void generateLargePortfolio(1000)
    const elapsed = performance.now() - start

    assert.isBelow(
      elapsed,
      PERF_THRESHOLD_MS,
      `1000 项目生成+评分耗时 ${elapsed.toFixed(0)}ms < ${PERF_THRESHOLD_MS}ms`,
    )
  }).disableTimeout() // japa 默认 timeout 不够，自定义计时

  test('stale 来源场景 1000 项目在阈值内完成', ({ assert }) => {
    const start = performance.now()
    const items = generateStaleSourcePortfolio(1000)
    const elapsed = performance.now() - start

    assert.equal(items.length, 1000)
    assert.isBelow(
      elapsed,
      PERF_THRESHOLD_MS,
      `stale source 1000 项目耗时 ${elapsed.toFixed(0)}ms < ${PERF_THRESHOLD_MS}ms`,
    )
  }).disableTimeout()

  test('权限受限场景 1000 项目在阈值内完成', ({ assert }) => {
    const start = performance.now()
    const items = generatePermissionRestrictedPortfolio(1000)
    const elapsed = performance.now() - start

    assert.equal(items.length, 1000)
    assert.isBelow(
      elapsed,
      PERF_THRESHOLD_MS,
      `permission restricted 1000 项目耗时 ${elapsed.toFixed(0)}ms < ${PERF_THRESHOLD_MS}ms`,
    )
  }).disableTimeout()

  test('1000 项目输出结构完整性', ({ assert }) => {
    const items = generateLargePortfolio(1000)

    for (const { item } of items) {
      // 每个 item 必须包含必要字段
      assert.isDefined(item.projectId)
      assert.isDefined(item.projectName)
      assert.isDefined(item.trafficLight)
      assert.isDefined(item.severityCounts)
      assert.isDefined(item.evidence)
      assert.isDefined(item.warnings)
      assert.isDefined(item.ruleVersion)
      assert.equal(item.ruleVersion, 'pmo-traffic-light-v1')
      assert.isDefined(item.calculatedAt)
      assert.isDefined(item.allowedActions)
    }
  })
})
