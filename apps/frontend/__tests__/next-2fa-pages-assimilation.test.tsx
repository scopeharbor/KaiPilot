import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import TwoFactorSetupPage from '@/app/2fa/setup/page'
import TwoFactorChallengePage from '@/app/2fa/challenge/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { accessTokenWith } from './_jwt-helper'

const replaceMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  usePathname: () => '/2fa/challenge',
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const SESSION = {
  user: { id: 42, email: 'ada@aiproj.local', fullName: '开项工匠', organizations: [] },
  accessToken: accessTokenWith(['ai:connection:manage']),
  refreshToken: 'refresh-token-42',
}

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  otpauthUri: 'otpauth://totp/Issuer:ada@aiproj.local?secret=JBSWY3DPEHPK3PXPJBSWY3DP',
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
}

const NEW_CODES = Array.from({ length: 8 }, (_, i) => `CODE-${1000 + i}-TEST`)

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
    challengeToken: overrides.challengeToken ?? 'challenge-token-xyz',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    purpose: overrides.purpose ?? 'verify',
    skippable: overrides.skippable ?? false,
    methods: overrides.methods ?? ['totp', 'recovery_code'],
    nextPath: overrides.nextPath ?? '/dashboard',
  })
  useTwoFactorChallengeStore.getState().setHasHydrated(true)
}

describe('2FA 设置与挑战页面新轨外壳同化测试 (/2fa/setup & /2fa/challenge)', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalAnchorClick = HTMLAnchorElement.prototype.click
  const createObjectURLMock = vi.fn(() => 'blob:mock-recovery-codes-url')
  const revokeObjectURLMock = vi.fn()
  const anchorClickMock = vi.fn()

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
    createObjectURLMock.mockClear()
    revokeObjectURLMock.mockClear()
    anchorClickMock.mockClear()

    URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL
    HTMLAnchorElement.prototype.click = anchorClickMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    HTMLAnchorElement.prototype.click = originalAnchorClick
    document.documentElement.removeAttribute('data-immersion')
  })

  test('/2fa/setup 正常呈现二维码与恢复码下载并成功完成绑定落地 /next', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'enroll',
      skippable: true,
      methods: ['totp'],
      nextPath: '/next',
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/login/two-factor/enrollment')) {
        return jsonResponse(200, { data: ENROLLMENT })
      }
      if (url.includes('/auth/login/two-factor')) {
        return jsonResponse(200, {
          data: {
            ...SESSION,
            recoveryCodes: NEW_CODES,
            usedRecoveryCode: false,
          },
        })
      }
      return jsonResponse(404, { error: { message: 'Not found' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<TwoFactorSetupPage />)

    // 验证新轨深空外壳同化特征
    const main = container.querySelector('main')
    expect(main?.hasAttribute('data-next-track')).toBe(true)
    expect(main?.className).toContain('nx-space-atmosphere')
    expect(screen.getByText('2FA 绑定')).toBeTruthy()
    expect(screen.getByText('给账号加把锁')).toBeTruthy()

    // 验证二维码与手工秘钥呈现
    const qrImg = (await screen.findByAltText('两步验证配置二维码')) as HTMLImageElement
    expect(qrImg.src.startsWith('data:image/png')).toBe(true)
    expect(screen.getByText(ENROLLMENT.secret)).toBeTruthy()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    // 输入 6 位动态验证码
    const codeInput = screen.getByLabelText('验证码')
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定并登录' }))

    // 验证换得一次性恢复码面板
    expect(await screen.findByText('保存你的恢复码')).toBeTruthy()
    for (const code of NEW_CODES) {
      expect(screen.getByText(code)).toBeTruthy()
    }

    // 下载恢复码（自动触发已保存确认）
    fireEvent.click(screen.getByRole('button', { name: '下载为 .txt' }))
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(anchorClickMock).toHaveBeenCalled()

    // 点击进入新轨工作台
    const enterBtn = screen.getByRole('button', { name: /进入工作台/ })
    expect((enterBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(enterBtn)

    // 最终成功建立会话并落地 /next
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('/2fa/challenge 输入有效 TOTP 码后成功落会话落地 /next', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'verify',
      methods: ['totp', 'recovery_code'],
      nextPath: '/next',
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/login/two-factor')) {
        const body = JSON.parse(init?.body as string)
        expect(body.code).toBe('654321')
        expect(body.challengeToken).toBe('challenge-token-xyz')
        return jsonResponse(200, {
          data: {
            ...SESSION,
            recoveryCodes: null,
            usedRecoveryCode: false,
          },
        })
      }
      return jsonResponse(404, { error: { message: 'Not found' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<TwoFactorChallengePage />)

    // 验证新轨深空外壳
    const main = container.querySelector('main')
    expect(main?.hasAttribute('data-next-track')).toBe(true)
    expect(screen.getByText('2FA 验证')).toBeTruthy()
    expect(screen.getByText('多一步，安全得多')).toBeTruthy()

    // 输入 TOTP 码
    const input = await screen.findByLabelText('验证码')
    fireEvent.change(input, { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('/2fa/challenge 旧轨偏好（legacy）输入有效 TOTP 码后成功落地 /dashboard', async () => {
    useNextTrackStore.getState().setTrack('legacy')
    seedChallenge({
      purpose: 'verify',
      methods: ['totp'],
      nextPath: '/dashboard',
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/login/two-factor')) {
        return jsonResponse(200, {
          data: {
            ...SESSION,
            recoveryCodes: null,
            usedRecoveryCode: false,
          },
        })
      }
      return jsonResponse(404, { error: { message: 'Not found' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TwoFactorChallengePage />)

    const input = await screen.findByLabelText('验证码')
    fireEvent.change(input, { target: { value: '112233' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  test('取消时按双轨偏好返回：新轨偏好返回 /next-login，旧轨偏好返回 /login', async () => {
    // 1. 新轨取消返回 /next-login
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({ purpose: 'verify' })

    const { unmount } = render(<TwoFactorChallengePage />)
    fireEvent.click(screen.getByRole('button', { name: '返回重新登录' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next-login'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
    unmount()

    // 2. 旧轨取消返回 /login
    replaceMock.mockReset()
    useNextTrackStore.getState().setTrack('legacy')
    seedChallenge({ purpose: 'verify' })

    render(<TwoFactorChallengePage />)
    fireEvent.click(screen.getByRole('button', { name: '返回重新登录' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('票据过期或不匹配时按双轨偏好正确踢回 /next-login 或 /login', async () => {
    // 新轨过期票据踢回 /next-login
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'verify',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })

    const { unmount } = render(<TwoFactorChallengePage />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next-login'))
    unmount()

    // 旧轨缺失票据踢回 /login
    replaceMock.mockReset()
    useNextTrackStore.getState().setTrack('legacy')
    useTwoFactorChallengeStore.getState().clear()

    render(<TwoFactorChallengePage />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  test('协议逻辑零改动：恢复码输入通道与会话兑换', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'verify',
      methods: ['totp', 'recovery_code'],
      nextPath: '/next',
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/login/two-factor')) {
        const body = JSON.parse(init?.body as string)
        expect(body.code).toBe('RECOVERY-1234-5678')
        return jsonResponse(200, {
          data: {
            ...SESSION,
            recoveryCodes: null,
            usedRecoveryCode: true,
          },
        })
      }
      return jsonResponse(404, { error: { message: 'Not found' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TwoFactorChallengePage />)

    // 点击切换为恢复码
    fireEvent.click(await screen.findByRole('button', { name: '认证器不可用？改用恢复码' }))

    const recoveryInput = (await screen.findByLabelText('恢复码')) as HTMLInputElement
    fireEvent.change(recoveryInput, { target: { value: 'recovery-1234-5678' } })
    expect(recoveryInput.value).toBe('RECOVERY-1234-5678')

    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  test('协议逻辑零改动：optional 绑定策略可暂时跳过', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({
      purpose: 'enroll',
      skippable: true,
      methods: ['totp'],
      nextPath: '/next',
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/auth/login/two-factor/enrollment')) {
        return jsonResponse(200, { data: ENROLLMENT })
      }
      if (url.includes('/auth/login/two-factor/skip')) {
        return jsonResponse(200, { data: SESSION })
      }
      return jsonResponse(404, { error: { message: 'Not found' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TwoFactorSetupPage />)

    const skipBtn = await screen.findByRole('button', { name: '暂时跳过，下次再设置' })
    fireEvent.click(skipBtn)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  test('协议逻辑零改动：验证码错误展示中文错误提示且不落会话', async () => {
    useNextTrackStore.getState().setTrack('next', 'next_login')
    seedChallenge({ purpose: 'verify' })

    const fetchMock = vi.fn().mockImplementation(async () => {
      return jsonResponse(401, {
        error: {
          code: 'TWO_FACTOR_INVALID_CODE',
          message: 'Internal error details that should not leak',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TwoFactorChallengePage />)

    const input = await screen.findByLabelText('验证码')
    fireEvent.change(input, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('验证码不正确')
    expect(alert.textContent).not.toContain('Internal error details')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
