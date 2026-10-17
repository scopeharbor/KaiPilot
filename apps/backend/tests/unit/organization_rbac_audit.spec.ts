import { AuditEvent, EVENT_TO_ACTION } from '#services/audit_service'
import { ORG_MANAGE, ORG_MEMBER_MANAGE, ORG_VIEW, ROUTE_PERMISSION_RULES } from '#rbac'
import { test } from '@japa/runner'

/**
 * 组织域路由规则与审计事件映射单测（与 project_rbac_audit.spec.ts 对称）。
 */
test.group('组织域路由规则与审计事件映射', () => {
  test('organizations 相关路由规则命中正确权限', ({ assert }) => {
    const find = (routeName: string, method: string) =>
      ROUTE_PERMISSION_RULES.find(
        (r) => r.method === method && (r.routeName === routeName || r.routePattern === routeName),
      )

    assert.equal(find('organizations.show', 'GET')?.permission, ORG_VIEW)
    assert.equal(find('organizations.update', 'PUT')?.permission, ORG_MANAGE)
    assert.equal(find('organizations.members.invite', 'POST')?.permission, ORG_MEMBER_MANAGE)
    assert.equal(find('organizations.members.update', 'PUT')?.permission, ORG_MEMBER_MANAGE)
    assert.equal(find('organizations.members.destroy', 'DELETE')?.permission, ORG_MEMBER_MANAGE)
    assert.equal(find('organizations.transfer', 'POST')?.permission, ORG_MANAGE)
  })

  test('组织审计事件映射到正确 action 动词', ({ assert }) => {
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_CREATED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_UPDATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_DELETED], 'delete')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ORG_OWNER_TRANSFERRED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.MEMBER_INVITED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.MEMBER_REMOVED], 'delete')
    assert.equal(EVENT_TO_ACTION[AuditEvent.ROLE_CHANGED], 'update')
  })
})
