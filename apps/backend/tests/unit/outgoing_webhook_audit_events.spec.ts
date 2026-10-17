/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 审计事件与动词映射单元测试（task 4.6）。
 * v2-5-webhook-templates-and-stats -- 扩展：模板创建订阅审计事件（6.3/6.4 P0）。
 *
 * 断言：OUTGOING_WEBHOOK_SUBSCRIPTION_* 与 OUTGOING_WEBHOOK_TEMPLATE_* 事件全部注册到
 * AuditEvent 与 EVENT_TO_ACTION，映射到 audit_logs.action CHECK 约束允许的既有动词。
 * 管理写操作触发审计且 metadata 不含密钥明文/密文在 functional 测试中覆盖。
 */
import { test } from '@japa/runner'
import { AuditEvent, EVENT_TO_ACTION } from '#services/audit_service'

// audit_logs.action CHECK 约束允许的动词枚举（sec7）
const ALLOWED_ACTIONS = new Set([
  'create',
  'read',
  'update',
  'delete',
  'export',
  'import',
  'login',
  'logout',
  'approve',
  'reject',
  'ai_generate',
  'apply',
  'rollback',
])

test.group('Outgoing webhook audit events - registration & action mapping', () => {
  const EVENTS = [
    AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED,
    AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_UPDATED,
    AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_DEACTIVATED,
    AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_SECRET_ROTATED,
    // v2-5-webhook-templates-and-stats: 模板创建订阅
    AuditEvent.OUTGOING_WEBHOOK_TEMPLATE_APPLIED,
  ]

  test('every outgoing webhook event is registered in AuditEvent', ({ assert }) => {
    for (const evt of EVENTS) {
      assert.isString(evt)
      assert.isTrue(evt.startsWith('OUTGOING_WEBHOOK_'))
    }
  })

  test('every outgoing webhook event maps to an allowed action verb (no schema change)', ({
    assert,
  }) => {
    for (const evt of EVENTS) {
      assert.property(EVENT_TO_ACTION, evt, `事件 ${evt} 必须映射到 action 动词`)
      const action = EVENT_TO_ACTION[evt]
      assert.isTrue(
        ALLOWED_ACTIONS.has(action),
        `动词 ${action} 不在 audit_logs.action CHECK 枚举内`,
      )
    }
  })

  test('specific mappings match design D5', ({ assert }) => {
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_UPDATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_DEACTIVATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_SECRET_ROTATED], 'update')
    // v2-5-webhook-templates-and-stats: 模板创建订阅映射为 create 动词
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_TEMPLATE_APPLIED], 'create')
  })

  test('AuditService exposes outgoing webhook events as typed members', ({ assert }) => {
    assert.equal(
      AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED,
      'OUTGOING_WEBHOOK_SUBSCRIPTION_CREATED',
    )
    assert.equal(
      AuditEvent.OUTGOING_WEBHOOK_SUBSCRIPTION_SECRET_ROTATED,
      'OUTGOING_WEBHOOK_SUBSCRIPTION_SECRET_ROTATED',
    )
    // v2-5-webhook-templates-and-stats
    assert.equal(AuditEvent.OUTGOING_WEBHOOK_TEMPLATE_APPLIED, 'OUTGOING_WEBHOOK_TEMPLATE_APPLIED')
  })
})
