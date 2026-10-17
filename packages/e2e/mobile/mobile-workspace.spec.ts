import { test, expect, type Locator, type Page } from '@playwright/test'

const api = process.env.E2E_API_URL || 'http://localhost:3333/api/v1'

async function activate(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  if (test.info().project.use.hasTouch) await target.tap()
  else await target.click()
}

async function fitsViewport(page: Page) {
  const width = page.viewportSize()!.width
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width + 1)
  const brokenImages = await page
    .locator('img')
    .evaluateAll((images) =>
      images
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.getAttribute('src')),
    )
  expect(brokenImages).toEqual([])
  const clippedActions = await page
    .locator('[data-next-topbar] button, [data-topbar] button')
    .evaluateAll(
      (buttons, viewportWidth) =>
        buttons
          .filter((button) => {
            const rect = button.getBoundingClientRect()
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              (rect.left < -1 || rect.right > viewportWidth + 1)
            )
          })
          .map((button) => button.getAttribute('aria-label') || button.textContent),
      width,
    )
  expect(clippedActions).toEqual([])
}

async function login(page: Page) {
  await page.goto('/login?next=/next', { waitUntil: 'domcontentloaded' })
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_MOBILE_EMAIL || 'admin@aiproj.local')
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_MOBILE_PASSWORD || 'password123')
  await activate(page, page.getByRole('button', { name: '登录', exact: true }))
  await expect(page.locator('[data-next-topbar]')).toBeVisible()
  await expect(page.locator('[data-role-home]')).toBeVisible()
}

test('手机导航、设置与全屏弹层可触控，宽表格仅在内部滚动', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)
  await fitsViewport(page)
  const header = page.locator('[data-next-topbar]')
  const bounds = await header.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const more = page.getByRole('button', { name: '更多设置与帮助' })
  if (page.viewportSize()!.width < 1280) {
    await activate(page, more)
    const settings = page.locator('[data-next-mobile-settings]')
    await expect(settings).toBeVisible()
    await activate(page, settings.getByRole('button', { name: '浅色主题' }))
    await expect(page.locator('html')).toHaveAttribute('data-nx-theme', 'light')
    await activate(page, settings.getByRole('button', { name: '精确', exact: true }))
    await activate(page, settings.getByRole('button', { name: '帮助中心', exact: true }))
    await expect(page).toHaveURL(/\/next\/help/)
    await expect(settings).toBeHidden()
  }
  await activate(page, page.getByRole('button', { name: 'AI 唤起', exact: true }))
  await expect(page.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeVisible()
  await fitsViewport(page)
  await activate(page, page.getByRole('button', { name: '关闭 AI 同事面板' }))
  await activate(page, page.locator('[data-next-notification-trigger]'))
  await expect(page.getByRole('button', { name: '关闭通知抽屉' })).toBeVisible()
  await fitsViewport(page)
  await activate(page, page.getByRole('button', { name: '关闭通知抽屉' }))
  await activate(page, page.getByRole('button', { name: '空间地图', exact: true }))
  await expect(page.getByRole('button', { name: '关闭空间地图' })).toBeVisible()
  await activate(page, page.locator('[data-lens-tab="projects"]'))
  const projects = page.getByRole('region', { name: '项目清单，可横向滚动' })
  await expect(projects.getByRole('table')).toBeVisible()
  await fitsViewport(page)
  if (page.viewportSize()!.width < 640) {
    await expect.poll(() => projects.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
    await projects.evaluate((e) => {
      e.scrollLeft = 120
    })
    await expect.poll(() => projects.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
  }
  await activate(page, page.getByRole('button', { name: '关闭空间地图' }))
  for (const path of [
    '/next/create',
    '/next/settings/profile',
    '/next/settings/organization',
    '/next/help',
    '/next/charts',
    '/next/resources',
  ]) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-next-topbar]')).toBeVisible()
    await fitsViewport(page)
  }
  await page.screenshot({ path: test.info().outputPath('mobile-page.png'), fullPage: true })
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-topbar]')).toBeVisible()
  await fitsViewport(page)
  if (page.viewportSize()!.width < 768) {
    await activate(page, page.getByRole('button', { name: '打开导航' }))
    await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
    await activate(page, page.getByRole('button', { name: '关闭', exact: true }))
  }
  expect(errors).toEqual([])
})

test('项目六种视图、滑动与任务创建在手机和桌面均可用', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('aiproj-auth-session')!).state.accessToken as string,
  )
  const headers = { Authorization: `Bearer ${token}` }
  const response = await request.get(`${api}/projects`, { headers })
  expect(response.ok()).toBe(true)
  const project = (await response.json()).data[0]
  expect(project).toBeTruthy()
  await page.goto(`/next/projects/${project.id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-project-space-title]')).toContainText(project.name)
  await fitsViewport(page)
  for (const lens of ['list', 'wbs', 'calendar', 'timeline', 'gantt', 'kanban']) {
    await activate(page, page.locator(`[data-lens-trigger="${lens}"]`))
    await expect(page.locator(`[data-lens-trigger="${lens}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(
      page.locator(`[data-${lens === 'kanban' ? 'workspace-kanban-board' : `${lens}-lens`}]`),
    ).toBeVisible()
    await fitsViewport(page)
  }
  const card = page.locator('[data-workspace-task-card]').first()
  if (await card.count()) {
    await expect(card).not.toHaveCSS('touch-action', 'none')
    if (await page.locator('[data-mobile-kanban-nav]').isVisible()) {
      const nav = page.locator('[data-mobile-kanban-nav]')
      await activate(page, nav.getByRole('button').nth(1))
      await expect(page.locator('[data-kanban-column]')).toHaveCount(1)
      await expect(page.locator('[data-kanban-column]')).toHaveAttribute(
        'data-kanban-column',
        'in_progress',
      )
      await activate(page, nav.getByRole('button').first())
      const rect = await card.boundingBox()
      expect(rect!.width).toBeGreaterThan(page.viewportSize()!.width * 0.65)
    }
    await activate(page, card)
    await expect(page.getByRole('button', { name: '关闭详情抽屉' })).toBeVisible()
    await fitsViewport(page)
    await activate(page, page.getByRole('button', { name: '关闭详情抽屉' }))
  }
  await activate(page, page.locator('[data-manual-task-create-trigger]'))
  await activate(page, page.locator('[data-manual-task-mode="manual"]'))
  const taskName = `手机回归-${test.info().project.name}-${Date.now()}`
  await page.locator('[data-manual-task-name]').fill(taskName)
  if (test.info().project.use.hasTouch) {
    const fontSize = await page
      .locator('[data-manual-task-name]')
      .evaluate((input) => parseFloat(getComputedStyle(input).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
  }
  await fitsViewport(page)
  const createdResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/projects/${project.id}/tasks`),
  )
  await activate(page, page.locator('[data-manual-task-submit]'))
  const created = await createdResponse
  expect(created.ok()).toBe(true)
  const task = (await created.json()).data
  try {
    await expect(page.locator('[data-manual-task-name]')).toBeHidden()
    const saved = await request.get(`${api}/projects/${project.id}/tasks/${task.id}`, { headers })
    expect(saved.ok()).toBe(true)
    expect((await saved.json()).data.name).toBe(taskName)
    await fitsViewport(page)
    await page.screenshot({ path: test.info().outputPath('mobile-project.png'), fullPage: true })
    expect(errors).toEqual([])
  } finally {
    const removed = await request.delete(`${api}/projects/${project.id}/tasks/${task.id}`, {
      headers,
    })
    expect(removed.ok()).toBe(true)
  }
})
