import { test, expect } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * E2E-101: 帮助中心截图采集（v3-help-and-operational-issues-center 2.3，design H）。
 *
 * 规则：测试租户（seed 管理员）；静态 PNG；描述性 kebab 文件名；
 * 正文文字独立完整（截图不是唯一信息载体）；版本/路由 metadata 记录在实现记录。
 */
// 相对 packages/e2e（Playwright 的运行目录）定位帮助内容目录，与 mobile 审计用例一致
const SCREENSHOT_DIR = resolve('../..', 'apps/frontend/content/help/zh-CN')

test.describe('E2E-101: 帮助截图采集', () => {
  test('AI Connections 添加模型/OCR 区域截图', async ({ page, request }) => {
    const auth = await loginAsAdmin(request)
    await page.goto('/')
    await setAuthSession(page, auth)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/settings/ai-connections')
    // 等待页面主体出现（空态或已配置列表均可，均不带 secret）
    await expect(page.locator('main, [class*="p-6"]').first()).toBeVisible({ timeout: 20000 })

    const out = `${SCREENSHOT_DIR}/ai/assets/ai-connections-add-model.png`
    await page.screenshot({ path: out, fullPage: false })
    expect(existsSync(out)).toBe(true)
    const size = statSync(out).size
    expect(size).toBeGreaterThan(1000)
    console.log(`SCREENSHOT_OK ${out} bytes=${size}`)
  })
})
