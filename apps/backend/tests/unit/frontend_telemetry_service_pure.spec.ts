/**
 * v3-ai-quality-cost-console-deferred-p1 —— FrontendTelemetryService 纯逻辑补测（Japa，无 DB）。
 *
 * 覆盖 c8 缺口：getAggregationQuery、computeDeterministicAggregation 的同时间戳
 * tie-break 分支（sessionId/eventKind 字典序），支撑服务行覆盖 ≥90%。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import { createFrontendTelemetryService } from '#services/frontend_telemetry_service'

test.group('FrontendTelemetryService 纯逻辑补测', () => {
  test('setAggregationQuery/getAggregationQuery 往返一致，eventKind 缺省为空串', ({ assert }) => {
    const service = createFrontendTelemetryService()

    const initial = service.getAggregationQuery()
    assert.equal(initial.organizationId, '')
    assert.equal(initial.eventKind, '')

    service.setAggregationQuery({ organizationId: '42', start: 'a', end: 'b' })
    const after = service.getAggregationQuery()
    assert.equal(after.organizationId, '42')
    assert.equal(after.eventKind, '')
    assert.equal(after.start, 'a')
    assert.equal(after.end, 'b')

    service.setAggregationQuery({
      organizationId: '7',
      eventKind: 'panel_open',
      start: 'c',
      end: 'd',
    })
    assert.equal(service.getAggregationQuery().eventKind, 'panel_open')
  })

  test('确定性聚合：同时间戳同会话不同事件种类按字典序 tie-break，结果与输入顺序无关', ({
    assert,
  }) => {
    const service = createFrontendTelemetryService()
    const ts = '2026-08-01T00:00:00.000Z'

    const eventsA = [
      { eventKind: 'panel_open', sessionId: 's2', timestamp: ts },
      { eventKind: 'panel_open', sessionId: 's1', timestamp: ts },
      { eventKind: 'chip_click', sessionId: 's1', timestamp: ts, chipId: 'c1' },
    ]
    const eventsB = [...eventsA].reverse()

    const aggA = service.computeDeterministicAggregation(eventsA)
    const aggB = service.computeDeterministicAggregation(eventsB)
    assert.deepEqual(aggA, aggB)
    assert.equal(aggA.openRate, 1)
    assert.equal(aggA.chipClickDistribution['c1'], 1)
  })

  test('确定性聚合：空事件列表各指标为零值且分布为全零', ({ assert }) => {
    const service = createFrontendTelemetryService()
    const agg = service.computeDeterministicAggregation([])

    assert.equal(agg.openRate, 0)
    assert.equal(agg.sessionLength, 0)
    assert.equal(agg.abandonmentRate, 0)
    assert.equal(agg.firstQuestionDistribution.query, 0)
    assert.deepEqual(agg.chipClickDistribution, {})
  })

  test('无 sessionId 的事件被聚合跳过', ({ assert }) => {
    const service = createFrontendTelemetryService()
    const agg = service.computeAggregation([
      { eventKind: 'panel_open', timestamp: '2026-08-01T00:00:00.000Z' },
    ])

    assert.equal(agg.openRate, 0)
  })
})
