import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { buildNavigationCommands } from '@/lib/command-registry/built-in/navigation'
import { CommandPaletteProvider, useCommandPalette } from '@/components/layout/CommandPalette'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { Toaster } from '@/components/ui/Toast'
import { selectDailyGreeting } from '@/lib/daily-greetings'
import { accessTokenWith } from './_jwt-helper'

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }))
const mockRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
let mockParams: Record<string, string | string[]> = { id: '1' }
let mockPathname = '/projects'
let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => mockParams,
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  redirect: mockRedirect,
}))

// —— next-themes mock —— //
const mockSetTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: mockSetTheme }),
}))

// —— usePermissions mock —— //
let grantedPermissions: string[] = []
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: grantedPermissions,
    canAny: (list: string[]) => list.some((p) => grantedPermissions.includes(p)),
    can: (p: string) => grantedPermissions.includes(p),
    hasPermission: (p: string) => grantedPermissions.includes(p),
    canAll: (list: string[]) => list.every((p) => grantedPermissions.includes(p)),
  }),
}))

// —— useSearchSuggestions mock —— //
vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

// cmdk 依赖 scrollIntoView（jsdom 不实现），补齐 polyfill。
beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
})

function loginAs(permissions: string[]) {
  grantedPermissions = permissions
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith(permissions, { organizationId: 1, roleVersion: 1 }),
      refreshToken: 'r',
      permissions,
      currentOrganizationId: 1,
      roleVersion: 1,
      isAuthenticated: true,
    })
  })
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {ui}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function PaletteOpener() {
  const { setOpen } = useCommandPalette()
  React.useEffect(() => {
    setOpen(true)
  }, [setOpen])
  return null
}

beforeEach(() => {
  grantedPermissions = []
  act(() => useAuthStore.getState().clear())
  useCommandRegistryStore.getState().clear()
  useCommandRegistryStore.getState().addCommands(buildNavigationCommands())
  mockPathname = '/projects'
  mockParams = { id: '1' }
  mockSearchParams = new URLSearchParams()
  mockRedirect.mockReset()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.back.mockReset()
  mockSetTheme.mockReset()
})

describe('AppShell 布局', () => {
  test('设置入口重定向到组织设置页', async () => {
    const { default: SettingsPage } = await import('@/app/(dashboard)/settings/page')
    SettingsPage()
    expect(mockRedirect).toHaveBeenCalledOnce()
    expect(mockRedirect).toHaveBeenCalledWith('/settings/profile')
  })

  test('Sidebar 无权限项不显示（权限过滤）', async () => {
    loginAs(['project:view']) // 有 project:view，无 project:create / task:view
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWithProviders(<Sidebar />)
    expect(screen.getByRole('link', { name: /项目列表/ })).toBeInTheDocument()
    // 无权限项不出现
    expect(screen.queryByRole('link', { name: /AI 快速创建/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^任务$/ })).not.toBeInTheDocument()
  })

  test('NavItem 选中态带 data-active 且带 aria-current', async () => {
    loginAs(['project:view'])
    mockPathname = '/projects'
    const { Sidebar } = await import('@/components/layout/Sidebar')
    renderWithProviders(<Sidebar />)
    const activeLink = screen.getByRole('link', { name: /项目列表/ })
    expect(activeLink.getAttribute('data-active')).toBe('true')
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    // 未选中的项没有 data-active
    const helpLink = screen.getByRole('link', { name: /帮助与文档/ })
    expect(helpLink.getAttribute('data-active')).toBeNull()
  })

  test('ProjectTabs 高亮当前视图 Tab', async () => {
    mockPathname = '/projects/1/gantt'
    const { ProjectTabs } = await import('@/components/layout/ProjectTabs')
    renderWithProviders(<ProjectTabs />)
    const activeLink = screen.getByRole('link', { name: /甘特图/ })
    expect(activeLink.getAttribute('data-state')).toBe('active')
    expect(activeLink.getAttribute('aria-current')).toBe('page')
    const kanbanLink = screen.getByRole('link', { name: /看板/ })
    expect(kanbanLink.getAttribute('data-state')).toBe('inactive')
  })

  test('CommandPalette 无权限跳转项不出现', async () => {
    loginAs(['project:view'])
    renderWithProviders(
      <CommandPaletteProvider>
        <PaletteOpener />
      </CommandPaletteProvider>,
    )
    expect(await screen.findByText(/项目列表/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/AI 快速创建/)).not.toBeInTheDocument()
  })

  test('侧栏内的折叠开关切换折叠，按钮名与 aria-expanded 随状态变化', async () => {
    loginAs(['project:view'])
    const { SidebarCollapseToggle } = await import('@/components/layout/Sidebar')
    const { useUiStore } = await import('@/stores/ui-store')
    act(() => useUiStore.getState().setSidebarCollapsed(false))

    renderWithProviders(<SidebarCollapseToggle />)
    const collapseBtn = screen.getByRole('button', { name: '折叠侧栏' })
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(collapseBtn)

    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
    const expandBtn = screen.getByRole('button', { name: '展开侧栏' })
    expect(expandBtn.getAttribute('aria-expanded')).toBe('false')

    act(() => useUiStore.getState().setSidebarCollapsed(false))
  })

  test('平板强制折叠与移动抽屉形态不出现折叠控件；只有移动抽屉带首页品牌行', async () => {
    loginAs(['project:view'])
    const { Sidebar } = await import('@/components/layout/Sidebar')
    const desktop = renderWithProviders(<Sidebar />)
    expect(screen.getByRole('button', { name: '折叠侧栏' })).toBeInTheDocument()
    desktop.unmount()
    const { unmount } = renderWithProviders(<Sidebar forceCollapsed />)
    expect(screen.queryByRole('button', { name: /侧栏/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /开项 KaiPilot 首页/ })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(<Sidebar forceCollapsed={false} showBrand />)
    expect(screen.getByRole('link', { name: /开项 KaiPilot 首页/ })).toBeInTheDocument()
  })

  test('侧栏折叠命令已注册且快捷键不占用保留和弦', async () => {
    const { buildLayoutCommands } = await import('@/lib/command-registry/built-in/layout')
    const { parseShortcutInput, isReserved } = await import('@/lib/command-registry/shortcut')
    const { useUiStore } = await import('@/stores/ui-store')

    const [toggle] = buildLayoutCommands()
    expect(toggle?.id).toBe('layout.toggleSidebar')
    expect(toggle?.effect).toBe('ui-setting')

    const chord = parseShortcutInput(toggle!.shortcut!)
    expect(chord).not.toBeNull()
    // Cmd/Ctrl+B 在 RESERVED_CHORDS 内，默认键位不得落在保留和弦上。
    expect(isReserved(chord!)).toBe(false)

    act(() => useUiStore.getState().setSidebarCollapsed(false))
    act(() => toggle!.execute({ pathname: '/', params: {}, searchParams: new URLSearchParams() }))
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
    act(() => useUiStore.getState().setSidebarCollapsed(false))
  })

  test('Dashboard 顶栏显示基础问候、日常短句和日期', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 6, 11, 12, 30)
    vi.setSystemTime(now)
    loginAs(['project:view'])
    mockPathname = '/dashboard'
    const expectedDailyGreeting = selectDailyGreeting({ date: now, userKey: '测试用户' })
    const { Breadcrumb } = await import('@/components/layout/Breadcrumb')

    renderWithProviders(<Breadcrumb />)

    try {
      expect(screen.getByText('中午好，测试用户')).toBeInTheDocument()
      expect(screen.getByText(expectedDailyGreeting.text)).toBeInTheDocument()
      expect(screen.getByText('7月11日 周六')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
