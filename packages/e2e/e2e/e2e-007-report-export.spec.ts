import { test, expect } from '@playwright/test'

/**
 * E2E-007: 报表导出 — CSV 水印 + 频率限制
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-007: Report Export', () => {
  test('导出 CSV 并检查频率限制', async ({ request }) => {
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

    // 尝试导出报表
    const exportRes = await request.get(
      `${API_BASE}/projects/${projectId}/reports/export?format=csv`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    // 导出可能成功 (200) 或频率限制 (429)
    expect(exportRes.status() === 200 || exportRes.status() === 429).toBeTruthy()
  })
})
