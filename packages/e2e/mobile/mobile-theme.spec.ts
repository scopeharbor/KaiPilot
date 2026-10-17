import { expect, test } from '@playwright/test'

test('新 UI 手动与 AI 主题在菜单卸载、导航及刷新后保持一致', async ({ page }) => {
  await page.goto('/login?next=/next')
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_MOBILE_EMAIL || 'admin@aiproj.local')
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_MOBILE_PASSWORD || 'password123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('[data-role-home]')).toBeVisible()

  const more = page.getByRole('button', { name: '更多设置与帮助', exact: true })
  const theme = async (value: 'light' | 'dark') => {
    await expect(page.locator('html')).toHaveAttribute('data-nx-theme', value)
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('aiproj-next-track') || '{}').state?.nxTheme,
        ),
      )
      .toBe(value)
    await expect
      .poll(() =>
        page
          .locator('[data-next-track]')
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe(value === 'light' ? 'rgb(246, 247, 249)' : 'rgb(10, 11, 13)')
  }
  const choose = async (value: 'light' | 'dark') => {
    const mobile = await more.isVisible()
    if (mobile) await more.click()
    const controls = mobile
      ? page.locator('[data-next-mobile-settings]')
      : page.locator('[data-next-topbar]')
    await controls.locator(`[data-nx-theme-option="${value}"]`).click()
    await theme(value)
    if (mobile) {
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-next-mobile-settings]')).toHaveCount(0)
      await theme(value)
      await more.click()
      await expect(
        page.locator(`[data-next-mobile-settings] [data-nx-theme-option="${value}"]`),
      ).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await theme(value)
    }
  }

  await choose('light')
  await choose('dark')
  await choose('light')
  await page.reload()
  await theme('light')

  // Only model planning is stubbed. Input, local preference executor, rendering and persistence are real.
  let planned = 0
  await page.route('**/ai/tools/plan', async (route) => {
    const input = route.request().postDataJSON() as { text: string }
    const value = /深色/.test(input.text) ? 'dark' : 'light'
    planned++
    await route.fulfill({
      json: {
        data: {
          isAction: true,
          actions: [
            {
              toolName: 'set_ui_preference',
              parameters: { theme: value },
              summary: `切换为${value === 'light' ? '浅色' : '深色'}`,
            },
          ],
          continue: false,
          reply: null,
          clarification: null,
          rejected: [],
          model: null,
        },
      },
    })
  })
  await page.getByRole('button', { name: 'AI 唤起', exact: true }).click()
  for (const value of ['dark', 'light'] as const) {
    await page
      .locator('[data-ai-colleague-input]')
      .fill(value === 'light' ? '切换成浅色模式' : '切换成深色模式')
    await page.locator('[data-ai-colleague-send]').click()
    await theme(value)
    await expect(page.locator('[data-ai-colleague-input]')).toBeEnabled()
  }
  expect(planned).toBe(2)
  await page.getByRole('button', { name: '关闭 AI 同事面板', exact: true }).click()
  if (await more.isVisible()) {
    await more.click()
    await page.keyboard.press('Escape')
  }
  await theme('light')
  await page.goto('/next/settings/profile')
  await theme('light')
  await page.reload()
  await theme('light')
})
