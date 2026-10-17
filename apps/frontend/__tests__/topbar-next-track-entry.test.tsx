import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Topbar } from '@/components/layout/Topbar'
import { CommandPaletteProvider } from '@/components/layout/CommandPalette'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { useAuthStore } from '@/stores/auth-store'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'
import { accessTokenWith } from './_jwt-helper'

const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ canAny: () => false, can: () => false, canAll: () => false }),
}))

vi.mock('@/hooks/use-search', () => ({
  useSearchSuggestions: () => ({ data: { data: [] }, isLoading: false }),
}))

// Copilot readiness 与未读通知：不给真实网络请求（测试只关心入口可见性）。
vi.mock('@/lib/api/copilot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/copilot')>('@/lib/api/copilot')
  return {
    ...actual,
    copilotApi: {
      ...actual.copilotApi,
      readiness: vi.fn(() => new Promise(() => {})),
    },
  }
})

vi.mock('@/hooks/use-notifications', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-notifications')>(
    '@/hooks/use-notifications',
  )
  return {
    ...actual,
    useUnreadNotificationCount: () => ({ data: { unreadCount: 0 } }),
  }
})

function setFlag(main?: string, orgs?: string) {
  if (main === undefined) delete process.env[FF_NEXT_UI]
  else process.env[FF_NEXT_UI] = main
  if (orgs === undefined) delete process.env[FF_NEXT_UI_ORGS]
  else process.env[FF_NEXT_UI_ORGS] = orgs
}

function loginAs(organizationId: number) {
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: organizationId, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith([], { organizationId }),
      refreshToken: 'r',
      permissions: [],
      currentOrganizationId: organizationId,
      roleVersion: 1,
      isAuthenticated: true,
      hasHydrated: true,
    })
  })
}

function logout() {
  act(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: [],
      currentOrganizationId: null,
      roleVersion: 0,
      isAuthenticated: false,
      hasHydrated: true,
    })
  })
}

function renderTopbar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <CommandPaletteProvider>
          <Topbar
            scrollContainerRef={React.createRef<HTMLElement>() as React.RefObject<HTMLElement>}
          />
        </CommandPaletteProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  pushMock.mockReset()
  setFlag()
  logout()
  localStorage.clear()
  useNextTrackStore.getState().reset()
  ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
})

describe('顶栏「进入新页面」入口（v3-ui-next-track-foundation 任务 5.1/5.2）', () => {
  test('Flag 关闭时入口隐藏（即使已认证）', () => {
    setFlag('false', '1')
    loginAs(1)
    renderTopbar()
    expect(screen.queryByRole('button', { name: /进入新页面/ })).not.toBeInTheDocument()
  })

  test('未认证时入口隐藏（即使 Flag 全开）', () => {
    setFlag('true')
    renderTopbar()
    expect(screen.queryByRole('button', { name: /进入新页面/ })).not.toBeInTheDocument()
  })

  test('已认证且组织在白名单内 → 入口可见', () => {
    setFlag('org_allowlist', '1')
    loginAs(1)
    renderTopbar()
    expect(screen.getByRole('button', { name: /进入新页面/ })).toBeInTheDocument()
  })

  test('已认证但所在组织不在白名单 → 入口隐藏（组织间互不影响）', () => {
    setFlag('org_allowlist', '1')
    loginAs(2)
    renderTopbar()
    expect(screen.queryByRole('button', { name: /进入新页面/ })).not.toBeInTheDocument()
  })

  test('点击入口：持久化偏好 next（source topbar_button）并导航至 /next', () => {
    setFlag('true')
    loginAs(7)
    renderTopbar()

    fireEvent.click(screen.getByRole('button', { name: /进入新页面/ }))

    expect(useNextTrackStore.getState().track).toBe('next')
    expect(useNextTrackStore.getState().source).toBe('topbar_button')
    expect(pushMock).toHaveBeenCalledWith('/next')

    // 持久化契约同样生效（localStorage 可跨会话恢复）
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY)!) as {
      state: { track: string }
    }
    expect(persisted.state.track).toBe('next')
  })
})
