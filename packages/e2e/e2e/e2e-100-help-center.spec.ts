import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * E2E-100: 帮助中心与问题/风险入口（v3-help-and-operational-issues-center 3.2/4.1）。
 *
 * 覆盖：
 * - 角色矩阵（已登录用户打开 /help 与文章页）；
 * - 搜索任务矩阵（下拉命中、搜索页筛选、no-result 建议）；
 * - Markdown/Agent 同源读取（授权 200 / 未授权 401 / 不存在 404）；
 * - 占位页 readiness（/tasks 真实状态 + 替代路径；/risks 问题与风险 shell；
 *   产品故障 → 故障排查而非创建风险；blocker 链接项目/任务）；
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
    await page.goto('/help')
    await expect(page.getByTestId('help-home')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('help-search-box')).toBeVisible()
    await expect(page.getByTestId('help-version')).toContainText('v3')
    await expect(page.getByTestId('help-learning-paths')).toBeVisible()
    await expect(page.getByTestId('help-modules')).toBeVisible()

    // 打开一篇已知文章（product-overview 存在于首批 10 篇）
    await page.goto('/help/articles/getting-started.product-overview')
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

  test('占位页 readiness：/tasks 真实状态与替代路径', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'planned',
      { timeout: 10000 },
    )
    await expect(page.getByText('使用替代路径').first()).toBeVisible()
    // Button asChild 会把 href 落在 <a> 本体上
    const altLink = page.getByRole('link', { name: '使用替代路径' }).first()
    await expect(altLink).toHaveAttribute('href', '/projects')
    // 不再是无解释的空白/永久 loading
    await expect(page.getByText('跨项目任务聚合视图规划中')).toBeVisible()
  })

  test('问题与风险：taxonomy 区分、产品故障→故障排查而非创建风险、blocker 链接项目', async ({
    page,
  }) => {
    await page.goto('/risks')
    await expect(page.getByTestId('issues-and-risks-page')).toBeVisible({ timeout: 10000 })
    // partial 状态诚实声明
    await expect(page.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'partial',
    )
    // taxonomy 四概念卡片
    await expect(page.getByText('项目问题').first()).toBeVisible()
    await expect(page.getByText('项目风险').first()).toBeVisible()
    await expect(page.getByText('产品故障').first()).toBeVisible()

    // 风险 tab：项目列表 → blocker 链接项目（项目风险登记册）
    await page.getByTestId('risks-tab').waitFor({ state: 'visible' })
    const projectLink = page
      .getByTestId('risk-projects-hub')
      .getByRole('link', { name: /进入风险登记册/ })
    const href = await projectLink.first().getAttribute('href')
    expect(href).toMatch(/^\/projects\/\d+\/risks$/)

    // 问题 tab：planned 说明；产品故障跳故障排查（不是创建风险）
    await page.getByRole('tab', { name: '项目问题' }).click()
    await expect(page.getByTestId('issues-planned')).toBeVisible()
    await expect(page.getByText('项目问题清单规划中')).toBeVisible()
    // 不伪造 CRUD：问题 tab 没有“新建问题/创建风险”按钮
    await expect(page.getByRole('button', { name: /新建问题|创建风险/ })).toHaveCount(0)
    // 产品故障入口指向帮助中心故障排查
    const troubleshoot = page.getByRole('link', { name: /故障排查/ }).first()
    await expect(troubleshoot).toHaveAttribute('href', /\/help\/search\?q=故障/)
  })

  test('404：不存在的文章返回 404 页面', async ({ page }) => {
    const res = await page.goto('/help/articles/not.existing')
    // Next dev 对 notFound() 返回 200 + 404 内容；生产构建返回 404 状态。
    expect([200, 404]).toContain(res?.status())
    await expect(page.getByText('404', { exact: true })).toBeVisible({ timeout: 10000 })
  })
})

/** 与 API_BASE 一致的统一 export（供复用矩阵断言）。 */
export { API_BASE }
