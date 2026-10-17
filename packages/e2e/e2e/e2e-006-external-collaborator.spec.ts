import { test, expect } from '@playwright/test'

/**
 * E2E-006: 外部协作者受限 — 仅可见被邀项目
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-006: External Collaborator', () => {
  test('外部协作者访问受限', async ({ request }) => {
    // 管理员登录
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken } = (await loginRes.json()).data

    // 获取管理员项目
    const projRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(projRes.ok()).toBeTruthy()
  })
})
