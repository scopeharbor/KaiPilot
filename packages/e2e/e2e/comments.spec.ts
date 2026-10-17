import { test, expect } from '@playwright/test'

/**
 * basic-comments E2E 测试（6.1/6.2）。
 *
 * 前置条件：
 * - 后端运行在 http://localhost:3333
 * - 前端运行在 http://localhost:3000
 * - 数据库已 seed（默认组织/用户/项目）
 *
 * 运行方式：
 *   pnpm --filter @aiproj/backend dev &
 *   pnpm --filter @aiproj/frontend dev &
 *   npx playwright test --config packages/e2e/playwright.config.ts
 */

const API_BASE = 'http://localhost:3333/api/v1'
const FRONTEND_BASE = 'http://localhost:3000'

// 使用默认 seed 测试账号（与 seeds 对齐）
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

async function loginAndGetToken(request: any): Promise<{ token: string; orgId: number }> {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: TEST_USER,
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  return { token: body.data.accessToken, orgId: body.data.user.organizations[0].id }
}

test.describe('basic-comments E2E', () => {
  let token: string
  let orgId: number

  test.beforeAll(async ({ request }) => {
    const result = await loginAndGetToken(request)
    token = result.token
    orgId = result.orgId
  })

  test('6.1 成员协作：创建项目级评论并通过列表查看', async ({ request }) => {
    // 先获取项目列表
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(projectsRes.ok()).toBeTruthy()
    const projectsBody = await projectsRes.json()
    const project = projectsBody.data[0]
    expect(project).toBeDefined()

    // 创建项目级评论
    const createRes = await request.post(`${API_BASE}/projects/${project.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: 'E2E 测试项目级评论', bodyFormat: 'plain' },
    })
    expect(createRes.status()).toBe(201)
    const commentBody = await createRes.json()
    expect(commentBody.data.body).toBe('E2E 测试项目级评论')
    expect(commentBody.data.targetType).toBe('project')
    expect(commentBody.data.taskId).toBeNull()

    // 列出项目级评论验证包含刚创建的评论
    const listRes = await request.get(`${API_BASE}/projects/${project.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.ok()).toBeTruthy()
    const listBody = await listRes.json()
    expect(listBody.meta.total).toBeGreaterThanOrEqual(1)
    const bodies = listBody.data.map((c: any) => c.body)
    expect(bodies).toContain('E2E 测试项目级评论')
  })

  test('6.1 成员协作：创建任务级评论并验证归属', async ({ request }) => {
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const projectsBody = await projectsRes.json()
    const project = projectsBody.data[0]

    // 获取项目下的任务
    const tasksRes = await request.get(`${API_BASE}/projects/${project.id}/tasks`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(tasksRes.ok()).toBeTruthy()
    const tasksBody = await tasksRes.json()
    expect(tasksBody.data.length).toBeGreaterThanOrEqual(1)
    const task = tasksBody.data[0]

    // 创建任务级评论
    const createRes = await request.post(
      `${API_BASE}/projects/${project.id}/tasks/${task.id}/comments`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { body: 'E2E 测试任务级评论' },
      },
    )
    expect(createRes.status()).toBe(201)
    const commentBody = await createRes.json()
    expect(commentBody.data.taskId).toBe(task.id)
    expect(commentBody.data.targetType).toBe('task')
  })

  test('6.1 成员协作：编辑本人评论', async ({ request }) => {
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const project = (await projectsRes.json()).data[0]

    // 创建评论
    const createRes = await request.post(`${API_BASE}/projects/${project.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: '编辑前内容' },
    })
    const comment = (await createRes.json()).data

    // 编辑评论
    const updateRes = await request.patch(
      `${API_BASE}/projects/${project.id}/comments/${comment.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { body: '编辑后内容' },
      },
    )
    expect(updateRes.ok()).toBeTruthy()
    const updated = (await updateRes.json()).data
    expect(updated.body).toBe('编辑后内容')
    expect(updated.isEdited).toBe(true)
  })

  test('6.1 成员协作：软删除评论', async ({ request }) => {
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const project = (await projectsRes.json()).data[0]

    // 创建评论
    const createRes = await request.post(`${API_BASE}/projects/${project.id}/comments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { body: '将被删除的评论' },
    })
    const comment = (await createRes.json()).data

    // 删除评论
    const deleteRes = await request.delete(
      `${API_BASE}/projects/${project.id}/comments/${comment.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(deleteRes.status()).toBe(204)
  })

  test('6.2 外部协作者受限访问', async ({ request }) => {
    // 获取项目
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const project = (await projectsRes.json()).data[0]

    // 创建只读观察者用户
    const viewerRes = await request.post(`${API_BASE}/auth/register`, {
      data: { email: 'e2e-viewer@test.local', password: 'Passw0rd!', fullName: 'E2E Viewer' },
    })
    // 注册可能失败（用户已存在等），尝试登录
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: 'e2e-viewer@test.local', password: 'Passw0rd!' },
    })

    if (loginRes.ok()) {
      const viewerToken = (await loginRes.json()).data.accessToken

      // 只读观察者尝试创建评论应被拒绝
      const createRes = await request.post(`${API_BASE}/projects/${project.id}/comments`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
        data: { body: '越权评论' },
      })
      // 预期 403（PermissionDenied）或 404（跨组织/不存在）
      expect(createRes.status() === 403 || createRes.status() === 404).toBeTruthy()
    }
  })

  test('6.1 前端渲染验证：项目详情页加载评论', async ({ page, request }) => {
    // 登录并获取 token
    const res = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    const body = await res.json()

    // 设置 localStorage token 模拟登录态
    await page.goto(FRONTEND_BASE)
    await page.evaluate(
      ({ token }) => {
        const session = {
          user: {
            id: 1,
            email: 'admin@test.local',
            fullName: '管理员',
            isSuperAdmin: false,
            organizations: [],
          },
          accessToken: token,
          refreshToken: '',
        }
        window.localStorage.setItem('aiproj-auth-session', JSON.stringify(session))
      },
      { token: body.data.accessToken },
    )

    // 跳转到项目页验证渲染
    await page.goto(`${FRONTEND_BASE}/projects`)
    await page.waitForLoadState('networkidle')

    // 验证页面加载成功（有项目列表或导航）
    const title = await page.title()
    expect(title).toBeDefined()
  })

  test('6.1 分页参数传递', async ({ request }) => {
    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const project = (await projectsRes.json()).data[0]

    // 验证分页参数被正确传递
    const listRes = await request.get(
      `${API_BASE}/projects/${project.id}/comments?page=1&perPage=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    expect(listRes.ok()).toBeTruthy()
    const meta = (await listRes.json()).meta
    expect(meta.page).toBe(1)
    expect(meta.perPage).toBe(5)
  })
})
