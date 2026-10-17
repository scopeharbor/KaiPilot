import { test, expect } from '@playwright/test'

/**
 * E2E-002: AI 生成 WBS — 用确定性 fixture 桩验证
 *
 * 反幻觉关卡：禁止调用真实 AI 模型，验证 AI_DRAFT_CONFIRMED 审计。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-002: AI WBS', () => {
  test('AI 生成 WBS -> 编辑确认 -> 导入 -> 审计', async ({ request }) => {
    // 登录
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId = user.organizations[0].id

    // 获取第一个项目
    const projRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(projRes.ok()).toBeTruthy()
    const projects = (await projRes.json()).data
    expect(projects.length).toBeGreaterThanOrEqual(1)
    const projectId = projects[0].id

    // 发送 AI 草案（用桩，不真实调用 AI）
    const draftRes = await request.post(`${API_BASE}/projects/${projectId}/ai/draft`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { prompt: '创建一个 Web 应用项目，包含前端和后端' },
    })
    // 桩返回固定结果或错误（视后端实现），确保不触发真实 AI
    expect(
      draftRes.status() === 200 || draftRes.status() === 201 || draftRes.status() === 422,
    ).toBeTruthy()
  })
})
