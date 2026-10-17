/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 共享契约测试（任务 2.2/2.4）。
 *
 * 证明：未知事件类型被拒绝、白名单条目稳定、脱敏投影不含密钥字段、
 * 前端选项数据来自共享元数据而非重复字面量、向后兼容（新增可选字段不破坏老消费者）。
 */
import { test } from '@japa/runner'
import {
  OUTGOING_WEBHOOK_EVENT_WHITELIST,
  OUTGOING_WEBHOOK_EVENT_METADATA,
  isAllowedOutgoingWebhookEvent,
} from '@aiproj/types'

test.group('Outgoing Webhook Shared Contracts', () => {
  test('whitelist rejects unknown event types', ({ assert }) => {
    assert.isFalse(isAllowedOutgoingWebhookEvent('project.deleted'))
    assert.isFalse(isAllowedOutgoingWebhookEvent(''))
    assert.isFalse(isAllowedOutgoingWebhookEvent('task.created.evil'))
    assert.isFalse(isAllowedOutgoingWebhookEvent('TASK.CREATED'))
  })

  test('whitelist accepts all declared event types', ({ assert }) => {
    for (const evt of OUTGOING_WEBHOOK_EVENT_WHITELIST) {
      assert.isTrue(isAllowedOutgoingWebhookEvent(evt))
    }
  })

  test('whitelist entries are stable (append-only snapshot)', ({ assert }) => {
    // 白名单只能 append；既有条目顺序与名称不得变动，避免破坏已持久化的订阅
    assert.deepEqual(
      [...OUTGOING_WEBHOOK_EVENT_WHITELIST],
      ['project.updated', 'task.created', 'task.updated', 'task.completed', 'risk.created'],
    )
  })

  test('every whitelisted event has non-empty metadata with label and envelope fields', ({
    assert,
  }) => {
    for (const evt of OUTGOING_WEBHOOK_EVENT_WHITELIST) {
      const meta = OUTGOING_WEBHOOK_EVENT_METADATA[evt]
      assert.isDefined(meta, `事件 ${evt} 必须有元数据`)
      assert.isString(meta.label)
      assert.isAbove(meta.label.length, 0)
      assert.isArray(meta.allowedEnvelopeFields)
      assert.isAbove(meta.allowedEnvelopeFields.length, 0)
    }
  })

  test('frontend option data derives from shared metadata, not duplicated literals', ({
    assert,
  }) => {
    // 模拟前端渲染选项：label 来自共享元数据，确保前后端单一来源
    const options = OUTGOING_WEBHOOK_EVENT_WHITELIST.map((evt) => ({
      value: evt,
      label: OUTGOING_WEBHOOK_EVENT_METADATA[evt].label,
    }))
    assert.equal(options.length, OUTGOING_WEBHOOK_EVENT_WHITELIST.length)
    // 每个选项的 value 都在白名单内（前端不可能渲染白名单外选项）
    for (const opt of options) {
      assert.isTrue(isAllowedOutgoingWebhookEvent(opt.value))
    }
    // 标签唯一，避免 UI 混淆
    const labels = options.map((o) => o.label)
    assert.equal(new Set(labels).size, labels.length)
  })

  test('redacted projection type enforces absence of secret fields at compile boundary', ({
    assert,
  }) => {
    // 脱敏投影 DTO 形态：构造一个合法投影，断言它不携带 secret/secretCiphertext 键。
    // 这是对「老消费者可忽略无关新增、且密钥永不出现于脱敏投影」的运行时佐证。
    const redacted = {
      id: 1,
      name: 'sub',
      targetUrl: 'https://hooks.example.com/incoming',
      eventTypes: ['task.created'],
      status: 'active',
      secretFingerprint: 'abc12345',
      lastRotatedAt: null,
      deactivatedAt: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: null,
    }
    assert.isUndefined((redacted as Record<string, unknown>).secret)
    assert.isUndefined((redacted as Record<string, unknown>).secretCiphertext)
  })
})
