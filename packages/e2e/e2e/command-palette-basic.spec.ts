import { test, expect, type Page } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * 打开命令面板并等待输入框可见。
 *
 * dev 模式下快速连续导航会中断在途 chunk 下载（net::ERR_ABORTED），导致
 * hydration 晚于 networkidle 完成；此时 Meta+K 落在事件监听挂载前是空操作。
 * 首次按下 3s 内不可见则等 hydration 完成后重按一次（探测确认重按 100% 打开）。
 */
async function openPalette(page: Page) {
  const input = page.locator('[cmdk-input]')
  await page.keyboard.press('Meta+k')
  try {
    await input.waitFor({ state: 'visible', timeout: 3000 })
  } catch {
    await page.waitForTimeout(500)
    await page.keyboard.press('Meta+k')
    await input.waitFor({ state: 'visible', timeout: 10000 })
  }
}

test.describe('CommandPalette - 浏览器基本验证 (v2-5-command-palette-registry)', () => {
  test.beforeEach(async ({ page, request }) => {
    const auth = await loginAsAdmin(request)
    await page.goto('/')
    await setAuthSession(page, auth)
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  })

  test('Cmd+K 打开面板，Esc 关闭', async ({ page }) => {
    await openPalette(page)
    await expect(page.locator('[cmdk-input]')).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('[cmdk-input]')).not.toBeVisible({ timeout: 3000 })
  })

  test('搜索过滤只显示匹配的命令', async ({ page }) => {
    await openPalette(page)
    const input = page.locator('[cmdk-input]')
    await input.fill('项目')
    const items = page.locator('[cmdk-item]')
    const count = await items.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await expect(items.nth(i)).toContainText(/项目/, { timeout: 1000 })
    }
  })

  test('主题与密度分组存在', async ({ page }) => {
    await openPalette(page)
    await expect(page.locator('[cmdk-group]', { hasText: '主题' })).toBeVisible({ timeout: 3000 })
    await expect(page.locator('[cmdk-group]', { hasText: '密度' })).toBeVisible({ timeout: 3000 })
  })
})
