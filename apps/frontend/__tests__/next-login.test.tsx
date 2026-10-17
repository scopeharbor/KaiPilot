import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { useAuthStore } from '@/stores/auth-store'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { accessTokenWith } from './_jwt-helper'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: loginMock,
    },
  }
})

const replaceMock = vi.fn()
const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/next-login',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /登录/ }))
}

beforeEach(() => {
  loginMock.mockReset()
  replaceMock.mockReset()
  pushMock.mockReset()
  act(() => {
    useAuthStore.getState().clear()
    useTwoFactorChallengeStore.getState().clear()
  })
  useNextTrackStore.getState().reset()
  localStorage.clear()
})

describe('新 UI 登录页（v3-ui-next-track-foundation 任务 6.1/6.2）', () => {
  test('有效凭据：登录成功，偏好持久化 next（source next_login）并跳往 /next', async () => {
    loginMock.mockResolvedValue({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试工作区', slug: 'test', role: 'owner' }],
      },
      accessToken: accessTokenWith([]),
      refreshToken: 'r',
    })
    render(<NextLoginForm />)

    fillAndSubmit('user@example.com', 'password123')

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useNextTrackStore.getState().track).toBe('next')
    expect(useNextTrackStore.getState().source).toBe('next_login')
    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY)!) as {
      state: { track: string }
    }
    expect(persisted.state.track).toBe('next')
  })

  test('传入 next 参数：成功后跳往过滤后的目标（默认 /next）', async () => {
    loginMock.mockResolvedValue({
      user: {
        id: 1,
        email: 'user@example.com',
        fullName: '测试用户',
        organizations: [],
      },
      accessToken: accessTokenWith([]),
      refreshToken: 'r',
    })
    render(<NextLoginForm nextPath="/next/explore" />)
    fillAndSubmit('user@example.com', 'password123')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next/explore'))
  })

  test('无效凭据：展示既有错误码中文映射，不导航', async () => {
    loginMock.mockRejectedValue({ status: 401, code: 'INVALID_CREDENTIALS', message: 'bad' })
    render(<NextLoginForm />)

    fillAndSubmit('user@example.com', 'wrong-password')

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      '邮箱或密码不正确，请重新检查。',
    )
    expect(replaceMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('2FA 挑战透传：转入既有挑战路由并携带挑战票据', async () => {
    loginMock.mockResolvedValue({
      twoFactorRequired: true,
      challengeToken: 'challenge-token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      purpose: 'verify',
      skippable: false,
      methods: ['totp'],
    })
    render(<NextLoginForm />)

    fillAndSubmit('user@example.com', 'password123')

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/2fa/challenge'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBe('challenge-token')
    expect(useTwoFactorChallengeStore.getState().nextPath).toBe('/next')
    // 挑战不是会话：不得写入认证态
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('点击「切回旧版登录」跳转旧版 /login 页', () => {
    render(<NextLoginForm />)
    const link = screen.getByRole('link', { name: /切回旧版登录/ })
    expect(link.getAttribute('href')).toBe('/login')
  })
})
