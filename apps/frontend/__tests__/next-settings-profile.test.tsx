/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.8 —— 个人资料页与偏好入口测试
 * （spec「个人资料与新旧 UI 轨偏好入口」，design D-PREF / D2）。
 *
 * 覆盖：
 * - 只读身份/组织渲染（姓名、邮箱、超管徽标、组织列表 + 当前标记 + 角色标签）；
 * - 点击「回到旧版」断言 `setTrack('legacy','settings_profile')` 与跳转 `/settings/profile`；
 * - 2FA 快捷入口链接；
 * - 未水合骨架态（`aria-busy`）；
 * - 断言页面零业务写请求。
 */
import * as React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore, type PlanTier } from '@/stores/auth-store'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'
import { ProfileWorkspace } from '@/components/next/settings/profile/ProfileWorkspace'
import NextSettingsProfilePage from '@/app/(next)/next/settings/profile/page'

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/profile',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

const ORGANIZATIONS = [
  { id: 1, name: '北极星研发部', slug: 'northstar', role: 'owner' },
  { id: 2, name: '客户交付中心', slug: 'delivery', role: 'viewer' },
]

function setAuth(
  options: {
    hasHydrated?: boolean
    isSuperAdmin?: boolean
    planTier?: PlanTier | null
    organizations?: typeof ORGANIZATIONS
    currentOrganizationId?: number | null
  } = {},
) {
  const {
    hasHydrated = true,
    isSuperAdmin = false,
    planTier = 'enterprise',
    organizations = ORGANIZATIONS,
    currentOrganizationId = 1,
  } = options

  useAuthStore.setState({
    user: {
      id: 7,
      email: 'ada@aiproj.local',
      fullName: 'Ada Lovelace',
      initials: 'AL',
      isSuperAdmin,
      organizations,
    },
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function installFetchSpy(label = '个人资料页不应发起任何业务请求') {
  const fetchSpy = vi.fn(async () => {
    throw new Error(label)
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  navMock.push.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  setAuth()
  useNextTrackStore.setState({ track: 'next', source: 'next_login', immersionTier: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ track: 'legacy', source: null, immersionTier: null })
})

describe('个人资料页（/next/settings/profile）', () => {
  test('只读渲染身份信息与所属组织（含当前组织标记与角色标签）', () => {
    const fetchSpy = installFetchSpy()
    const { container } = render(<ProfileWorkspace />)

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('ada@aiproj.local')).toBeTruthy()
    expect(container.querySelector('[data-profile-initials]')?.textContent).toBe('AL')

    // 所属组织两条 + 当前标记只在组织 1 上
    expect(container.querySelectorAll('[data-profile-organization]')).toHaveLength(2)
    expect(container.querySelector('[data-profile-organization-current="1"]')?.textContent).toBe(
      '当前',
    )
    expect(container.querySelector('[data-profile-organization-current="2"]')).toBeNull()

    // 角色标签映射（owner → 所有者 / viewer → 只读）
    expect(container.querySelector('[data-profile-organization-role="1"]')?.textContent).toBe(
      '所有者',
    )
    expect(container.querySelector('[data-profile-organization-role="2"]')?.textContent).toBe(
      '只读',
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('系统管理员展示徽标；普通用户不展示', () => {
    setAuth({ isSuperAdmin: true })
    const first = render(<ProfileWorkspace />)
    expect(first.container.querySelector('[data-profile-super-admin-badge]')).not.toBeNull()
    first.unmount()

    setAuth({ isSuperAdmin: false })
    const second = render(<ProfileWorkspace />)
    expect(second.container.querySelector('[data-profile-super-admin-badge]')).toBeNull()
  })

  test('无组织时渲染中性空态', () => {
    setAuth({ organizations: [], currentOrganizationId: null })
    const { container } = render(<ProfileWorkspace />)
    expect(container.querySelector('[data-profile-organizations-empty]')?.textContent).toContain(
      '尚未加入任何组织',
    )
  })

  test('点击「回到旧版」写入 aiproj-next-track 偏好并跳转 /settings/profile', () => {
    const fetchSpy = installFetchSpy()
    const { container } = render(<ProfileWorkspace />)

    expect(container.querySelector('[data-profile-track-state="next"]')?.textContent).toBe(
      '新页面生效中',
    )

    fireEvent.click(container.querySelector('[data-profile-back-to-legacy]') as HTMLElement)

    // 偏好契约：track=legacy、source=settings_profile（与旧轨 Topbar 同一 localStorage 键）
    expect(useNextTrackStore.getState().track).toBe('legacy')
    expect(useNextTrackStore.getState().source).toBe('settings_profile')
    expect(localStorage.getItem(NEXT_TRACK_STORAGE_KEY)).toContain('legacy')

    // 跳转旧轨个人资料页（绝不自动重定向）
    expect(navMock.push).toHaveBeenCalledWith('/settings/profile')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('两步验证快捷入口指向 /next/settings/security/two-factor', () => {
    const { container } = render(<ProfileWorkspace />)
    const entry = container.querySelector('[data-profile-two-factor-entry]') as HTMLAnchorElement
    expect(entry).not.toBeNull()
    expect(entry.getAttribute('href')).toBe('/next/settings/security/two-factor')
    // 同一语义的两处入口：页面入口与侧栏一致（本页不提供管理员重置他人 2FA）
    expect(screen.queryByText(/重置他人|管理员重置/)).toBeNull()
  })

  test('未水合态渲染 aria-busy 骨架且零请求', () => {
    const fetchSpy = installFetchSpy()
    setAuth({ hasHydrated: false })

    const { container } = render(<ProfileWorkspace />)

    const skeleton = container.querySelector('[data-profile-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(container.querySelector('[data-profile-workspace]')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('会话水合后骨架退场（unmount + remount 范式）', () => {
    setAuth({ hasHydrated: false })
    const first = render(<ProfileWorkspace />)
    expect(first.container.querySelector('[data-profile-skeleton]')).not.toBeNull()
    first.unmount()

    setAuth({ hasHydrated: true })
    const second = render(<ProfileWorkspace />)
    expect(second.container.querySelector('[data-profile-skeleton]')).toBeNull()
    expect(second.container.querySelector('[data-profile-workspace]')).not.toBeNull()
  })

  test('页面装配：个人资料页薄壳挂载工作区且零业务写请求', () => {
    const fetchSpy = installFetchSpy()
    const { container } = render(<NextSettingsProfilePage />)
    expect(container.querySelector('[data-profile-workspace]')).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('精确档剥离氛围光晕与动效', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = render(<ProfileWorkspace />)
    const workspace = container.querySelector('[data-profile-workspace]') as HTMLElement
    expect(workspace.getAttribute('data-immersion')).toBe('precise')
    expect(workspace.className).not.toContain('nx-space-atmosphere')
    expect(workspace.innerHTML).not.toMatch(/\btransition-(colors|transform)\b/)
  })
})
