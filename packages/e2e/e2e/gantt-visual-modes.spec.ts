import { expect, test, type Page } from '@playwright/test'

type Entry = '标准入口' | '简化入口'
type Theme = 'light' | 'dark'
type Density = 'comfortable' | 'compact'

const ENTRIES: Entry[] = ['标准入口', '简化入口']
const THEMES: Theme[] = ['light', 'dark']
const DENSITIES: Density[] = ['comfortable', 'compact']

async function assertNoControlOverlap(page: Page) {
  const overlaps = await page.locator('body').evaluate(() => {
    const selectors = [
      'header button',
      'header input',
      'header select',
      '[aria-label="甘特入口"] button',
      '[aria-label="交互模式"] button',
      '[aria-label="时间粒度"] button',
      '[aria-label="甘特导航"] button',
      'button[aria-label$="叠加层"]',
    ].join(',')

    const rects = Array.from(document.querySelectorAll<HTMLElement>(selectors))
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        )
      })
      .map((el, index) => {
        const rect = el.getBoundingClientRect()
        return {
          index,
          label: el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        }
      })

    const failures: string[] = []
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!
        const b = rects[j]!
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        if (x > 2 && y > 2) failures.push(`${a.label} overlaps ${b.label}`)
      }
    }
    return failures
  })

  expect(overlaps).toEqual([])
}

test.describe('甘特视觉模式截图（v2-gantt-interaction-upgrade 5.5）', () => {
  for (const entry of ENTRIES) {
    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        test(`${entry} / ${theme} / ${density} 控件不重叠`, async ({ page }, testInfo) => {
          await page.goto('/dev/gantt-t018')
          await page.evaluate(
            ({ theme, density }) => {
              document.documentElement.setAttribute('data-mode', theme)
              document.documentElement.setAttribute('data-density', density)
            },
            { theme, density },
          )
          await page.getByRole('button', { name: entry }).click()
          await page.locator('[data-gantt-entry]').waitFor()
          await expect(page.locator('[data-gantt-entry]')).toHaveAttribute(
            'data-gantt-entry',
            entry === '标准入口' ? 'standard' : 'simplified',
          )

          await assertNoControlOverlap(page)

          const fileName = `gantt-${entry === '标准入口' ? 'standard' : 'simplified'}-${theme}-${density}.png`
          const screenshot = await page.screenshot({ fullPage: true })
          await testInfo.attach(fileName, { body: screenshot, contentType: 'image/png' })
        })
      }
    }
  }

  test('真实浏览器覆盖标准/简化、只读/编辑用户和 1000 任务项目', async ({ page }) => {
    await page.goto('/dev/gantt-t018')
    await expect(page.getByText('确定性 1000 任务')).toBeVisible()
    await expect(page.getByText(/1000 任务/)).toBeVisible()

    await page.getByRole('button', { name: '只读用户' }).click()
    await expect(page.getByText('只读模式：无编辑权限')).toBeVisible()
    await expect(page.getByRole('button', { name: '切换到改期模式' })).toHaveCount(0)

    await page.getByRole('button', { name: '编辑用户' }).click()
    await expect(page.getByRole('button', { name: '切换到改期模式' })).toBeVisible()
    await expect(page.getByRole('button', { name: '切换到依赖模式' })).toBeVisible()

    await page.getByRole('button', { name: '标准入口' }).click()
    await expect(page.locator('[data-gantt-entry]')).toHaveAttribute('data-gantt-entry', 'standard')
    await page.getByRole('button', { name: '简化入口' }).click()
    await expect(page.locator('[data-gantt-entry]')).toHaveAttribute(
      'data-gantt-entry',
      'simplified',
    )
  })
})
