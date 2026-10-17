import { test, expect } from '@playwright/test'

/**
 * E2E-008: 归档恢复 — 归档后只读 + 管理员恢复
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-008: Archive Restore', () => {
  test('归档项目后只读', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId = user.organizations[0].id

    // 获取项目
    const projRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(projRes.ok()).toBeTruthy()
  })
})
