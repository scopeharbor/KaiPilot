import { test, expect } from '@playwright/test'

const api = process.env.E2E_API_URL || 'http://localhost:3333/api/v1'

test('手机专用看板、详情分区、排程、AON 与 AI 同事交互', async ({ page, request }) => {
  const mobile = test.info().project.name !== 'desktop'
  await page.goto('/login?next=/next')
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_MOBILE_EMAIL || 'admin@aiproj.local')
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_MOBILE_PASSWORD || 'password123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('[data-role-home]')).toBeVisible()
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('aiproj-auth-session')!).state.accessToken as string,
  )
  const headers = { Authorization: `Bearer ${token}` }
  const created = await request.post(`${api}/projects`, {
    headers,
    data: {
      name: `手机交互专用-${test.info().project.name}-${Date.now()}`,
      startDate: '2026-10-05',
      endDate: '2026-11-30',
    },
  })
  expect(created.ok()).toBe(true)
  const project = (await created.json()).data
  try {
    const first = await request.post(`${api}/projects/${project.id}/tasks`, {
      headers,
      data: {
        name: '手机交互前置任务',
        description: '清空说明应保存',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        durationDays: 2,
        priority: 'high',
      },
    })
    expect(first.ok()).toBe(true)
    const task = (await first.json()).data
    const second = await request.post(`${api}/projects/${project.id}/tasks`, {
      headers,
      data: {
        name: '手机交互后置任务',
        startDate: '2026-10-07',
        endDate: '2026-10-08',
        durationDays: 2,
      },
    })
    expect(second.ok()).toBe(true)
    const successor = (await second.json()).data
    const dependency = await request.post(
      `${api}/projects/${project.id}/tasks/${successor.id}/dependencies`,
      { headers, data: { predecessorId: task.id, type: 'fs', lagDays: 0 } },
    )
    expect(dependency.ok()).toBe(true)
    await page.goto(`/next/projects/${project.id}`)
    const card = page.locator(`[data-workspace-task-card][data-task-id="${task.id}"]`).first()
    await expect(card).toBeVisible()
    if (mobile) {
      const nav = page.locator('[data-mobile-kanban-nav]')
      await expect(nav).toBeVisible()
      await expect(page.locator('[data-kanban-column]')).toHaveCount(1)
      const move = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/kanban/move'),
      )
      await card.locator('..').getByRole('button', { name: '开始任务', exact: true }).tap()
      expect((await move).ok()).toBe(true)
      await nav.getByRole('button').nth(1).tap()
      await expect(card).toBeVisible()
      const persisted = await request.get(`${api}/projects/${project.id}/tasks/${task.id}`, {
        headers,
        maxRetries: 2,
      })
      expect((await persisted.json()).data.status).toBe('in_progress')
    }
    await card.click()
    const detail = page.locator('[data-workspace-task-detail-drawer]')
    await expect(detail).toBeVisible()
    await detail.locator('#task-detail-name').fill('手机详情已修改')
    await detail.locator('#task-detail-description').fill('')
    if (mobile) {
      await page.getByRole('button', { name: '排期', exact: true }).tap()
      await expect(detail.locator('#task-detail-start-date')).toBeVisible()
      await detail.locator('#task-detail-duration').fill('3')
      await page.getByRole('button', { name: '关联', exact: true }).tap()
      await expect(detail.getByRole('heading', { name: '前后置依赖', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '执行', exact: true }).tap()
      await expect(detail.locator('#task-detail-name')).toHaveValue('手机详情已修改')
      const originalViewport = page.viewportSize()!
      await page.setViewportSize({ width: originalViewport.width, height: 430 })
      await detail.locator('#task-detail-name').focus()
      const bounds = await page.locator('[data-mobile-task-save]').boundingBox()
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
      await page.setViewportSize(originalViewport)
    }
    const save = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/tasks/${task.id}`),
    )
    await detail.getByRole('button', { name: '保存修改', exact: true }).click()
    expect((await save).ok()).toBe(true)
    const updated = await request.get(`${api}/projects/${project.id}/tasks/${task.id}`, {
      headers,
      maxRetries: 2,
    })
    const updatedTask = (await updated.json()).data
    expect(updatedTask.name).toBe('手机详情已修改')
    expect(updatedTask.description).toBeNull()
    await page.getByRole('button', { name: '关闭详情抽屉' }).click()
    for (const lens of ['list', 'gantt', 'timeline', 'calendar', 'wbs']) {
      await page.locator(`[data-lens-trigger="${lens}"]`).click()
      await expect(page.locator(`[data-${lens}-lens]`)).toBeVisible()
      if (mobile && lens === 'list')
        await expect(page.locator('[data-mobile-task-list]')).toBeVisible()
      if (mobile && lens === 'gantt') {
        await expect(page.locator('[data-mobile-gantt-schedule]')).toBeVisible()
        await page.getByRole('button', { name: '图形总览', exact: true }).tap()
        await expect(page.locator('[data-mobile-gantt-schedule]')).toHaveCount(0)
        await page.getByRole('button', { name: '任务排程', exact: true }).tap()
      }
      if (mobile && lens === 'timeline')
        await expect(page.locator('[data-mobile-timeline]')).toContainText('手机详情已修改')
      if (mobile && lens === 'calendar') {
        await expect(page.locator('[data-calendar-view-option="day"]')).toHaveAttribute(
          'aria-checked',
          'true',
        )
        await page.locator('[data-calendar-add]').first().tap()
        const quick = page.locator('[data-calendar-quick-create]')
        await expect(quick).toBeVisible()
        await quick.locator('[data-quick-create-name]').fill('手机日历创建任务')
        const popupBounds = await quick.boundingBox()
        expect(popupBounds!.width).toBe(page.viewportSize()!.width)
        const submitBounds = await quick.locator('[data-quick-create-submit]').boundingBox()
        expect(submitBounds!.y + submitBounds!.height).toBeLessThanOrEqual(
          page.viewportSize()!.height + 1,
        )
        const calendarSave = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/projects/${project.id}/tasks`),
        )
        await quick.locator('[data-quick-create-submit]').tap()
        expect((await calendarSave).ok()).toBe(true)
        await expect(quick).toBeHidden()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      )
    }
    await page.goto(`/next/projects/${project.id}/charts/aon-network`)
    await expect(page.locator('[data-aon-lens]')).toBeVisible()
    if (mobile) {
      await page
        .locator('[data-mobile-aon]')
        .getByRole('button', { name: /手机详情已修改/ })
        .tap()
      await expect(page.locator('[data-aon-drawer]')).toBeVisible()
      await page.locator('[data-aon-drawer]').getByRole('button').first().tap()
      await page.getByRole('button', { name: '查看网络图', exact: true }).tap()
      await expect(page.locator('[data-aon-canvas]')).toBeVisible()
      await page.getByRole('button', { name: '返回任务网络', exact: true }).tap()
    }
    await page.goto(`/next/projects/${project.id}/charts/fishbone`)
    if (mobile) {
      await expect(page.locator('[data-mobile-fishbone]')).toBeVisible()
      await page.getByRole('button', { name: '＋ 添加要因', exact: true }).first().tap()
      await page.locator('[data-fishbone-cause-input]').fill('手机可以编辑的原因')
      await page.locator('[data-fishbone-cause-save]').tap()
      await expect(
        page.getByRole('button', { name: '手机可以编辑的原因', exact: true }),
      ).toBeVisible()
      const savedFishbone = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/projects/${project.id}/diagrams`),
      )
      await page.locator('[data-fishbone-save]').tap()
      expect((await savedFishbone).ok()).toBe(true)
      await page.reload()
      await expect(
        page.getByRole('button', { name: '手机可以编辑的原因', exact: true }),
      ).toBeVisible()
    }
    await page.getByRole('button', { name: 'AI 唤起', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'AI 同事交互面板' })
    await expect(panel).toBeVisible()
    await page.locator('[data-ai-colleague-input]').fill('请打开帮助中心')
    await page.locator('[data-ai-colleague-send]').click()
    await expect(page).toHaveURL(/\/next\/help/)
    // Deterministic navigation exercises the real dispatcher without paid model calls.
    if (await panel.isVisible())
      await page.getByRole('button', { name: '关闭 AI 同事面板' }).click()
    await page.getByRole('button', { name: 'AI 唤起', exact: true }).click()
    await expect(panel).toBeVisible()
    await page.getByRole('tab', { name: /建议收件箱/ }).click()
    await page.getByRole('tab', { name: '对话', exact: true }).click()
    if (mobile) {
      // Browser viewport reduction checks layout response; actual OS keyboard remains a hardware check.
      await page.setViewportSize({ width: page.viewportSize()!.width, height: 430 })
      await page.locator('[data-ai-colleague-input]').fill('中文输入测试')
      const send = await page.locator('[data-ai-colleague-send]').boundingBox()
      expect(send!.y).toBeGreaterThanOrEqual(0)
      expect(send!.y + send!.height).toBeLessThanOrEqual(431)
      expect(send!.width).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: test.info().outputPath('mobile-ai.png') })
    await page.getByRole('button', { name: '关闭 AI 同事面板' }).click()
  } finally {
    // Delete only the project created by this test, never seeded or user projects.
    const removed = await request.delete(`${api}/projects/${project.id}?force=true`, { headers })
    expect(removed.ok()).toBe(true)
  }
})
