/**
 * v2-5-provider-incoming-webhook-foundation —— webhook 审计事件与动词映射单元测试（task 6.2）。
 *
 * 断言：新增的 WEBHOOK_ENDPOINT_* / WEBHOOK_DELIVERY_* 事件全部注册到 AuditEvent 与
 * EVENT_TO_ACTION，并映射到 audit_logs.action CHECK 约束允许的既有动词（create/update/
 * read/reject…），不改 schema。管理写操作触发 strict 审计在 functional 测试中覆盖。
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

test.group('Webhook audit events — registration & action mapping', () => {
  const WEBHOOK_EVENTS = [
    AuditEvent.WEBHOOK_ENDPOINT_CREATED,
    AuditEvent.WEBHOOK_ENDPOINT_UPDATED,
    AuditEvent.WEBHOOK_ENDPOINT_ENABLED,
    AuditEvent.WEBHOOK_ENDPOINT_DISABLED,
    AuditEvent.WEBHOOK_ENDPOINT_SECRET_ROTATED,
    AuditEvent.WEBHOOK_DELIVERY_ACCEPTED,
    AuditEvent.WEBHOOK_DELIVERY_REJECTED,
    AuditEvent.WEBHOOK_DELIVERY_DUPLICATE,
  ]

  test('every webhook event is registered in AuditEvent', ({ assert }) => {
    for (const evt of WEBHOOK_EVENTS) {
      assert.isString(evt)
      assert.isTrue(evt.startsWith('WEBHOOK_'))
    }
  })

  test('every webhook event maps to an allowed action verb (no schema change)', ({ assert }) => {
    for (const evt of WEBHOOK_EVENTS) {
      assert.property(EVENT_TO_ACTION, evt, `事件 ${evt} 必须映射到 action 动词`)
      const action = EVENT_TO_ACTION[evt]
      assert.isTrue(
        ALLOWED_ACTIONS.has(action),
        `动词 ${action} 不在 audit_logs.action CHECK 枚举内`,
      )
    }
  })

  test('specific mappings match design D8', ({ assert }) => {
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_ENDPOINT_CREATED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_ENDPOINT_UPDATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_ENDPOINT_ENABLED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_ENDPOINT_DISABLED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_ENDPOINT_SECRET_ROTATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_DELIVERY_ACCEPTED], 'read')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_DELIVERY_REJECTED], 'reject')
    assert.equal(EVENT_TO_ACTION[AuditEvent.WEBHOOK_DELIVERY_DUPLICATE], 'read')
  })

  test('AuditService exposes webhook events as typed members', ({ assert }) => {
    assert.equal(AuditEvent.WEBHOOK_ENDPOINT_CREATED, 'WEBHOOK_ENDPOINT_CREATED')
    assert.equal(AuditEvent.WEBHOOK_DELIVERY_DUPLICATE, 'WEBHOOK_DELIVERY_DUPLICATE')
  })
})
