import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TwoFactorStepPage } from '@/components/auth/TwoFactorStepPage'
import { authApi } from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { accessTokenWith } from './_jwt-helper'

const replace = vi.fn()
const refresh = vi.fn()

/**
 * 用户**最终**停在哪个路由。
 *
 * 必须断言最后一次跳转而不是 `toHaveBeenCalledWith`：曾经有过一个真实缺陷——
 * 成功跳转之后守卫又补了一次 `/login`，把刚建立的登录顶掉，而
 * 「调用过 /dashboard」的断言照样通过。
 */
function finalDestination(): string | undefined {
  return replace.mock.calls.at(-1)?.[0] as string | undefined
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/2fa/challenge',
}))

// jsdom 下 qrcode 会走 canvas；这里只关心「二维码渲染进了 img」。
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
}))

const SESSION = {
  user: { id: 7, email: 'ada@aiproj.local', fullName: '双因子用户', organizations: [] },
  accessToken: accessTokenWith(['ai:connection:manage']),
  refreshToken: 'refresh-2fa',
}
const VERIFY_RESULT = { ...SESSION, recoveryCodes: null, usedRecoveryCode: false }

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  otpauthUri: 'otpauth://totp/Issuer:ada@aiproj.local?secret=JBSWY3DPEHPK3PXPJBSWY3DP',
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
}
const NEW_CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-${1000 + i}`)

type ChallengeSeed = Parameters<ReturnType<typeof useTwoFactorChallengeStore.getState>['start']>[0]

/** 把一张可用票据放进会话态，模拟「密码已验过、刚被登录页导航过来」。 */
function seedChallenge(overrides: Partial<ChallengeSeed> = {}) {
  useTwoFactorChallengeStore.getState().start({
    challengeToken: 'challenge-token-abc',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    purpose: 'verify',
    skippable: false,
    methods: ['totp', 'recovery_code'],
    nextPath: '/dashboard',
    ...overrides,
  })
  useTwoFactorChallengeStore.getState().setHasHydrated(true)
}

describe('/2fa/challenge —— 已绑定账号的第二因子校验', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clear()
    useAuthStore.getState().setHasHydrated(true)
    useTwoFactorChallengeStore.getState().clear()
    replace.mockReset()
    refresh.mockReset()
    vi.restoreAllMocks()
  })

  test('没有票据时直接踢回登录页（防深链绕过密码步）', async () => {
    useTwoFactorChallengeStore.getState().setHasHydrated(true)

    render(<TwoFactorStepPage expected="verify" />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
    expect(screen.queryByLabelText('验证码')).toBeNull()
  })

  test('票据用途不符时也踢回登录页（enroll 票据不能进 challenge 页）', async () => {
    seedChallenge({ purpose: 'enroll' })

    render(<TwoFactorStepPage expected="verify" />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })

  test('过期票据不渲染表单', async () => {
    seedChallenge({ expiresAt: new Date(Date.now() - 1000).toISOString() })

    render(<TwoFactorStepPage expected="verify" />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })

  test('正确验证码换到会话并跳转，票据随即清空', async () => {
    seedChallenge()
    const exchange = vi.spyOn(authApi, 'loginTwoFactor').mockResolvedValue(VERIFY_RESULT)

    render(<TwoFactorStepPage expected="verify" />)
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    await waitFor(() => expect(exchange).toHaveBeenCalledOnce())
    expect(exchange).toHaveBeenCalledWith({
      challengeToken: 'challenge-token-abc',
      code: '123456',
    })
    await waitFor(() => expect(finalDestination()).toBe('/dashboard'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    // 一次性票据用完即清，避免留在 sessionStorage 里
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
    // 清票据不得触发守卫把用户踢回登录页
    expect(replace).not.toHaveBeenCalledWith('/login')
  })

  test('验证码只接受数字（粘贴带空格也能用）', async () => {
    seedChallenge()
    render(<TwoFactorStepPage expected="verify" />)

    const input = (await screen.findByLabelText('验证码')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '12 34-56' } })
    expect(input.value).toBe('123456')
  })

  test('验证码错误时留在本页并给出中文提示，不回显服务端原文', async () => {
    seedChallenge()
    vi.spyOn(authApi, 'loginTwoFactor').mockRejectedValue({
      status: 401,
      code: 'TWO_FACTOR_INVALID_CODE',
      message: 'ignored-server-text',
    })

    render(<TwoFactorStepPage expected="verify" />)
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('验证码不正确')
    expect(alert.textContent).not.toContain('ignored-server-text')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('尝试超限时给出节流提示', async () => {
    seedChallenge()
    vi.spyOn(authApi, 'loginTwoFactor').mockRejectedValue({
      status: 429,
      code: 'TWO_FACTOR_THROTTLED',
      message: '',
    })

    render(<TwoFactorStepPage expected="verify" />)
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('尝试次数过多')
  })

  test('可切换到恢复码并成功登录', async () => {
    seedChallenge()
    const exchange = vi
      .spyOn(authApi, 'loginTwoFactor')
      .mockResolvedValue({ ...SESSION, recoveryCodes: null, usedRecoveryCode: true })

    render(<TwoFactorStepPage expected="verify" />)
    fireEvent.click(await screen.findByRole('button', { name: '认证器不可用？改用恢复码' }))

    const input = (await screen.findByLabelText('恢复码')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abcd-efgh-ijkl-mnpq' } })
    expect(input.value).toBe('ABCD-EFGH-IJKL-MNPQ')

    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))
    await waitFor(() =>
      expect(exchange).toHaveBeenCalledWith({
        challengeToken: 'challenge-token-abc',
        code: 'ABCD-EFGH-IJKL-MNPQ',
      }),
    )
    await waitFor(() => expect(finalDestination()).toBe('/dashboard'))
    expect(replace).not.toHaveBeenCalledWith('/login')
  })

  test('没有可用恢复码时不给出恢复码入口', async () => {
    seedChallenge({ methods: ['totp'] })

    render(<TwoFactorStepPage expected="verify" />)

    await screen.findByLabelText('验证码')
    expect(screen.queryByRole('button', { name: '认证器不可用？改用恢复码' })).toBeNull()
    expect(screen.getByText(/该账号没有可用的恢复码/)).toBeTruthy()
  })

  test('「返回重新登录」清空票据并回登录页', async () => {
    seedChallenge()
    render(<TwoFactorStepPage expected="verify" />)

    fireEvent.click(await screen.findByRole('button', { name: '返回重新登录' }))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
    expect(replace).toHaveBeenCalledWith('/login')
  })
})

describe('/2fa/setup —— 登录期扫码绑定', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clear()
    useAuthStore.getState().setHasHydrated(true)
    useTwoFactorChallengeStore.getState().clear()
    replace.mockReset()
    refresh.mockReset()
    vi.restoreAllMocks()
  })

  function seedEnrollChallenge(skippable = true) {
    seedChallenge({ purpose: 'enroll', skippable, methods: ['totp'] })
  }

  test('展示二维码与可手工录入的密钥，且此刻仍无会话', async () => {
    seedEnrollChallenge()
    const fetchEnrollment = vi
      .spyOn(authApi, 'loginTwoFactorEnrollment')
      .mockResolvedValue(ENROLLMENT)

    render(<TwoFactorStepPage expected="enroll" />)

    await waitFor(() => expect(fetchEnrollment).toHaveBeenCalledWith('challenge-token-abc'))
    const qr = (await screen.findByAltText('两步验证配置二维码')) as HTMLImageElement
    expect(qr.src.startsWith('data:image/png')).toBe(true)
    expect(screen.getByText(ENROLLMENT.secret)).toBeTruthy()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('输码绑定后先交接恢复码，勾选后才进入工作台', async () => {
    seedEnrollChallenge()
    vi.spyOn(authApi, 'loginTwoFactorEnrollment').mockResolvedValue(ENROLLMENT)
    const exchange = vi
      .spyOn(authApi, 'loginTwoFactor')
      .mockResolvedValue({ ...SESSION, recoveryCodes: NEW_CODES, usedRecoveryCode: false })

    render(<TwoFactorStepPage expected="enroll" />)
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定并登录' }))

    await waitFor(() => expect(exchange).toHaveBeenCalledOnce())
    expect(await screen.findByText('保存你的恢复码')).toBeTruthy()
    for (const code of NEW_CODES) expect(screen.getByText(code)).toBeTruthy()
    expect(replace).not.toHaveBeenCalledWith('/dashboard')

    const enter = screen.getByRole('button', { name: /进入工作台/ }) as HTMLButtonElement
    expect(enter.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(enter)

    await waitFor(() => expect(finalDestination()).toBe('/dashboard'))
    expect(replace).not.toHaveBeenCalledWith('/login')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  test('绑定阶段不提供恢复码入口（此时还没有恢复码）', async () => {
    seedEnrollChallenge()
    vi.spyOn(authApi, 'loginTwoFactorEnrollment').mockResolvedValue(ENROLLMENT)

    render(<TwoFactorStepPage expected="enroll" />)
    await screen.findByLabelText('验证码')

    expect(screen.queryByRole('button', { name: '认证器不可用？改用恢复码' })).toBeNull()
  })

  test('optional 策略可暂时跳过', async () => {
    seedEnrollChallenge(true)
    vi.spyOn(authApi, 'loginTwoFactorEnrollment').mockResolvedValue(ENROLLMENT)
    const skip = vi.spyOn(authApi, 'loginTwoFactorSkip').mockResolvedValue(SESSION)

    render(<TwoFactorStepPage expected="enroll" />)
    fireEvent.click(await screen.findByRole('button', { name: '暂时跳过，下次再设置' }))

    await waitFor(() => expect(skip).toHaveBeenCalledWith('challenge-token-abc'))
    await waitFor(() => expect(finalDestination()).toBe('/dashboard'))
    expect(replace).not.toHaveBeenCalledWith('/login')
  })

  test('required 策略没有跳过入口', async () => {
    seedEnrollChallenge(false)
    vi.spyOn(authApi, 'loginTwoFactorEnrollment').mockResolvedValue(ENROLLMENT)

    render(<TwoFactorStepPage expected="enroll" />)
    await screen.findByLabelText('验证码')

    expect(screen.queryByRole('button', { name: /暂时跳过/ })).toBeNull()
    expect(screen.getByText(/要求所有账号完成两步验证绑定后才能登录/)).toBeTruthy()
  })

  test('二维码取回失败时给出提示而非白屏', async () => {
    seedEnrollChallenge()
    vi.spyOn(authApi, 'loginTwoFactorEnrollment').mockRejectedValue({
      status: 401,
      code: 'TWO_FACTOR_CHALLENGE_INVALID',
      message: '',
    })

    render(<TwoFactorStepPage expected="enroll" />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('请重新登录')
  })
})
