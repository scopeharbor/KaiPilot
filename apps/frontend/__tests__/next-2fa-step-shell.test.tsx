import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTwoFactorStepShell } from '@/components/next/auth/NextTwoFactorStepShell'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'

const replaceMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  usePathname: () => '/2fa/challenge',
}))

function installMatchMediaMock() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const NEXT_TOKENS_PATH = join(process.cwd(), 'app/(next)/next-tokens.css')

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace('#', '')
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((c) => c / 255)
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return (
    0.2126 * linear(channels[0]!) + 0.7152 * linear(channels[1]!) + 0.0722 * linear(channels[2]!)
  )
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function seedChallenge(
  overrides: {
    challengeToken?: string
    expiresAt?: string
    purpose?: 'verify' | 'enroll'
    skippable?: boolean
    methods?: ('totp' | 'recovery_code')[]
    nextPath?: string
  } = {},
) {
  useTwoFactorChallengeStore.getState().start({
    challengeToken: overrides.challengeToken ?? 'challenge-token-test',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    purpose: overrides.purpose ?? 'verify',
    skippable: overrides.skippable ?? false,
    methods: overrides.methods ?? ['totp', 'recovery_code'],
    nextPath: overrides.nextPath ?? '/dashboard',
  })
  useTwoFactorChallengeStore.getState().setHasHydrated(true)
}

describe('2FA 深空外壳容器与暗黑仪器令牌测试 (NextTwoFactorStepShell)', () => {
  beforeEach(() => {
    installMatchMediaMock()
    sessionStorage.clear()
    localStorage.clear()
    useAuthStore.getState().clear()
    useTwoFactorChallengeStore.getState().clear()
    useNextTrackStore.getState().reset()
    document.documentElement.removeAttribute('data-immersion')
    replaceMock.mockReset()
    refreshMock.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
            otpauthUri: 'otpauth://totp/Issuer:user@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP',
            digits: 6,
            period: 30,
            algorithm: 'SHA1',
          },
        }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-immersion')
  })

  test('深空背景与暗黑仪器令牌正确映射 (Layer 1 深空 + Layer 2 工作面)', () => {
    seedChallenge({ purpose: 'verify' })
    const { container } = render(<NextTwoFactorStepShell expected="verify" />)

    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    expect(main?.hasAttribute('data-next-track')).toBe(true)
    expect(main?.className).toContain('nx-space-atmosphere')
    expect(main?.className).toContain('bg-[var(--nx-space-bg)]')

    // Layer 2 暗黑仪器卡片
    const card = main?.querySelector('.rounded-xl')
    expect(card).not.toBeNull()
    expect(card?.className).toContain('bg-[var(--nx-workspace-surface)]')
    expect(card?.className).toContain('border-[var(--nx-border-hairline)]')

    // 冷青发丝徽章
    const badge = main?.querySelector('.text-\\[var\\(--nx-space-cyan\\)\\]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toContain('2FA 验证')

    // 品牌 Logo 导航至根路径
    const brandLink = screen.getByLabelText('开项首页')
    expect(brandLink).not.toBeNull()
    expect(brandLink.getAttribute('href')).toBe('/')

    // 标题导言
    expect(screen.getByText('多一步，安全得多')).toBeTruthy()
    expect(screen.getByText(/即使密码泄露，没有你手机上的认证器也无法登录/)).toBeTruthy()
  })

  test('enroll 绑定态渲染相应文案与徽章', async () => {
    seedChallenge({ purpose: 'enroll', methods: ['totp'] })
    render(<NextTwoFactorStepShell expected="enroll" />)

    expect(await screen.findByText('2FA 绑定')).toBeTruthy()
    expect(screen.getByText('给账号加把锁')).toBeTruthy()
    expect(screen.getByText(/用手机上的认证器 App 扫一次码/)).toBeTruthy()
  })

  test('精确档（precise）下发丝线与纯平表面样式', () => {
    seedChallenge({ purpose: 'verify' })
    useNextTrackStore.getState().setImmersionTier('precise')

    const { container } = render(<NextTwoFactorStepShell expected="verify" />)

    const main = container.querySelector('main')
    expect(main?.getAttribute('data-immersion')).toBe('precise')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

    // 精确档纯平降级：shadow-none，仅发丝边框
    const card = main?.querySelector('.rounded-xl')
    expect(card?.className).toContain('shadow-none')
    expect(card?.className).toContain('border-[var(--nx-border-hairline)]')
    expect(card?.className).not.toContain('shadow-2xl')
  })

  test('安全票据未就绪时骨架占位防闪烁', () => {
    // 未初始化票据（challengeToken 为 null）
    useTwoFactorChallengeStore.getState().clear()

    const { container } = render(<NextTwoFactorStepShell expected="verify" />)

    const skeleton = screen.getByTestId('two-factor-skeleton')
    expect(skeleton).not.toBeNull()
    expect(skeleton.getAttribute('role')).toBe('status')
    expect(skeleton.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('正在校验登录状态…')).toBeTruthy()

    // 严禁渲染具体输入框，防止布局跳动闪烁
    expect(container.querySelector('input')).toBeNull()
    expect(screen.queryByLabelText('验证码')).toBeNull()
  })

  test('WCAG AA 文本对比度（≥ 4.5:1）', () => {
    const css = readFileSync(NEXT_TOKENS_PATH, 'utf8')
    const parseMap = new Map<string, string>()
    const re = /(--nx-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g
    let match: RegExpExecArray | null
    while ((match = re.exec(css))) {
      parseMap.set(match[1]!, match[2]!.trim())
    }

    const resolveToken = (name: string): string => {
      const val = parseMap.get(name)
      if (!val) throw new Error(`Missing token ${name}`)
      const varRef = val.match(/^var\((--[a-zA-Z0-9-]+)\)$/)
      return varRef ? resolveToken(varRef[1]!) : val
    }

    const workspaceSurface = resolveToken('--nx-workspace-surface') // #121418
    const spaceBg = resolveToken('--nx-space-bg') // #040508

    const textPrimary = resolveToken('--nx-text-primary') // #f1f5f9
    const textSecondary = resolveToken('--nx-text-secondary') // #94a3b8
    const textMuted = resolveToken('--nx-text-muted') // #7a8ba1
    const spaceCyan = resolveToken('--nx-space-cyan') // #38bdf8

    for (const bg of [workspaceSurface, spaceBg]) {
      for (const fg of [textPrimary, textSecondary, textMuted, spaceCyan]) {
        const ratio = contrastRatio(fg, bg)
        expect(
          ratio,
          `${fg} against ${bg} contrast ${ratio.toFixed(2)}:1 must be >= 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('双轨偏好取消分支：新轨偏好返回 /next-login', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({ purpose: 'verify' })

    render(<NextTwoFactorStepShell expected="verify" />)

    const cancelBtn = screen.getByRole('button', { name: '返回重新登录' })
    fireEvent.click(cancelBtn)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next-login'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('双轨偏好取消分支：旧轨偏好返回 /login', async () => {
    useNextTrackStore.getState().setTrack('legacy')
    seedChallenge({ purpose: 'verify' })

    render(<NextTwoFactorStepShell expected="verify" />)

    const cancelBtn = screen.getByRole('button', { name: '返回重新登录' })
    fireEvent.click(cancelBtn)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('双轨偏好守卫过期踢回：新轨偏好踢回 /next-login', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'verify',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    render(<NextTwoFactorStepShell expected="verify" />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next-login'))
  })

  test('双轨偏好守卫过期踢回：旧轨偏好踢回 /login', async () => {
    useNextTrackStore.getState().setTrack('legacy')
    seedChallenge({
      purpose: 'verify',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    render(<NextTwoFactorStepShell expected="verify" />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })
})
