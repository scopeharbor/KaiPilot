import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'

const { navMocks, routerPush } = vi.hoisted(() => ({
  navMocks: { pathname: '/next' },
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

/** 顶栏装配依赖 QueryClientProvider（W4 确认后缓存失效接线）。 */
function renderTopbar(props?: React.ComponentProps<typeof NextTopbar>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  routerPush.mockClear()
  navMocks.pathname = '/next'
  localStorage.clear()
  useNextTrackStore.getState().reset()
  useNextAiColleagueStore.setState({
    isOpen: false,
    messages: [],
    executionState: 'idle',
    pendingAction: null,
  })
  document.documentElement.removeAttribute('data-immersion')
})

describe('components/next/layout/NextTopbar（v3-ui-next-shell-space-map tasks 1.7/1.8）', () => {
  test('常驻极薄吸顶：sticky + top-0 + h-12（≤48px），位于视口顶部', () => {
    renderTopbar()

    const header = document.querySelector('[data-next-topbar]')
    expect(header).toBeTruthy()
    const classes = (header as HTMLElement).className
    expect(classes).toContain('sticky')
    expect(classes).toContain('top-0')
    expect(classes).toContain('h-12')
  })

  test('左侧品牌与空间坐标动态回显（等宽弱对比度文本）', () => {
    const view = renderTopbar()

    expect(screen.getByText('开项 Kaiplan')).toBeInTheDocument()
    const coordinate = document.querySelector('[data-next-coordinate]') as HTMLElement
    expect(coordinate.textContent).toBe('/next · 角色首页')
    expect(coordinate.className).toContain('font-mono')
    expect(coordinate.className).toContain('text-[var(--nx-text-muted)]')

    // 预置坐标：/next/charts
    navMocks.pathname = '/next/charts'
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextTopbar />
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
      '/next/charts · 图表馆',
    )

    // 深层子路由兜底
    navMocks.pathname = '/next/foo/bar'
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextTopbar />
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
      '/next/foo/bar · 空间探索',
    )

    // 非新轨路径（兜底原样返回）
    navMocks.pathname = '/dashboard'
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextTopbar />
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe('/dashboard')
  })

  test('coordinateLabel 覆盖文本生效（供宿主注入统一格式化器）', () => {
    renderTopbar({ coordinateLabel: '/next · 角色首页（覆盖）' })
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
      '/next · 角色首页（覆盖）',
    )
  })

  test('右侧操作区四入口完整渲染：沉浸档位、空间地图（含 Ctrl+M 提示）、AI 唤起（含 Ctrl+/）、回到旧版', () => {
    renderTopbar()

    expect(screen.getByRole('group', { name: '沉浸档位切换' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '沉浸' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '轻量' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '精确' })).toBeInTheDocument()

    const spaceMap = screen.getByRole('button', { name: /空间地图/ })
    expect(spaceMap).toBeInTheDocument()
    expect(screen.getByText('Ctrl+M')).toBeInTheDocument()

    const aiSummon = screen.getByRole('button', { name: /AI 唤起/ })
    expect(aiSummon).toBeInTheDocument()
    expect(screen.getByText('Ctrl+/')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /回到旧版/ })).toBeInTheDocument()
  })

  test('点击「回到旧版」：持久化偏好为 legacy（source=shell_switch）并跳转 /dashboard', () => {
    renderTopbar()

    fireEvent.click(screen.getByRole('button', { name: /回到旧版/ }))

    expect(routerPush).toHaveBeenCalledWith('/dashboard')
    expect(useNextTrackStore.getState().track).toBe('legacy')
    expect(useNextTrackStore.getState().source).toBe('shell_switch')
    const persisted = JSON.parse(localStorage.getItem('aiproj-next-track') ?? '{}')
    expect(persisted.state.track).toBe('legacy')
  })

  test('onBackToLegacy 覆盖时使用宿主回调，不再内部跳转', () => {
    const onBackToLegacy = vi.fn()
    renderTopbar({ onBackToLegacy })

    fireEvent.click(screen.getByRole('button', { name: /回到旧版/ }))

    expect(onBackToLegacy).toHaveBeenCalledTimes(1)
    expect(routerPush).not.toHaveBeenCalled()
  })

  test('快捷键联动：Ctrl+/ 唤起 AI 同事面板，Ctrl+M 呼出空间地图（onOpenSpaceMap）', () => {
    const onOpenSpaceMap = vi.fn()
    renderTopbar({ onOpenSpaceMap })

    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()

    // Ctrl+/ 唤起面板（Store toggleOpen 分发链路）
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)

    // 再按一次收起
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(onOpenSpaceMap).toHaveBeenCalledTimes(1)
  })

  test('DOM 与旧轨物理隔离：无旧顶栏/侧栏标记与旧文案', () => {
    renderTopbar()

    expect(document.querySelector('[data-topbar]')).toBeNull()
    expect(document.querySelector('[data-collapsed]')).toBeNull()
    expect(screen.queryByText(/项目列表/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /折叠侧栏/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /外观菜单/ })).not.toBeInTheDocument()
    // 新轨回到旧版入口标记保留（供壳层与旧版入口测试识别）
    expect(document.querySelector('[data-next-back-to-legacy]')).toBeTruthy()
  })
})
