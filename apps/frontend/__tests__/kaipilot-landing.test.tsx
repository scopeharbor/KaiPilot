/**
 * 开项 KaiPilot 介绍页（/welcome）：入口链接、登录态换算、语言切换与各个演示区的交互。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KaiPilotLanding, LANDING_LANG_STORAGE_KEY } from '@/components/landing/KaiPilotLanding'
import {
  KAIPILOT_REPO_URL,
  KaiPilotWelcome,
  resolveConsoleHref,
} from '@/components/landing/KaiPilotWelcome'
import { COPY, SCENARIOS } from '@/components/landing/landing-content'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

const REPO = 'https://github.com/example/kaipilot'

function renderLanding(props: Partial<Parameters<typeof KaiPilotLanding>[0]> = {}) {
  return render(<KaiPilotLanding consoleHref="/login" repoUrl={REPO} {...props} />)
}

beforeEach(() => {
  window.localStorage.removeItem(LANDING_LANG_STORAGE_KEY)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('resolveConsoleHref', () => {
  it('与根路由分流一致：未登录去登录页，已登录去工作台，新版偏好走新版页面', () => {
    expect(resolveConsoleHref('legacy', false)).toBe('/login')
    expect(resolveConsoleHref('legacy', true)).toBe('/dashboard')
    expect(resolveConsoleHref(null, false)).toBe('/login')
    expect(resolveConsoleHref('next', false)).toBe('/next-login')
    expect(resolveConsoleHref('next', true)).toBe('/next')
  })
})

describe('KaiPilotLanding', () => {
  it('顶栏与首屏都有「登录控制台」和 GitHub 仓库入口', () => {
    renderLanding()
    const consoleLinks = document.querySelectorAll('a[data-console-link]')
    expect(consoleLinks.length).toBeGreaterThanOrEqual(3)
    consoleLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/login'))
    for (const link of screen.getAllByRole('link', { name: '登录控制台' }))
      expect(link).toHaveAttribute('href', '/login')

    const github = screen.getByRole('link', { name: /在 GitHub 查看源码/ })
    expect(github).toHaveAttribute('href', REPO)
    expect(github).toHaveAttribute('target', '_blank')
    expect(github).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: '许可证 AGPL-3.0' })).toHaveAttribute(
      'href',
      `${REPO}/blob/main/LICENSE`,
    )
  })

  it('已登录时按钮改为「进入工作台」', () => {
    renderLanding({ consoleHref: '/dashboard', authenticated: true })
    for (const link of screen.getAllByRole('link', { name: '进入工作台' }))
      expect(link).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('link', { name: '登录控制台' })).toBeNull()
  })

  it('本实例源码地址与官方仓库不同时，页脚显示「本实例源代码」', () => {
    const { unmount } = renderLanding({ sourceUrl: REPO })
    expect(screen.queryByRole('link', { name: '本实例源代码' })).toBeNull()
    unmount()
    renderLanding({ sourceUrl: 'https://git.example.com/fork' })
    expect(screen.getByRole('link', { name: '本实例源代码' })).toHaveAttribute(
      'href',
      'https://git.example.com/fork',
    )
  })

  it('切换到英文并记住选择；非中文浏览器默认英文', () => {
    const { unmount } = renderLanding()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('一句话，启动整个项目。')
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One sentence starts the whole project.',
    )
    expect(window.localStorage.getItem(LANDING_LANG_STORAGE_KEY)).toBe('en')
    unmount()

    window.localStorage.removeItem(LANDING_LANG_STORAGE_KEY)
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    renderLanding()
    expect(screen.getAllByRole('link', { name: 'Sign in to console' }).length).toBeGreaterThan(0)
  })

  it('演示区开箱就是完整草案；确认后显示已转为正式项目，可撤回', () => {
    renderLanding()
    const first = SCENARIOS.zh[0]!
    const demo = screen.getByRole('region', { name: 'AI 立项' })
    expect(within(demo).getByText(first.prompt)).toBeInTheDocument()
    for (const task of first.tasks) expect(within(demo).getByText(task.name)).toBeInTheDocument()
    expect(within(demo).getByRole('status')).toHaveTextContent('草案 · 等你审查')

    fireEvent.click(within(demo).getByRole('button', { name: '确认为正式项目' }))
    expect(within(demo).getByRole('status')).toHaveTextContent(
      `已转为正式项目 · 创建 ${first.tasks.length} 个任务`,
    )
    fireEvent.click(within(demo).getByRole('button', { name: '撤回，再看看' }))
    expect(within(demo).getByRole('status')).toHaveTextContent('草案 · 等你审查')
  })

  it('选择另一个示例：先逐字打出描述、显示占位，阶段走完后给出新草案', () => {
    vi.useFakeTimers()
    renderLanding()
    const second = SCENARIOS.zh[1]!
    const demo = screen.getByRole('region', { name: 'AI 立项' })
    fireEvent.click(within(demo).getByRole('button', { name: second.chip }))

    expect(within(demo).getByRole('button', { name: '重新生成' })).toBeDisabled()
    expect(within(demo).queryByText(second.tasks[0]!.name)).toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(within(demo).getByText(second.prompt)).toBeInTheDocument()
    expect(within(demo).getByText(second.tasks[0]!.name)).toBeInTheDocument()
    expect(within(demo).getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(within(demo).getByRole('button', { name: second.chip })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('减少动态效果时直接给出草案', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    )
    renderLanding()
    const third = SCENARIOS.zh[2]!
    const demo = screen.getByRole('region', { name: 'AI 立项' })
    fireEvent.click(within(demo).getByRole('button', { name: third.chip }))
    expect(within(demo).getByText(third.tasks[0]!.name)).toBeInTheDocument()
  })

  it('工作方式五步可逐一查看', () => {
    renderLanding()
    const steps = COPY.zh.how.steps
    const last = steps[steps.length - 1]!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(last.title) }))
    expect(screen.getByRole('heading', { level: 3, name: last.title })).toBeInTheDocument()
    expect(screen.getByText(last.detail)).toBeInTheDocument()
  })

  it('双入口：同一批任务在甘特表与看板之间切换', () => {
    renderLanding()
    const panel = () => screen.getByRole('tabpanel', { name: /专业入口|直觉入口/ })
    expect(within(panel()).getByRole('table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /直觉入口/ }))
    expect(within(panel()).queryByRole('table')).toBeNull()
    for (const column of ['待办', '进行中', '已完成'])
      expect(within(panel()).getByText(column)).toBeInTheDocument()
    for (const task of SCENARIOS.zh[0]!.tasks)
      expect(within(panel()).getByText(task.name)).toBeInTheDocument()
  })

  it('产品能力：点击与方向键切换分类', () => {
    renderLanding()
    const list = COPY.zh.capabilities.list
    const second = list[1]!
    fireEvent.click(screen.getByRole('tab', { name: second.name }))
    const panel = screen.getByRole('tabpanel', { name: second.name })
    for (const item of second.items) expect(within(panel).getByText(item)).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('tab', { name: second.name }), { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: list[2]!.name })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: list[2]!.name })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: list[2]!.name }), { key: 'ArrowUp' })
    expect(screen.getByRole('tab', { name: second.name })).toHaveAttribute('aria-selected', 'true')
  })

  it('部署命令可切换并复制；剪贴板不可用时改为选中文字', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderLanding()
    fireEvent.click(screen.getByRole('tab', { name: 'Docker Compose' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('docker compose'))
    expect(screen.getByRole('button', { name: /已复制/ })).toBeInTheDocument()

    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByRole('tab', { name: /本机/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    })
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('pnpm install'))
    expect(screen.getByRole('button', { name: /已选中，请手动复制/ })).toBeInTheDocument()
  })
})

describe('KaiPilotWelcome', () => {
  it('按登录态与界面偏好换算按钮地址，GitHub 指向官方仓库', () => {
    act(() => {
      useNextTrackStore.setState({ track: 'legacy' })
      useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
    })
    const { unmount } = render(<KaiPilotWelcome />)
    for (const link of screen.getAllByRole('link', { name: '登录控制台' }))
      expect(link).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /在 GitHub 查看源码/ })).toHaveAttribute(
      'href',
      KAIPILOT_REPO_URL,
    )
    unmount()

    act(() => {
      useNextTrackStore.setState({ track: 'next' })
      useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
    })
    render(<KaiPilotWelcome />)
    for (const link of screen.getAllByRole('link', { name: '进入工作台' }))
      expect(link).toHaveAttribute('href', '/next')
  })
})
