import { test, expect } from '@playwright/test'

/**
 * E2E-004: 成员协作
 *
 * 成员进度 / 评论 / 附件 / 通知 / 报表
 * 既有 comments.spec.ts 登记到此流程。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-004: Collaboration', () => {
  test('获取项目成员列表', async ({ request }) => {
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

    // 获取成员
    const memberRes = await request.get(`${API_BASE}/projects/${projectId}/members`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(memberRes.ok()).toBeTruthy()
  })

  test('获取项目报表', async ({ request }) => {
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

    // 获取报表
    const reportRes = await request.get(`${API_BASE}/projects/${projectId}/reports`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(reportRes.ok()).toBeTruthy()
  })
})
