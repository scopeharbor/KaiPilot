/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.6 —— 设置门户检索与节卡渲染测试
 * （spec「设置空间门户与信息架构」要求 1/2/3，design D-IA / D-PERM / RL-06）。
 *
 * 覆盖：
 * - 检索「密钥」即时收敛出 KMS 节卡并点击直达 `/next/settings/security/kms`；
 * - 无权限用户门户不渲染企业节卡且底层数据接口 0 请求（RL-06）；
 * - 免费档锁定占位渲染且 0 请求；
 * - 零可用节空态与骨架屏（`aria-busy`）。
 */
import * as React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore, type PlanTier } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { SettingsLandingHub } from '@/components/next/settings/SettingsLandingHub'

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings',
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
  planTier: PlanTier = 'enterprise',
  hasHydrated = true,
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'ada@aiproj.local',
      fullName: 'Ada',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function installFetchSpy() {
  const fetchSpy = vi.fn(async () => {
    throw new Error('门户页面不应发起任何请求')
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

beforeEach(() => {
  navMock.push.mockReset()
  setAuth()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('设置空间门户（/next/settings）', () => {
  test('无权限用户门户不渲染企业节卡且底层数据接口 0 请求（RL-06）', () => {
    const fetchSpy = installFetchSpy()
    setAuth(['org:view'], 'enterprise')

    const { container } = render(<SettingsLandingHub />)

    const ids = Array.from(container.querySelectorAll('[data-settings-section-card]')).map((node) =>
      node.getAttribute('data-settings-section-card'),
    )
    expect(ids).toEqual([
      'personal-profile',
      'personal-two-factor',
      'organization-settings',
      'presentation-calendar',
      'presentation-interface',
    ])
    for (const id of ['security-kms', 'security-sso', 'security-dlp', 'security-compliance']) {
      expect(container.querySelector(`[data-settings-section-card="${id}"]`)).toBeNull()
      expect(container.querySelector(`[data-settings-section-locked="${id}"]`)).toBeNull()
    }

    // 检索也不得命中无权节
    fireEvent.change(screen.getByLabelText('检索设置节'), { target: { value: '密钥' } })
    expect(screen.getByText('没有匹配的设置节')).toBeTruthy()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('零可用节渲染中性空态并提供返回角色首页', () => {
    const fetchSpy = installFetchSpy()
    // 注册表边界：注入一个空白名单（等价「本组织无任何可进入设置节」的真实边界）。
    const { container } = render(<SettingsLandingHub registry={[]} />)

    expect(container.querySelector('[data-settings-landing-empty]')).not.toBeNull()
    expect(screen.getByText('暂无可管理内容')).toBeTruthy()

    fireEvent.click(
      container.querySelector('[data-settings-landing-empty-back-home]') as HTMLElement,
    )
    expect(navMock.push).toHaveBeenCalledWith('/next')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('骨架屏：会话未水合时渲染 aria-busy 骨架且零请求', () => {
    const fetchSpy = installFetchSpy()
    setAuth(ALL_SETTINGS_PERMISSIONS, 'enterprise', false)

    const { container } = render(<SettingsLandingHub />)

    const skeleton = container.querySelector('[data-settings-landing-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(skeleton?.getAttribute('role')).toBe('status')
    // 水合前不得渲染任何节卡（否则空权限集会闪出错误空态）
    expect(container.querySelectorAll('[data-settings-section-card]')).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('精确档剥离氛围光晕（纯色仪器面板）', () => {
    installFetchSpy()
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = render(<SettingsLandingHub />)
    const hub = container.querySelector('[data-settings-landing-hub]') as HTMLElement
    expect(hub.getAttribute('data-immersion')).toBe('precise')
    expect(hub.className).not.toContain('nx-space-atmosphere')
    expect(hub.innerHTML).not.toMatch(/\btransition-(colors|transform)\b/)
  })
})
