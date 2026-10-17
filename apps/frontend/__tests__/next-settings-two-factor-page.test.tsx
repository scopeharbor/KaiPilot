/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.11 —— 两步验证页入口装配测试
 * （spec「个人两步验证向导」要求 3，design D-2FA）。
 *
 * 覆盖：
 * - 页面装配渲染（薄壳挂载工作区，无额外权限门）；
 * - 登录骨架态（会话未水合 `aria-busy`）；
 * - 个人资料快捷入口直达本页（跨页语义一致性）。
 */
import * as React from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { twoFactorApi, type TwoFactorStatus } from '@/lib/api/two-factor'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import NextTwoFactorSettingsPage from '@/app/(next)/next/settings/security/two-factor/page'
import { ProfileWorkspace } from '@/components/next/settings/profile/ProfileWorkspace'

vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/settings/security/two-factor',
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

const ENABLED_STATUS: TwoFactorStatus = {
  state: 'active',
  enabled: true,
  pending: false,
  rebinding: false,
  label: 'iPhone',
  confirmedAt: '2026-09-01T02:00:00.000Z',
  lastUsedAt: '2026-09-04T01:00:00.000Z',
  recoveryCodesRemaining: 10,
}

function signIn(hasHydrated = true) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'ada@aiproj.local',
      fullName: 'Ada',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: 1,
    planTier: 'enterprise',
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  signIn()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('两步验证页（/next/settings/security/two-factor）', () => {
  test('页面装配：薄壳挂载工作区，无企业版门控、无权限门', async () => {
    vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)

    const { container } = render(<NextTwoFactorSettingsPage />)

    await waitFor(() =>
      expect(container.querySelector('[data-two-factor-workspace]')).not.toBeNull(),
    )
    // 本人账号能力：不出现受限横幅/企业版锁定文案
    expect(container.querySelector('[data-permission-fallback]')).toBeNull()
    expect(screen.queryByText('企业版能力')).toBeNull()
    // 不提供管理员重置他人 2FA 入口（该能力只在 /next/admin/users 高危区）
    expect(screen.queryByText(/重置他人|管理员重置/)).toBeNull()
  })

  test('登录骨架态：会话未水合时渲染 aria-busy 骨架', () => {
    const statusSpy = vi.spyOn(twoFactorApi, 'status').mockResolvedValue(ENABLED_STATUS)
    signIn(false)

    const { container } = render(<NextTwoFactorSettingsPage />)

    const skeleton = container.querySelector('[data-profile-skeleton], [data-two-factor-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    // 状态接口尚未调用（零业务请求）
    expect(statusSpy).not.toHaveBeenCalled()
  })

  test('个人资料快捷入口直达本页', () => {
    const { container } = render(<ProfileWorkspace />)
    const entry = container.querySelector('[data-profile-two-factor-entry]') as HTMLAnchorElement
    expect(entry.getAttribute('href')).toBe('/next/settings/security/two-factor')
  })
})
