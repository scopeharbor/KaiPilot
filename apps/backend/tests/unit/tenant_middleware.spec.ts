// v3-multitenant-isolation-architecture §3.6/3.7 —— tenant_middleware 路由解析单测。
// 覆盖：`:projectId` 命名参数优先；`/projects/:id` 形态路由用 `:id`；
// 其它资源 `:id` 不误标；无项目形态与非法数字回退 null（不抛错）。
import { test } from '@japa/runner'
import { resolveTenantProjectId } from '#middleware/tenant_middleware'

function makeCtx(
  params: Record<string, unknown>,
  pattern: string | null = null,
): Parameters<typeof resolveTenantProjectId>[0] {
  return {
    params,
    route: pattern === null ? null : { pattern },
  } as Parameters<typeof resolveTenantProjectId>[0]
}

test.group('resolveTenantProjectId（项目级路由解析，§3.6）', () => {
  test(':projectId 命名参数优先解析', ({ assert }) => {
    assert.equal(resolveTenantProjectId(makeCtx({ projectId: '5' })), 5)
  })

  test('/projects/:id 形态路由用 :id 解析（数值转换）', ({ assert }) => {
    assert.equal(resolveTenantProjectId(makeCtx({ id: '9' }, '/api/v1/projects/:id/tasks')), 9)
  })

  test('其它资源的 :id 路由不误标为项目 scope', ({ assert }) => {
    assert.isNull(resolveTenantProjectId(makeCtx({ id: '9' }, '/api/v1/tasks/:id')))
  })

  test('无 /projects/:id 形态且无 projectId → null', ({ assert }) => {
    assert.isNull(resolveTenantProjectId(makeCtx({}, '/api/v1/orgs/:id')))
    assert.isNull(resolveTenantProjectId(makeCtx({})))
  })

  test('非法数字参数 → null（不抛错、不注入脏 scope）', ({ assert }) => {
    assert.isNull(resolveTenantProjectId(makeCtx({ projectId: 'abc' })))
    assert.isNull(resolveTenantProjectId(makeCtx({ id: 'abc' }, '/api/v1/projects/:id')))
  })
})
