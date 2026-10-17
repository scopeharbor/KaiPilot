import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NextRouteLayout from '@/app/(next)/layout'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

/** 放行场景渲染新轨 Shell（顶栏 W4 装配 AI 同事面板，依赖 QueryClient）。 */
function renderLayout(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextRouteLayout>{children}</NextRouteLayout>
    </QueryClientProvider>,
  )
}

function setFlag(main?: string, orgs?: string) {
  if (main === undefined) delete process.env[FF_NEXT_UI]
  else process.env[FF_NEXT_UI] = main
  if (orgs === undefined) delete process.env[FF_NEXT_UI_ORGS]
  else process.env[FF_NEXT_UI_ORGS] = orgs
}

function loginAs(organizationId: number | null) {
  act(() => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations:
          organizationId == null
            ? []
            : [{ id: organizationId, name: '测试工作区', slug: 'test', role: 'owner' }],
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

beforeEach(() => {
  replaceMock.mockReset()
  setFlag()
  act(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: [],
      currentOrganizationId: null,
      roleVersion: 0,
      isAuthenticated: false,
      hasHydrated: false,
    })
  })
})

afterEach(() => {
  setFlag()
})

describe('新轨路由守卫（v3-ui-next-track-foundation tasks 4.1/4.2）', () => {
  test('认证水合中：渲染骨架占位，不触发任何重定向', () => {
    setFlag('true')
    renderLayout(<p>不应渲染</p>)
    expect(screen.getByText(/正在加载新页面/)).toBeInTheDocument()
    expect(screen.queryByText('不应渲染')).not.toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  test('水合完成后未认证 → 重定向至新 UI 登录页（携带 next）', async () => {
    setFlag('true')
    renderLayout(<p>不应渲染</p>)
    act(() => {
      useAuthStore.setState({ hasHydrated: true, isAuthenticated: false })
    })
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next-login?next=%2Fnext'))
    expect(screen.queryByText('不应渲染')).not.toBeInTheDocument()
  })

  test('已认证但组织 Flag 关闭 → 重定向至旧 UI 仪表盘', async () => {
    setFlag('false', '1')
    loginAs(1)
    renderLayout(<p>不应渲染</p>)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
    expect(screen.queryByText('不应渲染')).not.toBeInTheDocument()
  })

  test('未配白名单且组织不在白名单 → 同样踢回旧 UI（组织间互不影响）', async () => {
    setFlag('org_allowlist', '1')
    loginAs(2)
    renderLayout(<p>不应渲染</p>)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
    expect(replaceMock).not.toHaveBeenCalledWith(expect.stringContaining('/next-login'))
  })

  test('已认证且组织 Flag 开启 → 正常放行并渲染新轨 Shell', async () => {
    setFlag('true')
    loginAs(1)
    renderLayout(<p data-testid="next-content">新轨内容</p>)
    await waitFor(() => expect(screen.getByTestId('next-content')).toBeInTheDocument())
    expect(document.querySelector('[data-next-track]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /回到旧版/ })).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  test('组织切换后 Flag 失效（Stale Flag）→ 立即踢回旧 UI', async () => {
    setFlag('org_allowlist', '1')
    loginAs(1)
    const { rerender } = renderLayout(<p data-testid="next-content">新轨内容</p>)
    await waitFor(() => expect(screen.getByTestId('next-content')).toBeInTheDocument())
    replaceMock.mockReset()

    // 用户切换到组织 B（不在白名单）：守卫重新评估并重定向。
    loginAs(2)
    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextRouteLayout>
          <p data-testid="next-content">新轨内容</p>
        </NextRouteLayout>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
  })
})
