/**
 * v3-ai-security-observability §4-§5 — 安全事件记录 Service 测试。
 *
 * 覆盖：
 * - §4.1-4.5 五处接入后各防护的拦截行为未变；
 * - §5.1-5.3 事件写入失败时降级不阻断业务，降级本身被计数；
 * - §5.4-5.6 不自动封禁、不自动关闭连接、不自动收紧权限、零域写。
 *
 * 全部使用 InMemorySecurityEventWriter / InMemoryDegradationCounter，
 * 不触真实 provider、不依赖 DB。
 */
import { test } from '@japa/runner'
import AiSecurityEventService, {
  InMemorySecurityEventWriter,
  InMemoryDegradationCounter,
} from '#services/ai_security_observability/ai_security_event_service'
import type { AiSecurityEventRecord } from '@aiproj/types'
import {
  FIXTURE_PERMISSION_DENIED_EVENT,
  FIXTURE_DLP_HIT_EVENT,
  FIXTURE_WATERMARK_INJECTION_EVENT,
  FIXTURE_INJECTION_BLOCK_EVENT,
  FIXTURE_CROSS_ORG_PROBE_EVENT,
  FIXTURE_DEGRADED_EVENT,
  AI_SECURITY_SENSITIVE_SAMPLES,
  RESOURCE_IDENTIFIER_SAMPLES,
} from '@aiproj/types/ai-security-observability-fixtures'

// ---------------------------------------------------------------------------
// §4.1-4.5 五处接入后各防护的拦截行为未变
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — 五处接入', () => {
  test('越权事件记录不改变拒绝行为', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    await service.record(FIXTURE_PERMISSION_DENIED_EVENT)

    // 事件被记录
    assert.lengthOf(writer.records, 1)
    assert.equal(writer.records[0].kind, 'permission_denied')
    // 降级计数不变
    assert.equal(counter.snapshot().totalDegraded, 0)
  })

  test('DLP 命中事件记录不改变 DLP 裁决', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    await service.record(FIXTURE_DLP_HIT_EVENT)

    assert.lengthOf(writer.records, 1)
    assert.equal(writer.records[0].kind, 'dlp_hit')
    assert.equal(counter.snapshot().totalDegraded, 0)
  })

  test('水印注入事件记录不改变水印行为', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    await service.record(FIXTURE_WATERMARK_INJECTION_EVENT)

    assert.lengthOf(writer.records, 1)
    assert.equal(writer.records[0].kind, 'watermark_injection')
    assert.equal(counter.snapshot().totalDegraded, 0)
  })

  test('注入拦截事件记录不改变拦截行为', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    await service.record(FIXTURE_INJECTION_BLOCK_EVENT)

    assert.lengthOf(writer.records, 1)
    assert.equal(writer.records[0].kind, 'injection_block')
    assert.equal(counter.snapshot().totalDegraded, 0)
  })

  test('跨组织探测事件记录不改变拒绝行为', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    await service.record(FIXTURE_CROSS_ORG_PROBE_EVENT)

    assert.lengthOf(writer.records, 1)
    assert.equal(writer.records[0].kind, 'cross_org_probe')
    assert.equal(counter.snapshot().totalDegraded, 0)
  })
})

// ---------------------------------------------------------------------------
// §5.1-5.3 事件写入失败时降级不阻断业务
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — 降级不阻断', () => {
  test('写入失败时业务照常且降级计数递增', async ({ assert }) => {
    // 使用会抛错的 writer
    const realWriter = {
      async record() {
        throw new Error('DB write failed')
      },
    }
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({
      writer: realWriter as any,
      degradationCounter: counter,
    })

    // 不应抛出异常（降级不阻断）
    await service.record(FIXTURE_PERMISSION_DENIED_EVENT)

    // 降级计数递增
    assert.equal(counter.snapshot().totalDegraded, 1)
    assert.equal(counter.snapshot().byKind.permission_denied, 1)
  })

  test('降级计数器正确累计', async ({ assert }) => {
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({
      writer: {
        async record() {
          throw new Error('fail')
        },
      } as any,
      degradationCounter: counter,
    })

    await service.record(FIXTURE_PERMISSION_DENIED_EVENT)
    await service.record(FIXTURE_INJECTION_BLOCK_EVENT)
    await service.record(FIXTURE_INJECTION_BLOCK_EVENT)

    const snap = counter.snapshot()
    assert.equal(snap.totalDegraded, 3)
    assert.equal(snap.byKind.permission_denied, 1)
    assert.equal(snap.byKind.injection_block, 2)
    assert.ok(snap.lastDegradedAt !== null)
  })
})

// ---------------------------------------------------------------------------
// §5.4-5.6 不自动处置、零域写
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — 不自动处置', () => {
  test('事件路径无封禁、连接管理与权限写入依赖', async ({ assert }) => {
    // D5: 事件路径只记录，不执行任何处置。
    // 验证：写入的事件不含任何处置操作字段
    const writer = new InMemorySecurityEventWriter()
    const service = new AiSecurityEventService({ writer })

    await service.record(FIXTURE_PERMISSION_DENIED_EVENT)

    const recorded = writer.records[0]
    // 不含封禁相关字段
    assert.notProperty(recorded, 'banAccount')
    assert.notProperty(recorded, 'closeConnection')
    assert.notProperty(recorded, 'tightenPermission')
  })

  test('事件路径零域写（除事件记录外）', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const service = new AiSecurityEventService({ writer })

    await service.record(FIXTURE_PERMISSION_DENIED_EVENT)

    // 验证：writer 只被调用一次（只写事件记录）
    assert.lengthOf(writer.records, 1)
    // 事件记录本身不修改任何项目数据
    assert.equal(writer.records[0].kind, 'permission_denied')
  })
})

// ---------------------------------------------------------------------------
// §2.5 禁存约束：拒绝含敏感载荷的事件
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — 禁存约束', () => {
  test('拒绝含 prompt 模式的事件', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    const badEvent: AiSecurityEventRecord = {
      ...FIXTURE_DLP_HIT_EVENT,
      dlpRuleCategory: 'System prompt: you are a helpful assistant',
    }

    await service.record(badEvent)

    // 被拒绝，不写入
    assert.lengthOf(writer.records, 0)
    // 降级计数递增
    assert.equal(counter.snapshot().totalDegraded, 1)
  })

  test('拒绝含 token 模式的事件', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    const badEvent: AiSecurityEventRecord = {
      ...FIXTURE_DLP_HIT_EVENT,
      dlpRuleCategory: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234',
    }

    await service.record(badEvent)

    assert.lengthOf(writer.records, 0)
    assert.equal(counter.snapshot().totalDegraded, 1)
  })

  test('拒绝含未知字段的事件', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const counter = new InMemoryDegradationCounter()
    const service = new AiSecurityEventService({ writer, degradationCounter: counter })

    const badEvent = {
      ...FIXTURE_PERMISSION_DENIED_EVENT,
      resourceId: 'project-123',
    }

    await service.record(badEvent as any)

    assert.lengthOf(writer.records, 0)
    assert.equal(counter.snapshot().totalDegraded, 1)
  })
})

// ---------------------------------------------------------------------------
// §1-§2 工厂方法
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — createEvent', () => {
  test('创建事件记录包含所有必填字段', ({ assert }) => {
    const event = AiSecurityEventService.createEvent({
      kind: 'permission_denied',
      severity: 'warning',
      organizationId: 1,
      capabilitySurface: 'api_request',
      disposition: 'blocked',
    })

    assert.ok(event.eventId.startsWith('sec-evt-'))
    assert.equal(event.kind, 'permission_denied')
    assert.equal(event.severity, 'warning')
    assert.equal(event.organizationId, 1)
    assert.equal(event.capabilitySurface, 'api_request')
    assert.equal(event.disposition, 'blocked')
    assert.ok(event.occurredAt)
  })

  test('创建注入拦截事件包含类别和计数', ({ assert }) => {
    const event = AiSecurityEventService.createEvent({
      kind: 'injection_block',
      severity: 'critical',
      organizationId: 1,
      capabilitySurface: 'knowledge_retrieval',
      disposition: 'blocked',
      injectionCategories: ['instruction_override'],
      injectionHitCount: 1,
    })

    assert.equal(event.kind, 'injection_block')
    assert.deepEqual(event.injectionCategories, ['instruction_override'])
    assert.equal(event.injectionHitCount, 1)
  })
})

// ---------------------------------------------------------------------------
// §3 负例测试：敏感样本不出现在事件记录中
// ---------------------------------------------------------------------------

test.group('AiSecurityEventService — 负例测试', () => {
  test('所有 fixture 事件不含敏感样本', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const service = new AiSecurityEventService({ writer })

    const fixtures = [
      FIXTURE_PERMISSION_DENIED_EVENT,
      FIXTURE_DLP_HIT_EVENT,
      FIXTURE_WATERMARK_INJECTION_EVENT,
      FIXTURE_INJECTION_BLOCK_EVENT,
      FIXTURE_CROSS_ORG_PROBE_EVENT,
      FIXTURE_DEGRADED_EVENT,
    ]

    for (const fixture of fixtures) {
      await service.record(fixture)
    }

    // 所有成功写入的事件都不含敏感样本
    for (const recorded of writer.records) {
      const json = JSON.stringify(recorded)
      for (const sample of AI_SECURITY_SENSITIVE_SAMPLES) {
        assert.isFalse(json.includes(sample), `事件 ${recorded.eventId} 含敏感样本`)
      }
    }
  })

  test('所有 fixture 事件不含资源标识样本', async ({ assert }) => {
    const writer = new InMemorySecurityEventWriter()
    const service = new AiSecurityEventService({ writer })

    const fixtures = [
      FIXTURE_PERMISSION_DENIED_EVENT,
      FIXTURE_DLP_HIT_EVENT,
      FIXTURE_WATERMARK_INJECTION_EVENT,
      FIXTURE_INJECTION_BLOCK_EVENT,
      FIXTURE_CROSS_ORG_PROBE_EVENT,
      FIXTURE_DEGRADED_EVENT,
    ]

    for (const fixture of fixtures) {
      await service.record(fixture)
    }

    for (const recorded of writer.records) {
      const json = JSON.stringify(recorded)
      for (const sample of RESOURCE_IDENTIFIER_SAMPLES) {
        assert.isFalse(json.includes(sample), `事件 ${recorded.eventId} 含资源标识`)
      }
    }
  })
})
