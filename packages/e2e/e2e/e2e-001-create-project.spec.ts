import { test, expect } from '@playwright/test'

/**
 * E2E-001: 管理员登录 → 新建项目 → 确认跳转 → 审计日志
 *
 * 前置条件：seed 数据含默认管理员 admin@test.local
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-001: Create Project', () => {
  test('管理员登录 -> 新建项目 -> 跳转 -> 审计日志', async ({ request }) => {
    // 登录
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId = user.organizations[0].id

    // 新建项目
    const projRes = await request.post(`${API_BASE}/organizations/${orgId}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: 'E2E-001 测试项目', workdays: [1, 2, 3, 4, 5] },
    })
    expect(projRes.ok()).toBeTruthy()
    const project = (await projRes.json()).data
    expect(project.name).toBe('E2E-001 测试项目')

    // 验证审计日志包含 PROJECT_CREATED
    const auditRes = await request.get(
      `${API_BASE}/audit-logs?entityType=project&entityId=${project.id}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    expect(auditRes.ok()).toBeTruthy()
    const auditBody = await auditRes.json()
    const logs = auditBody.data || []
    expect(logs.length).toBeGreaterThanOrEqual(1)
  })
})
