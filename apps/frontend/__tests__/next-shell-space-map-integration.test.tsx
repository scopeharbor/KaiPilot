/**
 * v3-ui-next-shell-space-map tasks 4.1/4.2 —— 壳装配集成全链路测试。
 *
 * 覆盖：顶栏坐标回显与四入口、顶栏按钮呼出空间地图 → 检索过滤 → 可用坐标直达导航 →
 * 置灰项禁点、Ctrl+/ 仅唤起 AI 同事面板（旧 Copilot 面板保持关闭）、Ctrl+M 呼出地图、
 * 可编辑目标抑制（地图搜索框内 Ctrl+/ 不误触面板）、沉浸三档切换联动 data-immersion、
 * 回到旧版偏好持久化与跳转、Portal 重挂令牌作用域（开图时 [data-next-track] 出现 2 个）。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import NextHomePage from '@/app/(next)/next/page'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCopilotStore } from '@/stores/copilot-store'

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

/** 认证水合完成 + 未登录 → unknown 桶通用欢迎语（与 next-route-group 同一阵容）。 */
function resetAuthState() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  routerPush.mockClear()
  navMocks.pathname = '/next'
  localStorage.clear()
  useNextTrackStore.getState().reset()
  document.documentElement.removeAttribute('data-immersion')
  resetAuthState()
  useCopilotStore.setState({ open: false })
  // W4 总装：AI 同事 Store 持久于模块级（zustand 非卸载重置），用例间必须闭合面板
  useNextAiColleagueStore.setState({ isOpen: false, messages: [], executionState: 'idle' })
})

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextAppShell>
        <NextHomePage />
      </NextAppShell>
    </QueryClientProvider>,
  )
}

describe('NextAppShell 装配集成（v3-ui-next-shell-space-map tasks 4.1/4.2）', () => {
  test('常驻顶栏：品牌 + 坐标回显 + 四入口齐备，首页角色化容器联通，令牌作用域单个', () => {
    renderShell()

    expect(screen.getByText('开项 KaiPilot')).toBeInTheDocument()
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe('/next · 角色首页')

    expect(screen.getByRole('heading', { name: '开项项目空间' })).toBeInTheDocument()
    expect(screen.getByText(/访客视角/)).toBeInTheDocument()

    expect(screen.getByRole('group', { name: '沉浸档位切换' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /空间地图/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI 唤起/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /回到旧版/ })).toBeInTheDocument()

    // Overlay 未打开：仅壳根挂 [data-next-track]（Portal 重挂发生在开图后）
    expect(document.querySelectorAll('[data-next-track]')).toHaveLength(1)
  })

  test('顶栏按钮呼出空间地图：搜索即时过滤 → 空状态 → 点击可用坐标关闭并直达导航', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /空间地图/ }))

    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toHaveAttribute('aria-label', '空间地图')
    // 唤起即聚焦搜索框（design D2）
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索空间坐标' }))
    // W2 注意点：Portal 逃逸令牌作用域后重挂 [data-next-track]，此时出现 2 个
    expect(document.querySelectorAll('[data-next-track]')).toHaveLength(2)

    // 完整白名单全部可用可点（生成剧场/图表馆均已点亮为 available）
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /生成剧场/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /图表馆/ })).toBeEnabled()

    // 即时过滤
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '首页' } })
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /生成剧场/ })).not.toBeInTheDocument()

    // 无结果空状态
    fireEvent.change(input, { target: { value: '未知坐标XYZ' } })
    expect(screen.getByText('未找到匹配的空间坐标')).toBeInTheDocument()

    // 恢复命中项 → 点击可用坐标：关闭薄层 + 无刷新路由跳转
    fireEvent.change(input, { target: { value: '首页' } })
    fireEvent.click(screen.getByRole('button', { name: /角色首页/ }))
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/next')
    expect(document.querySelectorAll('[data-next-track]')).toHaveLength(1)
  })

  test('Ctrl+M 呼出空间地图，Esc 关闭；坐标随路由切换回显', () => {
    const view = renderShell()

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: '空间地图' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()

    // 坐标回显随 pathname 联动（预置坐标与深层兜底）
    navMocks.pathname = '/next/charts'
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextAppShell>
          <NextHomePage />
        </NextAppShell>
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
      '/next/charts · 图表馆',
    )
    navMocks.pathname = '/next/foo/bar'
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextAppShell>
          <NextHomePage />
        </NextAppShell>
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
      '/next/foo/bar · 空间探索',
    )
  })

  test('Ctrl+/ 只唤起 AI 同事面板：旧 Copilot 面板保持关闭，地图搜索框内不误触', () => {
    renderShell()

    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()
    // 新轨绝不触发旧 Copilot 侧栏（注册表 when 守卫 + 壳层不挂旧调度的双层保证）
    expect(useCopilotStore.getState().open).toBe(false)

    // 可编辑目标抑制：空间地图搜索框聚焦时 Ctrl+/ 不切换面板
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: '空间地图' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: '/', ctrlKey: true })
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)
    expect(useCopilotStore.getState().open).toBe(false)

    // Esc 只关最上层：模态层打开时 AI 面板不应被连带关闭
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'AI 同事交互面板' })).toBeInTheDocument()

    // 焦点回到页面后 Ctrl+/ 再按一次收起面板
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'AI 同事交互面板' })).not.toBeInTheDocument()
  })

  test('沉浸三档切换联动：data-immersion 与 localStorage 即时同步，精确档下地图仍可用', () => {
    renderShell()

    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')

    fireEvent.click(screen.getByRole('button', { name: '轻量' }))
    expect(document.documentElement.getAttribute('data-immersion')).toBe('light')
    expect(screen.getByRole('button', { name: '轻量' })).toHaveAttribute('aria-pressed', 'true')
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY) ?? '{}')
    expect(persisted.state.immersionTier).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: '精确' }))
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    expect(screen.getByRole('button', { name: '精确' })).toHaveAttribute('aria-pressed', 'true')

    // 精确档只降级呈现浓度（CSS 层），不改变交互：地图仍可呼出
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: '空间地图' })).toBeInTheDocument()
  })

  test('回到旧版全链路：偏好持久化为 legacy（source=shell_switch）并跳转 /dashboard', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: /回到旧版/ }))

    expect(routerPush).toHaveBeenCalledWith('/dashboard')
    expect(useNextTrackStore.getState().track).toBe('legacy')
    expect(useNextTrackStore.getState().source).toBe('shell_switch')
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY) ?? '{}')
    expect(persisted.state.track).toBe('legacy')
  })
})
