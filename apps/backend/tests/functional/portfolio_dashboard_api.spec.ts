/**
 * PMO Portfolio Dashboard API 功能性测试（v3-pmo-portfolio-dashboard §3.6）。
 *
 * 覆盖：认证访问、未认证拒绝、响应 envelope 形状。
 * 注意：完整权限脱敏/跨组织/交通灯降级测试需 Policy 注册到 RBAC 后才能跑全。
 */
import { test } from '@japa/runner'
import { useAuthDatabase } from './auth/_helpers.js'

test.group('PMO Portfolio Dashboard API', (group) => {
  useAuthDatabase(group)

  test('未认证请求被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/portfolio-dashboard')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 projects 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/portfolio-dashboard/projects')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 groups 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/portfolio-dashboard/groups')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 trends 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/portfolio-dashboard/trends')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 metrics detail 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/portfolio-dashboard/metrics/total_projects')
    assert.equal(response.status(), 401)
  })
})
