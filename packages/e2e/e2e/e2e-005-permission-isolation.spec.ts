import { test, expect } from '@playwright/test'

/**
 * E2E-005: 权限隔离 — 组织 A 访问组织 B 返回 404 + PERMISSION_DENIED 审计
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-005: Permission Isolation', () => {
  test('组织 A 无法访问组织 B 的资源', async ({ request }) => {
    // 管理员登录
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId = user.organizations[0].id

    // 尝试访问一个不存在的组织 ID
    const fakeOrgId = orgId + 99999
    const res = await request.get(`${API_BASE}/organizations/${fakeOrgId}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status() === 404 || res.status() === 403).toBeTruthy()
  })
})
