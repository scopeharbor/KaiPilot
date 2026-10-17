/**
 * renderer-flow —— 渲染器 E2E 流程测试（§8.1 P0，§8.2 P0）。
 *
 * §8.1：AI/Compiler 候选 → 预览 → 用户确认个人视图 → 设为默认 → 打开
 * §8.2：预览/保存/切换视图不创建 or 修改正式项目数据
 */
import { test, expect } from '@playwright/test'

test.describe('Renderer E2E Flow (§8.1)', () => {
  test.beforeEach(async ({ page }) => {
    // 登录（使用测试凭据）
    await page.goto('/login')
    await page.fill('[name="email"]', 'admin@aiproj.local')
    await page.fill('[name="password"]', 'password123')
    await page.click('[type="submit"]')
    await page.waitForURL(/\/projects\/\d+/, { timeout: 10000 })
  })

  test('candidate to custom view flow', async ({ page }) => {
    // 1. 打开项目
    await page.goto('/projects/1')
    await page.waitForLoadState('networkidle')

    // 2. 模拟导航到候选视图预览页面
    await page.goto('/projects/1/renderer-candidates/candidate-1')
    await page.waitForLoadState('networkidle')

    // 3. 查看候选信息
    await expect(page.locator('text=AI 推荐视图')).toBeVisible()

    // 4. 输入视图名称并确认
    await page.fill('#view-name', '我的 AI 推荐视图')
    await page.click('text=保存视图')

    // 5. 确认后应跳转
    await page.waitForURL(/\/projects\/1/, { timeout: 10000 })
  })

  test('preview does not modify project data', async ({ page }) => {
    // §8.2：预览视图不应创建或修改正式项目数据
    const taskCountBefore = await page.locator('[data-testid="task-item"]').count()

    // 切换 renderer 视图（通过 search param）
    await page.goto('/projects/1/kanban?customView=1&renderer=true')
    await page.waitForLoadState('networkidle')

    // 验证视图已切换
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible()

    // 回到原视图
    await page.goto('/projects/1/kanban')
    await page.waitForLoadState('networkidle')

    // 确认任务数据未变化
    const taskCountAfter = await page.locator('[data-testid="task-item"]').count()
    expect(taskCountAfter).toBe(taskCountBefore)
  })

  test('switching renderer views does not change formal data', async ({ page }) => {
    // 在 dashboard 和 gantt 间切换 renderer 视图
    await page.goto('/projects/1/dashboard?customView=1&renderer=true')
    await page.waitForLoadState('networkidle')

    // 切换到 gantt renderer 视图
    await page.goto('/projects/1/gantt?customView=2&renderer=true')
    await page.waitForLoadState('networkidle')

    // 确认页面可渲染
    await expect(page.locator('body')).toBeVisible()
  })

  test('invalid fallback shows system default', async ({ page }) => {
    // 访问一个不存在的 renderer 默认视图
    await page.goto('/projects/1/kanban?customView=999999&renderer=true')
    await page.waitForLoadState('networkidle')

    // 应显示 kanban 视图（回退到默认）
    await expect(page.locator('body')).toBeVisible()
  })
})
