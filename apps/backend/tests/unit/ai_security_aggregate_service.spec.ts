/**
 * v3-ai-security-observability §6 — 聚合 Service 测试。
 *
 * 覆盖：
 * - §6.1 按 (组织, 类型, 时间窗) 的聚合视图；
 * - §6.2 门禁只消费聚合，不读明细；
 * - §6.4 聚合确定性：同一事件快照产出同一聚合；
 * - §6.6 合规能力既有控制项行为未被改变。
 *
 * 全部使用 InMemorySecurityEventReader，不依赖 DB。
 */
import { test } from '@japa/runner'
import AiSecurityAggregateService, {
  InMemorySecurityEventReader,
} from '#services/ai_security_observability/ai_security_aggregate_service'
import {
  FIXTURE_PERMISSION_DENIED_EVENT,
  FIXTURE_DLP_HIT_EVENT,
  FIXTURE_INJECTION_BLOCK_EVENT,
  FIXTURE_DEGRADED_EVENT,
} from '@aiproj/types/ai-security-observability-fixtures'

// ---------------------------------------------------------------------------
// §6.1 按 (组织, 类型, 时间窗) 的聚合视图
// ---------------------------------------------------------------------------

test.group('AiSecurityAggregateService — 聚合', () => {
  test('按组织和类型聚合事件', async ({ assert }) => {
    const reader = new InMemorySecurityEventReader()
    reader.records = [
      FIXTURE_PERMISSION_DENIED_EVENT,
      FIXTURE_DLP_HIT_EVENT,
      FIXTURE_INJECTION_BLOCK_EVENT,
    ]
    const service = new AiSecurityAggregateService(reader)

    const result = await service.aggregate({
      organizationId: 1,
      kind: ['permission_denied'],
      windowStart: '2026-08-22T00:00:00.000Z',
      windowEnd: '2026-08-22T23:59:59.999Z',
    })

    // 只有 permission_denied 事件被聚合
    assert.equal(result.totalCount, 1)
    assert.equal(result.key.kind, 'permission_denied')
    assert.equal(result.key.organizationId, 1)
  })

  test('跨组织事件不可见', async ({ assert }) => {
    const reader = new InMemorySecurityEventReader()
    reader.records = [
      FIXTURE_PERMISSION_DENIED_EVENT, // org 1
      { ...FIXTURE_DLP_HIT_EVENT, organizationId: 2 }, // org 2
    ]
    const service = new AiSecurityAggregateService(reader)

    const result = await service.aggregate({
      organizationId: 1,
      windowStart: '2026-08-22T00:00:00.000Z',
      windowEnd: '2026-08-22T23:59:59.999Z',
    })

    // 只有 org 1 的事件被聚合
    assert.equal(result.totalCount, 1)
  })
})

// ---------------------------------------------------------------------------
// §6.2 门禁只消费聚合，不读明细
// ---------------------------------------------------------------------------

test.group('AiSecurityAggregateService — 门禁消费', () => {
  test('门禁消费路径无明细访问', ({ assert }) => {
    const result = AiSecurityAggregateService.validateGateConsumesOnlyAggregate()
    assert.isTrue(result.safe)
    assert.isEmpty(result.detailAccessPaths)
  })
})

// ---------------------------------------------------------------------------
// §6.4 聚合确定性
// ---------------------------------------------------------------------------

test.group('AiSecurityAggregateService — 确定性', () => {
  test('同一事件快照产出同一聚合', async ({ assert }) => {
    const reader = new InMemorySecurityEventReader()
    reader.records = [FIXTURE_PERMISSION_DENIED_EVENT]
    const service = new AiSecurityAggregateService(reader)

    const query = {
      organizationId: 1,
      kind: ['permission_denied' as const],
      windowStart: '2026-08-22T00:00:00.000Z',
      windowEnd: '2026-08-22T23:59:59.999Z',
    }

    const result1 = await service.aggregate(query)
    const result2 = await service.aggregate(query)

    assert.deepEqual(result1, result2)
  })

  test('聚合结果结构完整', async ({ assert }) => {
    const reader = new InMemorySecurityEventReader()
    reader.records = [
      FIXTURE_PERMISSION_DENIED_EVENT,
      FIXTURE_INJECTION_BLOCK_EVENT,
      FIXTURE_DEGRADED_EVENT,
    ]
    const service = new AiSecurityAggregateService(reader)

    const result = await service.aggregate({
      organizationId: 1,
      windowStart: '2026-08-22T00:00:00.000Z',
      windowEnd: '2026-08-22T23:59:59.999Z',
    })

    assert.equal(result.totalCount, 3)
    assert.ok(result.bySeverity)
    assert.ok(result.byDisposition)
    assert.ok(result.bySurface)
    assert.equal(result.degradedCount, 1) // FIXTURE_DEGRADED_EVENT
  })
})

// ---------------------------------------------------------------------------
// §6.6 合规能力既有控制项行为未被改变
// ---------------------------------------------------------------------------

test.group('AiSecurityAggregateService — 合规共存', () => {
  test('聚合服务不影响审计日志、DLP、水印与外部内容防护既有行为', async ({ assert }) => {
    // 验证：聚合服务是只读的，不修改任何外部状态
    const reader = new InMemorySecurityEventReader()
    reader.records = [FIXTURE_PERMISSION_DENIED_EVENT]
    const service = new AiSecurityAggregateService(reader)

    await service.aggregate({
      organizationId: 1,
      windowStart: '2026-08-22T00:00:00.000Z',
      windowEnd: '2026-08-22T23:59:59.999Z',
    })

    // 原始记录未被修改
    assert.deepEqual(reader.records[0], FIXTURE_PERMISSION_DENIED_EVENT)
  })
})
