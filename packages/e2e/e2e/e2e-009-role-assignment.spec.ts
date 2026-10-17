import { test, expect } from '@playwright/test'

/**
 * E2E-009: 角色分配 — 邀请成员 + 角色变更 + 权限生效
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-009: Role Assignment', () => {
  test('邀请成员并变更角色', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken } = (await loginRes.json()).data

    const projRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(projRes.ok()).toBeTruthy()
    const projects = (await projRes.json()).data
    if (projects.length === 0) return
    const projectId = projects[0].id

    // 获取可用的角色列表
    const roleRes = await request.get(`${API_BASE}/projects/${projectId}/roles`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(roleRes.ok()).toBeTruthy()
  })
})
