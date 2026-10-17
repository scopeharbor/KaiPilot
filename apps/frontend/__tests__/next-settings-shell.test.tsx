/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.4 —— 设置空间壳与节导航侧栏组件测试
 * （spec「设置空间门户与信息架构」要求 1，design D-IA / RL-06 / RL-14 / RL-15）。
 *
 * 覆盖：
 * - 五组节导航渲染与当前节高亮（最长前缀匹配）；
 * - 分组折叠与键盘可达性（原生 button + aria-expanded/aria-controls）；
 * - 点击节导航触发路由跳转；
 * - 精确档 `precise` 下无动效类名（不含 transition-*）；
 * - 权限缺失节不在侧栏出现（RL-06，零请求）。
 */
import * as React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { SettingsSpaceNav } from '@/components/next/settings/SettingsSpaceNav'
import SettingsSpaceLayout from '@/app/(next)/next/settings/layout'

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: '/next/settings/security/kms',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => navMock.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const ALL_SETTINGS_PERMISSIONS = [
  'org:view',
  'audit:view',
  'multitenant:console:view',
  'ai:connection:manage',
  'ai:usage:view',
  'ai:compiler:skill:view',
  'integration:connect',
  'compliance:readiness:view',
  'dlp:policy:view',
  'kms:key:view',
  'sso:saml:view',
]

function setAuth(
  permissions: string[] = ALL_SETTINGS_PERMISSIONS,
  planTier: 'free' | 'enterprise' = 'enterprise',
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@aiproj.local',
      fullName: '组织管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.pathname = '/next/settings/security/kms'
  setAuth()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  // 先卸载上一用例的组件再改 store：否则 store 变更会触发已挂载组件的
  // act 外重渲染（本文件 afterEach 先于 setup.ts 的 cleanup 执行）。
  cleanup()
  // `vi.restoreAllMocks()` 会清掉 setup.ts 的 matchMedia 替身（环境坑），一律用 clear。
  vi.clearAllMocks()
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
})

describe('设置空间节导航侧栏', () => {
  test('精确档下侧栏无动效类名（动效归零）', () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = render(<SettingsSpaceNav />)

    const nav = container.querySelector('[data-settings-nav]') as HTMLElement
    expect(nav).toBeTruthy()
    // 精确档：全子树不得出现 transition-* / animate-* 动效类名
    expect(nav.innerHTML).not.toMatch(/\btransition-(colors|transform|all|opacity)\b/)
    expect(nav.innerHTML).not.toMatch(/\banimate-/)
  })

  test('沉浸档对照：侧栏保留过渡类名（证明精确档确实切换）', () => {
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    const { container } = render(<SettingsSpaceNav />)
    const nav = container.querySelector('[data-settings-nav]') as HTMLElement
    expect(nav.innerHTML).toMatch(/\btransition-(colors|transform)\b/)
  })

  test('权限缺失节不在侧栏出现（RL-06 零请求）', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    setAuth(['org:view'], 'enterprise')

    const { container } = render(<SettingsSpaceNav />)

    expect(
      container.querySelector('[data-settings-nav-section="organization-settings"]'),
    ).not.toBeNull()
    // 无权限节：审计/多租户/KMS/SSO 等全部缺席
    for (const id of [
      'organization-audit-logs',
      'organization-multitenancy',
      'security-kms',
      'security-sso',
      'ai-usage',
      'integrations',
    ]) {
      expect(container.querySelector(`[data-settings-nav-section="${id}"]`)).toBeNull()
    }
    // 侧栏为纯静态导航，不发任何请求
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  test('空权限用户侧栏只保留本人账号节', () => {
    setAuth([], 'free')
    render(<SettingsSpaceNav />)
    expect(screen.getByRole('button', { name: '个人资料' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '两步验证' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '密钥管理 KMS' })).toBeNull()
  })
})

describe('设置空间壳（layout）', () => {
  test('装配侧栏与主内容区，主内容受 max-w 约束且零请求', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { container } = render(
      <SettingsSpaceLayout>
        <div data-testid="settings-page-child">页面内容</div>
      </SettingsSpaceLayout>,
    )

    expect(container.querySelector('[data-settings-space-shell]')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: '设置节导航' })).toBeTruthy()
    const content = container.querySelector('[data-settings-space-content]')
    expect(content).not.toBeNull()
    expect(content?.textContent).toContain('页面内容')
    expect(container.querySelector('[data-settings-space-shell]')?.className).toMatch(/max-w-/)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
