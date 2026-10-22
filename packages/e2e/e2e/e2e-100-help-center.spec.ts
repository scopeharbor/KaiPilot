import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * E2E-100: 帮助中心与问题/风险入口（v3-help-and-operational-issues-center 3.2/4.1）。
 *
 * 覆盖：
 * - 角色矩阵（已登录用户打开 /help 与文章页）；
 * - 搜索任务矩阵（下拉命中、搜索页筛选、no-result 建议）；
 * - Markdown/Agent 同源读取（授权 200 / 未授权 401 / 不存在 404）；
 * - 页面 readiness（/tasks 跨项目任务聚合；/risks 风险登记册与项目问题清单；
 *   产品故障 → 故障排查而非创建风险；blocker 链接项目）；
 * - 404（文章不存在）。
 *
 * 前置条件：seed 数据含默认管理员 admin@test.local（global-setup 已迁移+播种）。
 */

test.describe('E2E-100: 帮助中心', () => {
  test.beforeEach(async ({ page, request }) => {
    const auth = await loginAsAdmin(request)
    await page.goto('/')
    await setAuthSession(page, auth)
  })

  test('角色矩阵：/help 首页展示搜索、版本与模块，文章页可打开', async ({ page }) => {
    // 帮助首页与文章页在 dev 下各自冷编译，放宽测试级超时
    test.setTimeout(90_000)
    await page.goto('/help')
    await expect(page.getByTestId('help-home')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-search-box')).toBeVisible()
    await expect(page.getByTestId('help-version')).toContainText('v3')
    await expect(page.getByTestId('help-learning-paths')).toBeVisible()
    await expect(page.getByTestId('help-modules')).toBeVisible()

    // 打开一篇已知文章（product-overview 存在于首批 10 篇）
    await page.goto('/help/articles/getting-started.product-overview', { timeout: 60_000 })
    await expect(page.getByTestId('help-article-view')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-content')).toContainText('AI-first')
    await expect(page.getByTestId('help-meta')).toContainText('2026-09-01')
  })

  test('搜索任务矩阵：下拉命中 → 搜索页筛选 → no-result 建议', async ({ page }) => {
    await page.goto('/help')
    const input = page.getByTestId('help-search-input')
    await input.fill('Docker')
    const dropdown = page.getByTestId('help-search-dropdown')
    await expect(dropdown).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-search-hit-0')).toContainText(/Docker|部署/)

    // 键盘导航：↓ + Enter 打开文章
    await input.press('ArrowDown')
    await input.press('Enter')
    await page.waitForURL(/\/help\/articles\//, { timeout: 10000 })

    // 搜索页：筛选器可用
    await page.goto('/help/search?q=部署')
    await expect(page.getByTestId('help-search-page')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-search-page-results')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-search-filters')).toBeVisible()

    // no-result 建议（术语 + 支持路径）
    // 注意：查询必须真不可命中——中文词会被拆成二元组，如「不存在」会经「存在」
    // 命中故障排查文章；因此用纯拉丁乱码词。
    await page.goto('/help/search?q=zzzzxcvbnmqwerty')
    const pageInput = page.getByTestId('help-search-page-input')
    await expect(pageInput).toBeVisible({ timeout: 10000 })
    // 诊断：URL 与输入框实际值（Next 软导航下 searchParams 可能不刷新）
    console.log('DIAG_URL=', page.url())
    console.log('DIAG_INPUT_VALUE=', JSON.stringify(await pageInput.inputValue()))
    if (!(await pageInput.inputValue())) {
      await pageInput.fill('zzzzxcvbnmqwerty')
    }
    await expect(page.getByTestId('help-search-page-no-result')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/没有找到匹配/).first()).toBeVisible()
  })

  test('Markdown/Agent 同源读取：授权 200、未授权 401、不存在 404', async ({ request }) => {
    const auth = await loginAsAdmin(request)
    const headers = { Authorization: `Bearer ${auth.accessToken}` }

    // 授权读取：text/markdown、含标题/版本/时间、无 frontmatter/导航 chrome/内部注释
    const ok = await request.get('/api/help/articles/getting-started.product-overview', {
      headers,
    })
    expect(ok.status()).toBe(200)
    expect(ok.headers()['content-type']).toContain('text/markdown')
    const md = await ok.text()
    expect(md).toContain('# 产品概览')
    expect(md).toContain('v3')
    expect(md).toContain('2026-09-01')
    expect(md).not.toContain('---\nid:')
    expect(md).not.toContain('internal-note')
    expect(md).not.toContain('复制 Markdown')
    expect(md).not.toContain('sidebar')

    // 未授权 → 401
    const unauth = await request.get('/api/help/articles/getting-started.product-overview')
    expect(unauth.status()).toBe(401)

    // 不存在 → 404（可见真相而非空白）
    const missing = await request.get('/api/help/articles/not.existing', { headers })
    expect(missing.status()).toBe(404)

    // 搜索索引出口授权可用
    const index = await request.get('/api/help/index', { headers })
    expect(index.status()).toBe(200)
    const indexBody = (await index.json()).data
    expect(indexBody.documents.length).toBeGreaterThan(0)
  })

  test('页面 readiness：/tasks 跨项目任务聚合已可用', async ({ page }) => {
    // 「旧 UI 规划中占位页全部落地为真实功能」后 /tasks 为 ready：横幅如实标注，不再给替代路径
    await page.goto('/tasks')
    await expect(page.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'ready',
      { timeout: 10000 },
    )
    await expect(page.getByTestId('cross-project-tasks-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: '任务', level: 1 })).toBeVisible()
    await expect(page.getByRole('group', { name: '任务范围' })).toBeVisible()
    await expect(page.getByLabel('状态筛选')).toBeVisible()
    await expect(page.getByTestId('task-count')).toBeVisible()
  })

  test('问题与风险：taxonomy 区分、产品故障走故障排查、风险与问题均可用', async ({ page }) => {
    await page.goto('/risks')
    await expect(page.getByTestId('issues-and-risks-page')).toBeVisible({ timeout: 10000 })
    // 风险登记册与项目问题清单均已落地：readiness 为 ready
    await expect(page.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'ready',
    )
    // taxonomy 概念卡片；产品故障明确走故障排查、不进入项目风险记录
    await expect(page.getByText('项目问题').first()).toBeVisible()
    await expect(page.getByText('项目风险').first()).toBeVisible()
    await expect(page.getByText('产品故障').first()).toBeVisible()
    await expect(page.getByText(/请走故障排查，不进入项目风险记录/)).toBeVisible()

    // 风险 tab：项目列表 → blocker 链接项目（项目风险登记册）
    await page.getByTestId('risks-tab').waitFor({ state: 'visible' })
    const projectLink = page
      .getByTestId('risk-projects-hub')
      .getByRole('link', { name: /进入风险登记册/ })
    const href = await projectLink.first().getAttribute('href')
    expect(href).toMatch(/^\/projects\/\d+\/risks$/)

    // 问题 tab：真实的项目问题清单（选择项目 + 登记问题），而不是创建风险
    await page.getByRole('tab', { name: '项目问题' }).click()
    await expect(page.getByTestId('project-issues-panel')).toBeVisible()
    await expect(page.getByLabel('选择项目')).toBeVisible()
    await expect(page.getByRole('button', { name: '登记问题' })).toBeVisible()
    await expect(page.getByRole('button', { name: /创建风险/ })).toHaveCount(0)
  })

  test('404：不存在的文章返回 404 页面', async ({ page }) => {
    const res = await page.goto('/help/articles/not.existing')
    // Next dev 对 notFound() 返回 200 + 404 内容；生产构建返回 404 状态。
    expect([200, 404]).toContain(res?.status())
    // 根 404 由 EditionAwareNotFound 渲染（普通路由显示「页面不存在」与返回首页）
    await expect(page.locator('[data-not-found]')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('页面不存在')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回首页' })).toBeVisible()
  })
})

/** 与 API_BASE 一致的统一 export（供复用矩阵断言）。 */
export { API_BASE }
