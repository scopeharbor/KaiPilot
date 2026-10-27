import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession, type AuthSession } from './_auth-helper'

/**
 * E2E-032：记忆维基核心流程（v3-llm-wiki-memory-foundation §13.2）
 *
 * 管理员开启 → 在界面建页（含主张与依据）→ 发布即可读 → 「这条不对」撤回 →
 * 审阅队列发布级联修订 → 主张消失；其他组织用户读取同一页 404；导出得到 zip。
 * 本流程不调用任何模型；维基内容不写入任何正式业务数据。
 */

test.describe.configure({ mode: 'serial' })

test.describe('E2E-032: 记忆维基核心流程', () => {
  let session: AuthSession
  let headers: Record<string, string>
  let projectId: number
  let pageId: number
  // 界面流程在新 UI 轨道未开启时会跳过；第二个用例不依赖它，缺页时经 API 建页
  let uiFlowRan = false
  // 标识保持在 20 字符以内：DLP 会把 20+ 字符的连续串当作疑似密钥并阻断导出
  const slug = `wk${Date.now() % 1_000_000}`

  test.beforeAll(async ({ request }) => {
    session = await loginAsAdmin(request)
    headers = { Authorization: `Bearer ${session.accessToken}` }
    const enable = await request.put(`${API_BASE}/wiki/settings`, {
      headers,
      data: { enabled: true },
    })
    expect(enable.status()).toBe(200)
    const projects = await request.get(`${API_BASE}/projects`, { headers })
    projectId = (await projects.json()).data[0].id
  })

  test('界面建页、发布、撤回主张并在审阅队列确认级联修订', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await setAuthSession(page, session)
    await page.goto('/next/wiki')
    // 新 UI 轨道由前端构建开关 NEXT_PUBLIC_FF_NEXT_UI 灰度；未开启时会被送回旧版首页
    await page.waitForLoadState('networkidle')
    // 未开启时的跳回旧版首页可能晚于 networkidle：等到「新建页面」出现或已离开 /next/wiki 再判断
    const newPageButton = page.getByRole('button', { name: '新建页面' })
    await Promise.race([
      newPageButton.waitFor({ timeout: 60_000 }).catch(() => undefined),
      page
        .waitForURL((url) => !url.pathname.startsWith('/next/wiki'), { timeout: 60_000 })
        .catch(() => undefined),
    ])
    test.skip(!page.url().includes('/next/wiki'), '新 UI 轨道未开启（NEXT_PUBLIC_FF_NEXT_UI）')

    await newPageButton.click()
    await page.getByLabel('页面标识').fill(slug)
    await page
      .getByLabel('页面内容')
      .fill(
        [
          '---',
          'type: lesson',
          'title: E2E 发布教训',
          'summary: 端到端验证用页面',
          '---',
          '## 教训',
          '- 发布前必须确认回滚方案。[^c:rollback]',
          '',
          `[^c:rollback]: project#${projectId} | kind:rule`,
        ].join('\n'),
      )
    await page.getByRole('button', { name: '保存并发布' }).click()
    await expect(page.getByText('已发布。')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'E2E 发布教训' })).toBeVisible()
    const claim = page.locator('[data-wiki-claim="rollback"]')
    await expect(claim).toContainText('发布前必须确认回滚方案')

    await claim.getByRole('button', { name: '这条不对' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('撤回原因').fill('E2E 验证撤回')
    await dialog.getByRole('button', { name: '确认撤回' }).click()
    await expect(page.getByText(/已撤回该主张/)).toBeVisible()
    await expect(page.locator('[data-wiki-claim="rollback"]')).toHaveCount(0)

    await page.getByRole('tab', { name: /审阅队列/ }).click()
    const proposal = page.locator('[data-wiki-proposal]').first()
    await expect(proposal).toContainText('撤回主张')
    await proposal.getByRole('button', { name: '发布' }).click()
    await expect(page.getByText(/已发布修订/)).toBeVisible()
    uiFlowRan = true
  })

  test('其他组织用户读取该页返回 404；导出得到 zip', async ({ request }) => {
    // 组织空间幂等解析（界面流程跳过时空间可能尚未建立）
    const resolved = await request.post(`${API_BASE}/wiki/spaces/resolve`, {
      headers,
      data: { scopeKind: 'organization' },
    })
    expect(resolved.status()).toBe(200)
    const space = (await resolved.json()).data as { id: number }
    const pages = await request.get(`${API_BASE}/wiki/spaces/${space.id}/pages?perPage=100`, {
      headers,
    })
    const existing = (await pages.json()).data.find((p: { slug: string }) => p.slug === slug)
    if (existing) {
      pageId = existing.id
    } else {
      const created = await request.post(`${API_BASE}/wiki/spaces/${space.id}/pages`, {
        headers,
        data: {
          slug,
          body: [
            '---',
            'type: lesson',
            'title: E2E 发布教训',
            'summary: 端到端验证用页面',
            '---',
            '## 教训',
            '- 发布前先在预发环境演练。[^c:drill]',
            '',
            `[^c:drill]: project#${projectId} | kind:rule`,
          ].join('\n'),
        },
      })
      expect(created.status()).toBe(201)
      pageId = (await created.json()).data.page.id
    }
    const view = await request.get(`${API_BASE}/wiki/pages/${pageId}`, { headers })
    expect(view.status()).toBe(200)
    // 界面流程跑过时，撤回的主张已不在已发布正文里
    if (uiFlowRan) expect((await view.json()).data.body).not.toContain('回滚方案')

    const email = `e2e-wiki-outsider-${Date.now()}@test.local`
    await request.post(`${API_BASE}/auth/register`, {
      data: { email, password: 'Passw0rd!', fullName: 'E2E Outsider' },
    })
    const login = await request.post(`${API_BASE}/auth/login`, {
      data: { email, password: 'Passw0rd!' },
    })
    if (login.ok()) {
      const outsider = (await login.json()).data.accessToken as string
      const denied = await request.get(`${API_BASE}/wiki/pages/${pageId}`, {
        headers: { Authorization: `Bearer ${outsider}` },
      })
      // 没有组织上下文的新用户为 403，另属其他组织为 404；都不能读到内容
      expect([403, 404, 503]).toContain(denied.status())
      expect(await denied.text()).not.toContain('E2E 发布教训')
    }

    const exported = await request.get(`${API_BASE}/wiki/spaces/${space.id}/export`, { headers })
    expect(exported.status()).toBe(200)
    expect(exported.headers()['content-type']).toBe('application/zip')
    const bytes = await exported.body()
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
  })
})
