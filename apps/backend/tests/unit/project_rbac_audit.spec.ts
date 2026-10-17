import { AuditEvent, EVENT_TO_ACTION } from '#services/audit_service'
import {
  PROJECT_CREATE,
  PROJECT_DELETE,
  PROJECT_MEMBER_MANAGE,
  PROJECT_UPDATE,
  PROJECT_VIEW,
  ROUTE_PERMISSION_RULES,
} from '#rbac'
import { test } from '@japa/runner'

/**
 * 任务 2.3 — 路由规则与审计事件映射单测。
 */
test.group('项目域路由规则与审计事件映射', () => {
  test('projects 相关路由规则命中正确权限', ({ assert }) => {
    const find = (routeName: string, method: string) =>
      ROUTE_PERMISSION_RULES.find(
        (r) => r.method === method && (r.routeName === routeName || r.routePattern === routeName),
      )

    assert.equal(find('projects.store', 'POST')?.permission, PROJECT_CREATE)
    assert.equal(find('projects.index', 'GET')?.permission, PROJECT_VIEW)
    assert.equal(find('projects.show', 'GET')?.permission, PROJECT_VIEW)
    assert.equal(find('projects.update', 'PATCH')?.permission, PROJECT_UPDATE)
    assert.equal(find('projects.destroy', 'DELETE')?.permission, PROJECT_DELETE)

    assert.equal(find('projects.members.index', 'GET')?.permission, PROJECT_VIEW)
    assert.equal(find('projects.members.store', 'POST')?.permission, PROJECT_MEMBER_MANAGE)
    assert.equal(find('projects.members.invite', 'POST')?.permission, PROJECT_MEMBER_MANAGE)
    assert.equal(find('projects.members.update', 'PATCH')?.permission, PROJECT_MEMBER_MANAGE)
    assert.equal(find('projects.members.destroy', 'DELETE')?.permission, PROJECT_MEMBER_MANAGE)

    assert.equal(find('projects.roles.index', 'GET')?.permission, PROJECT_VIEW)
    assert.equal(find('projects.transfer', 'POST')?.permission, PROJECT_MEMBER_MANAGE)
    assert.equal(find('projects.archive', 'POST')?.permission, PROJECT_UPDATE)
    assert.equal(find('projects.restore', 'POST')?.permission, PROJECT_UPDATE)
    assert.equal(find('projects.dashboard', 'GET')?.permission, PROJECT_VIEW)
  })

  test('项目审计事件映射到正确 action 动词', ({ assert }) => {
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_CREATED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_UPDATED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_DELETED], 'delete')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_ARCHIVED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_RESTORED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_MEMBER_ADDED], 'create')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_MEMBER_ROLE_CHANGED], 'update')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_MEMBER_REMOVED], 'delete')
    assert.equal(EVENT_TO_ACTION[AuditEvent.PROJECT_OWNER_TRANSFERRED], 'update')
  })
})
