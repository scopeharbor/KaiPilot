import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LoginForm } from '@/components/auth/LoginForm'
import { authApi, isTwoFactorChallenge } from '@/lib/api/auth'
import { twoFactorErrorMessage } from '@/lib/api/two-factor'
import { useAuthStore } from '@/stores/auth-store'
import { isChallengeUsable, useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { accessTokenWith } from './_jwt-helper'

const replace = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/login',
}))

const SESSION = {
  user: { id: 7, email: 'ada@aiproj.local', fullName: '双因子用户', organizations: [] },
  accessToken: accessTokenWith(['ai:connection:manage']),
  refreshToken: 'refresh-2fa',
}

function challengeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    twoFactorRequired: true as const,
    challengeToken: 'challenge-token-abc',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    purpose: 'verify' as const,
    methods: ['totp', 'recovery_code'] as ('totp' | 'recovery_code')[],
    ...overrides,
  }
}

// LoginForm 挂载即发起 googleConfig 探测；不等它落定，其 setState 会在下一个
// microtask 里脱离 render() 的 act 作用域触发，产生 act(...) 警告。
async function renderLoginForm(nextPath: string) {
  const utils = render(<LoginForm nextPath={nextPath} />)
  await act(async () => {
    await Promise.resolve()
  })
  return utils
}

async function submitPassword() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'ada@aiproj.local' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
  // submit 处理器是 async 函数：fireEvent.click 自带的 act 只包住同步派发，
  // await authApi.login(...) 之后的 setError/setSubmitting 落在其外；外层 act(async)
  // 在回调执行期间保持 act 标记为真，把这段 promise 续体也纳入范围。
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * 登录页的职责收敛为：验密码 → 拿到挑战票据 → 存进会话态并**导航到独立路由**。
 * 第二因子界面本身在 `/2fa/setup` 与 `/2fa/challenge`，由 two-factor-step-page 测试覆盖。
 */
describe('登录页的第二因子分流', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clear()
    useAuthStore.getState().setHasHydrated(true)
    useTwoFactorChallengeStore.getState().clear()
    replace.mockReset()
    refresh.mockReset()
    vi.restoreAllMocks()
    window.location.hash = ''
    vi.spyOn(authApi, 'googleConfig').mockResolvedValue({
      configured: false,
      missingEnvKeys: [],
      authorizationUrl: null,
    })
  })

  test('isTwoFactorChallenge 按判别字段区分两种响应', () => {
    expect(isTwoFactorChallenge(challengeResponse())).toBe(true)
    expect(isTwoFactorChallenge(SESSION)).toBe(false)
  })

  test('无 2FA 的账号直接建立会话，不经过任何第二因子路由', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(SESSION)

    await renderLoginForm('/settings/ai-connections')
    await submitPassword()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/ai-connections'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
  })

  test('已绑定账号导向 /2fa/challenge，且此刻没有任何会话', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(challengeResponse())

    await renderLoginForm('/settings/ai-connections')
    await submitPassword()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/2fa/challenge'))
    // 关键：拿到挑战 ≠ 拿到会话
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    const pending = useTwoFactorChallengeStore.getState()
    expect(pending.challengeToken).toBe('challenge-token-abc')
    expect(pending.purpose).toBe('verify')
    expect(pending.nextPath).toBe('/settings/ai-connections')
  })

  test('未绑定账号（登录期绑定策略开启）导向 /2fa/setup', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(
      challengeResponse({ purpose: 'enroll', skippable: true, methods: ['totp'] }),
    )

    await renderLoginForm('/dashboard')
    await submitPassword()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/2fa/setup'))
    expect(useTwoFactorChallengeStore.getState().purpose).toBe('enroll')
    expect(useTwoFactorChallengeStore.getState().skippable).toBe(true)
  })

  test('目标路径经 safeNextPath 过滤，站外地址不会被带进跳转（防开放重定向）', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue(challengeResponse())

    await renderLoginForm('https://evil.example.com/steal')
    await submitPassword()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/2fa/challenge'))
    expect(useTwoFactorChallengeStore.getState().nextPath).toBe('/dashboard')
  })

  test('密码错误时不产生挑战，也不跳转', async () => {
    vi.spyOn(authApi, 'login').mockRejectedValue({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: '',
    })

    await renderLoginForm('/dashboard')
    await submitPassword()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('邮箱或密码不正确')
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  test('Google 回调把挑战放在 fragment 时同样分流，并抹掉 fragment', async () => {
    const params = new URLSearchParams({
      twoFactorChallenge: 'google-challenge-token',
      twoFactorExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      twoFactorPurpose: 'enroll',
      twoFactorMethods: 'totp',
      twoFactorSkippable: 'true',
      next: '/settings/profile',
    })
    window.location.hash = `#${params.toString()}`

    await renderLoginForm('/dashboard')

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/2fa/setup'))
    // fragment 读取后立即清除，不留在地址栏与历史里
    expect(window.location.hash).toBe('')
    const pending = useTwoFactorChallengeStore.getState()
    expect(pending.challengeToken).toBe('google-challenge-token')
    expect(pending.nextPath).toBe('/settings/profile')
    // fragment 里从来没有密钥，只有不透明票据
    expect(params.toString()).not.toContain('secret')
  })

  test('isChallengeUsable 拒绝缺失与过期票据', () => {
    expect(isChallengeUsable({ challengeToken: null, expiresAt: null })).toBe(false)
    expect(
      isChallengeUsable({
        challengeToken: 't',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toBe(false)
    expect(
      isChallengeUsable({
        challengeToken: 't',
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      }),
    ).toBe(true)
  })

  test('错误码映射不回显服务端原文，未知码归一', () => {
    expect(twoFactorErrorMessage({ code: 'TWO_FACTOR_THROTTLED' })).toContain('尝试次数过多')
    expect(twoFactorErrorMessage({ code: 'TWO_FACTOR_UNAVAILABLE' })).toContain('暂时不可用')
    expect(twoFactorErrorMessage({ code: 'SOMETHING_INTERNAL' })).toBe('操作失败，请稍后重试。')
    expect(twoFactorErrorMessage(null)).toBe('操作失败，请稍后重试。')
  })
})
