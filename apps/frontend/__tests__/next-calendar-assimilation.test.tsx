/**
 * v3-ui-next-batch3-global-convergence W3
 * /next/calendar 旧版全局日历路由同化承接页测试。
 *
 * 覆盖：
 * 1. 访问 /next/calendar 页面自动触发 router.replace('/next?tier=global-timeline')；
 * 2. 携带历史查询参数（如 ?month=2026-09&project=12）时完整透传并追加 tier=global-timeline；
 * 3. 渲染暗黑仪器风平滑导流提示与零死链兜底链接。
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import CalendarPage from '@/app/(next)/next/calendar/page'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}))

let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/next/calendar',
  useSearchParams: () => currentSearchParams,
}))

describe('CalendarPage 路由同化与无缝导流', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentSearchParams = new URLSearchParams()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('默认无参访问平滑重定向至全域时间主轴', () => {
    const { container } = render(<CalendarPage />)

    expect(container.querySelector('[data-calendar-assimilation-page]')).toBeInTheDocument()
    expect(screen.getByText('日历视图已升级为「全域时间主轴」')).toBeInTheDocument()

    // 验证立即执行 replace 并携带 tier=global-timeline
    expect(routerMock.replace).toHaveBeenCalledWith('/next?tier=global-timeline')

    // 兜底直达链接断言
    const fallbackLink = container.querySelector(
      '[data-assimilation-fallback-link]',
    ) as HTMLAnchorElement
    expect(fallbackLink).toBeInTheDocument()
    expect(fallbackLink.getAttribute('href')).toBe('/next?tier=global-timeline')
  })

  test('携带历史查询参数时正确透传并注入 tier=global-timeline', () => {
    currentSearchParams = new URLSearchParams('month=2026-09&project=42')
    const { container } = render(<CalendarPage />)

    expect(routerMock.replace).toHaveBeenCalledWith(expect.stringContaining('tier=global-timeline'))
    expect(routerMock.replace).toHaveBeenCalledWith(expect.stringContaining('month=2026-09'))
    expect(routerMock.replace).toHaveBeenCalledWith(expect.stringContaining('project=42'))

    const fallbackLink = container.querySelector(
      '[data-assimilation-fallback-link]',
    ) as HTMLAnchorElement
    expect(fallbackLink.getAttribute('href')).toContain('tier=global-timeline')
    expect(fallbackLink.getAttribute('href')).toContain('project=42')
  })
})
