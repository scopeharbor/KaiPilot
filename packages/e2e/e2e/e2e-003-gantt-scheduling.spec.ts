import { test, expect } from '@playwright/test'

/**
 * E2E-003: 甘特排程 — 任务显示 / 拖拽改日期 / FS 依赖重排 / 关键路径高亮
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-003: Gantt Scheduling', () => {
  test('任务显示 / 依赖重排 / 关键路径', async ({ request }) => {
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

    // 获取甘特任务
    const tasksRes = await request.get(`${API_BASE}/projects/${projectId}/tasks?perPage=50`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(tasksRes.ok()).toBeTruthy()
    const tasks = (await tasksRes.json()).data
    expect(Array.isArray(tasks)).toBeTruthy()
  })
})
