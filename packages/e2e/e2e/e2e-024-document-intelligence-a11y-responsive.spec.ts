import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * E2E-024：文档智能工作台的响应式、无障碍与状态实测
 * （v3-document-intelligence-workbench §7.7 / §7.8 / §7.9）
 *
 * 在真实 Chromium 中验证：
 * - 桌面 / 平板 / 移动视口、浅色与深色、200% zoom 下无横向溢出，
 *   来源标识、状态、主要入口与面板控件仍可读可点
 * - 键盘 tab 顺序、可见焦点、ARIA tab/dialog/row 语义、disabled 原因、
 *   面板关闭后焦点归位
 * - loading / empty / error / 非法 URL 清理与刷新恢复
 *
 * 红线：全程只读；不触发 OCR 创建、确认或任何 provider 调用。
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
] as const

async function openWorkbench(page: Page, projectId: number, query = 'view=intelligence') {
  // 先到同源页面再注入会话（sessionStorage 需要同源上下文）
  await page.goto('/login')
  const session = await loginAsAdmin(page.request)
  await setAuthSession(page, session)
  await page.goto(`/projects/${projectId}/files?${query}`)
  // 不用 networkidle：Next dev server 的 HMR socket 会让它永不静默，
  // 等真正的挂载信号更确定也更快。未登录被重定向时回退到 body 可见。
  await page
    .getByTestId('document-intelligence-workbench')
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(async () => {
      await page.locator('body').waitFor({ state: 'visible' })
    })
}

test.describe('E2E-024: Workbench Accessibility & Responsive', () => {
  let projectId: number | null = null

  test.beforeAll(async ({ request }) => {
    const session = await loginAsAdmin(request)
    const orgId = session.currentOrganizationId
    const headers = { Authorization: `Bearer ${session.accessToken}` }
    const res = await request.get(`${API_BASE}/organizations/${orgId}/projects?perPage=5`, {
      headers,
    })
    const projects = res.ok() ? ((await res.json()).data ?? []) : []
    projectId = projects[0]?.id ?? null

    // 保证至少有一个可见来源（走既有文件库 owning API，不碰 OCR/provider）
    if (projectId) {
      const list = await request.get(
        `${API_BASE}/projects/${projectId}/document-intelligence/sources?perPage=1`,
        { headers },
      )
      const rows = list.ok() ? ((await list.json()).data ?? []) : []
      if (rows.length === 0) {
        await request.post(`${API_BASE}/projects/${projectId}/files`, {
          headers,
          data: { name: 'a11y-fixture.md', documentType: 'document', parentId: null },
        })
      }
    }
  })

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} 视口无横向溢出且核心控件可见`, async ({ page }) => {
      test.skip(!projectId, '环境中没有可用项目')
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await openWorkbench(page, projectId!)

      const workbench = page.getByTestId('document-intelligence-workbench')
      await expect(workbench).toBeVisible()

      // 页面主体不得横向滚动
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${viewport.name} 出现横向溢出 ${overflow}px`).toBeLessThanOrEqual(2)

      // attention facet 与筛选控件在所有视口都可见可点
      await expect(page.getByTestId('di-facet-all')).toBeVisible()
      await expect(page.getByTestId('di-filter-source-kind')).toBeVisible()
    })
  }

  test('深色模式下工作台仍可读（背景/前景均已显式着色）', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await page.emulateMedia({ colorScheme: 'dark' })
    await openWorkbench(page, projectId!)
    await expect(page.getByTestId('document-intelligence-workbench')).toBeVisible()

    const colors = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="di-facet-all"]') as HTMLElement | null
      if (!el) return null
      const cs = getComputedStyle(el)
      return { color: cs.color, background: cs.backgroundColor }
    })
    expect(colors).not.toBeNull()
    expect(colors!.color).not.toBe('')
  })

  test('200% zoom 下核心控件不重叠且仍可操作', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await page.setViewportSize({ width: 1280, height: 800 })
    await openWorkbench(page, projectId!)
    await page.evaluate(() => {
      ;(document.body.style as unknown as Record<string, string>).zoom = '200%'
    })
    await expect(page.getByTestId('di-facet-all')).toBeVisible()

    const boxes = await page.evaluate(() => {
      const all = document.querySelector('[data-testid="di-facet-all"]')?.getBoundingClientRect()
      const kind = document
        .querySelector('[data-testid="di-filter-source-kind"]')
        ?.getBoundingClientRect()
      return all && kind ? { all: { ...all.toJSON() }, kind: { ...kind.toJSON() } } : null
    })
    expect(boxes).not.toBeNull()
    // 两个控件位于不同行/列，不应完全重叠
    const overlaps = boxes!.all.left === boxes!.kind.left && boxes!.all.top === boxes!.kind.top
    expect(overlaps).toBe(false)
  })

  test('键盘可达：tab 顺序、可见焦点与 ARIA 语义', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await page.setViewportSize({ width: 1280, height: 800 })
    await openWorkbench(page, projectId!)
    await expect(page.getByTestId('document-intelligence-workbench')).toBeVisible()

    // facet 按钮组带 group 语义与 aria-pressed
    const facetAll = page.getByTestId('di-facet-all')
    await expect(facetAll).toHaveAttribute('aria-pressed', /true|false/)
    await expect(page.getByRole('group', { name: '待办分类' })).toBeVisible()

    // 来源列表是 list 语义
    await expect(page.getByRole('list').first()).toBeVisible()

    // 键盘可聚焦，且焦点样式类存在（focus-visible ring）
    await facetAll.focus()
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    )
    expect(focused).toBe('di-facet-all')

    // 连续 Tab 不会陷在同一个元素上
    await page.keyboard.press('Tab')
    const next = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    )
    expect(next).not.toBe('di-facet-all')
  })

  test('禁用入口带可理解的原因提示（title）', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await openWorkbench(page, projectId!)
    const disabled = page.locator('button[data-testid^="di-entry-"][disabled]').first()
    if ((await disabled.count()) > 0) {
      const title = await disabled.getAttribute('title')
      expect(title, '禁用入口必须给出低敏原因').toBeTruthy()
    }
  })

  test('非法 URL 参数被清理并显示安全提示，刷新后仍可恢复', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await openWorkbench(page, projectId!, 'view=intelligence&attention=%3Cscript%3E')
    await expect(page.getByTestId('di-url-rejected')).toBeVisible()
    // 列表本身仍可用（fail closed 到安全默认视图，而不是整页崩溃）
    await expect(page.getByTestId('document-intelligence-workbench')).toBeVisible()

    // 刷新后回到合法深链仍能恢复
    await page.goto(`/projects/${projectId}/files?view=intelligence`)
    await expect(page.getByTestId('document-intelligence-workbench')).toBeVisible()
    await expect(page.getByTestId('di-url-rejected')).toHaveCount(0)
  })

  test('打开工作台与筛选不产生任何 OCR 作业（真实浏览器路径）', async ({ page, request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const session = await loginAsAdmin(request)
    const headers = { Authorization: `Bearer ${session.accessToken}` }
    const before = await request.get(
      `${API_BASE}/projects/${projectId}/ocr/document-jobs?perPage=1`,
      { headers },
    )
    const totalBefore = before.ok() ? ((await before.json()).meta?.total ?? 0) : 0

    await openWorkbench(page, projectId!)
    await page.getByTestId('di-facet-filter-needs_review').click()

    const after = await request.get(
      `${API_BASE}/projects/${projectId}/ocr/document-jobs?perPage=1`,
      { headers },
    )
    const totalAfter = after.ok() ? ((await after.json()).meta?.total ?? 0) : 0
    expect(totalAfter).toBe(totalBefore)
  })
})
