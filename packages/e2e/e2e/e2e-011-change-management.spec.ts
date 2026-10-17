import { test, expect } from '@playwright/test'

/**
 * E2E-011: 变更管理 — 变更请求 + 审批 + 基线对比 + 审计
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-011: Change Management', () => {
  test('获取变更请求列表', async ({ request }) => {
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

    // 获取变更请求
    const crRes = await request.get(`${API_BASE}/projects/${projectId}/change-requests`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(crRes.ok()).toBeTruthy()
  })
})
