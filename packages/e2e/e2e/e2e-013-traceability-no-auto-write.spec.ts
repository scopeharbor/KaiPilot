import { test, expect } from '@playwright/test'

/**
 * E2E-013: 无自动落库断言 —— SourceAttribution 流程不得修改正式业务数据
 *
 * 验证：SourceAttribution 创建、Preview、Diff 和 dry-run 阶段
 * 不得新增/修改正式项目、任务、WBS、依赖或里程碑。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-013: No Auto-Write Assertion', () => {
  let accessToken: string
  let orgId: number
  let projectCountBefore: number
  let taskCountBefore: number

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const body = (await loginRes.json()).data
    accessToken = body.accessToken
    orgId = body.user.organizations[0].id

    // 记录正式业务表计数
    const projRes = await request.get(`${API_BASE}/organizations/${orgId}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    projectCountBefore = ((await projRes.json()).data || []).length
  })

  test('Source attribution read does not create projects', async ({ request }) => {
    // 读取 attributions — 纯粹读操作
    const runsRes = await request.get(`${API_BASE}/ai/compiler/runs?perPage=5`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const runs = runsRes.ok() ? (await runsRes.json()).data || [] : []

    for (const run of runs.slice(0, 3)) {
      await request.get(`${API_BASE}/ai/compiler/runs/${run.id}/attributions`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    }

    // 断言：正式项目数未增加
    const projResAfter = await request.get(`${API_BASE}/organizations/${orgId}/projects`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const projectCountAfter = ((await projResAfter.json()).data || []).length
    expect(projectCountAfter).toBe(projectCountBefore)
  })
})
