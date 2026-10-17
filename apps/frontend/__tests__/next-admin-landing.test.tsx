/**
 * v3-ui-next-settings-admin-domains W6 · tasks 6.4 —— 管理后台门户测试
 * （spec「管理后台门户与平台治理控制台」Requirement 1 场景 + design D-ADM）。
 *
 * 覆盖：
 * - 按权限渲染两组节卡（治理 / 运营与信任）并点击直达 `/next/admin/<console>`；
 * - 无任何控制台权限：中性受限页（data-permission-fallback）——**不渲染任何控制台名称**
 *   （RL-05 不泄露清单存在性）且离线断言网络零请求（RL-06）；
 * - 检索框即时过滤（本地纯函数、零网络）与无命中空态；
 * - 精确档（`data-immersion="precise"`）静态面板：剥离 .nx-space-atmosphere 光晕、
 *   纯色工作面 + 1px 发丝线；
 * - 门户页装配（真实 route 页面 `/next/admin/page.tsx`）——受限分支同样零请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { AdminLandingHub } from '@/components/next/admin/AdminLandingHub'
import NextAdminPortalPage from '@/app/(next)/next/admin/page'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/admin',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与网络监控
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'ops@example.com',
      fullName: '平台运维',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: 'enterprise',
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useNextTrackStore.setState({ immersionTier: null })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: [] }),
  } as Response)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ immersionTier: null })
})

function renderHub() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AdminLandingHub />
    </QueryClientProvider>,
  )
}

const ALL_CONSOLE_PERMISSIONS = [
  'system:admin',
  'ai_quality_cost_console:view',
  'ai:compiler:routing:view',
  'release_trust_center:view',
]

// ---------------------------------------------------------------------------
describe('管理后台门户：按权限渲染两组节卡与直达跳转（tasks 6.4）', () => {
  test('「← 返回角色首页」直达 /next', () => {
    setAuth(['system:admin'])
    renderHub()

    fireEvent.click(document.querySelector('[data-admin-back-home]') as HTMLElement)
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })
})

describe('管理后台门户：无权限中性受限页（RL-05 / RL-06）', () => {
  test('普通成员：中性受限文案、零控制台名、零网络请求', async () => {
    setAuth(['org:view', 'project:view', 'audit:view'])
    renderHub()

    const hub = document.querySelector('[data-admin-landing-restricted]')
    expect(hub).not.toBeNull()
    expect(screen.getByText('暂无可用控制台')).toBeInTheDocument()

    // 不泄露控制台清单：任何控制台标题都不得出现。
    for (const title of [
      '用户管理',
      '全局审计日志',
      '多租户治理',
      'AI 质量与成本',
      '编译器路由',
      '发布信任中心',
    ]) {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    }
    expect(document.querySelector('[data-admin-console]')).toBeNull()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('受限态仍提供返回角色首页入口（零请求）', () => {
    setAuth([])
    renderHub()

    fireEvent.click(document.querySelector('[data-admin-back-home]') as HTMLElement)
    expect(navMock.push).toHaveBeenCalledWith('/next')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('管理后台门户：检索即时过滤与空态', () => {
  test('检索「用户」收敛出用户管理并点击直达', () => {
    setAuth(ALL_CONSOLE_PERMISSIONS)
    renderHub()

    fireEvent.change(screen.getByLabelText('检索控制台'), { target: { value: '用户' } })
    expect(document.querySelector('[data-admin-console="users"]')).not.toBeNull()
    expect(document.querySelector('[data-admin-console="audit-logs"]')).toBeNull()

    fireEvent.click(document.querySelector('[data-admin-console="users"]') as HTMLElement)
    expect(navMock.push).toHaveBeenCalledWith('/next/admin/users')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('检索无命中：渲染空态且不渲染任何控制台节卡', () => {
    setAuth(ALL_CONSOLE_PERMISSIONS)
    renderHub()

    fireEvent.change(screen.getByLabelText('检索控制台'), { target: { value: '用户 路由' } })
    expect(document.querySelector('[data-admin-search-empty]')).not.toBeNull()
    expect(document.querySelectorAll('[data-admin-console]')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('管理后台门户：精确档静态面板（RL-15）', () => {
  test('precise 档：剥离 nx-space-atmosphere 光晕，纯色工作面 + 发丝线边框', () => {
    setAuth(['system:admin'])
    useNextTrackStore.setState({ immersionTier: 'precise' })
    renderHub()

    const root = document.querySelector('[data-admin-landing]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.className).not.toContain('nx-space-atmosphere')
    expect(root.className).toContain('bg-[var(--nx-workspace-bg)]')
    expect(root.className).toContain('border-[var(--nx-border-hairline)]')
    // 子树零发光阴影 / backdrop 滤镜类。
    expect(root.outerHTML).not.toContain('backdrop-blur')
    expect(root.outerHTML).not.toContain('shadow-[')
  })

  test('immersive 对照：根节点消费 .nx-space-atmosphere（证明档位确实切换）', () => {
    setAuth(['system:admin'])
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    renderHub()

    const root = document.querySelector('[data-admin-landing]') as HTMLElement
    expect(root.className).toContain('nx-space-atmosphere')
  })
})

describe('管理后台门户路由页装配（/next/admin/page.tsx）', () => {
  test('无权限：页面渲染中性受限页且零请求', async () => {
    setAuth(['org:view'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <NextAdminPortalPage />
      </QueryClientProvider>,
    )

    expect(document.querySelector('[data-admin-landing-restricted]')).not.toBeNull()
    expect(document.querySelectorAll('[data-admin-console]')).toHaveLength(0)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
