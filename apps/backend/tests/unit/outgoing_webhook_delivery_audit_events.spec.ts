/**
 * v2-5-outgoing-webhook-delivery-ledger -- 投递审计事件与动词映射单元测试（task 7.5）。
 *
 * 断言：OUTGOING_WEBHOOK_DELIVERY_* 事件全部注册到 AuditEvent 与 EVENT_TO_ACTION，
 * 映射到 audit_logs.action CHECK 约束允许的既有动词（create/update/apply），不改 schema。
 * 投递写操作触发审计且 metadata 不含密钥明文/签名/payload body 在 functional 测试中覆盖。
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

test.group('Outgoing webhook delivery audit events - registration & action mapping', () => {
  const EVENTS = [
    AuditEvent.OUTGOING_WEBHOOK_DELIVERY_ENQUEUED,
    AuditEvent.OUTGOING_WEBHOOK_DELIVERY_SUCCESS,
    AuditEvent.OUTGOING_WEBHOOK_DELIVERY_FAILED,
    AuditEvent.OUTGOING_WEBHOOK_DELIVERY_PAUSED,
    AuditEvent.OUTGOING_WEBHOOK_DELIVERY_MANUAL_RETRY,
  ]

  test('every delivery event is registered in AuditEvent', ({ assert }) => {
    for (const evt of EVENTS) {
      assert.isString(evt)
      assert.isTrue(evt.startsWith('OUTGOING_WEBHOOK_DELIVERY_'))
    }
  })

  test('every delivery event maps to an allowed action verb (no schema change)', ({ assert }) => {
    for (const evt of EVENTS) {
      assert.property(EVENT_TO_ACTION, evt, `事件 ${evt} 必须映射到 action 动词`)
      const action = EVENT_TO_ACTION[evt]
      assert.isTrue(
        ALLOWED_ACTIONS.has(action),
        `动词 ${action} 不在 audit_logs.action CHECK 枚举内`,
      )
    }
  })

  test('specific mappings match design D5/D6', ({ assert }) => {
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_DELIVERY_ENQUEUED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_DELIVERY_SUCCESS], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_DELIVERY_FAILED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_DELIVERY_PAUSED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.OUTGOING_WEBHOOK_DELIVERY_MANUAL_RETRY], 'apply')
  })
})
