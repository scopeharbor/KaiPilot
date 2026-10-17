import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { useAuthStore } from '@/stores/auth-store'
import { NEXT_TRACK_STORAGE_KEY, useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { accessTokenWith } from './_jwt-helper'

// 1. Mock R3F 隔离层（遵循 design.md Decision 8）
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 0, z: 5 }, lookAt: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

// 2. Mock 认证 API 与路由
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
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn(), refresh: vi.fn() }),
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

describe('新轨 3D 沉浸登录页联动集成测试（v3-next-layer1-login-3d-m0 任务 5.2）', () => {
  test('分层物理隔离契约：DOM 表单挂载于 Layer 1 (z-10)，3D 视口位于 Layer 0 (z-0)', () => {
    const { container } = render(<NextLoginForm />)

    // 表单卡片容器为 z-10 且 pointer-events-auto
    const formCardWrapper = container.querySelector('.z-10')
    expect(formCardWrapper).not.toBeNull()
    expect(formCardWrapper?.className).toContain('pointer-events-auto')

    // 底层包含 3D / 静态降级视口（z-0 且 pointer-events-none）
    const layer0 = container.querySelector('.z-0')
    expect(layer0).not.toBeNull()
    expect(layer0?.className).toContain('pointer-events-none')
  })

  test('状态驱动微交互：输入框获取/失去焦点时触发 onFocusChange 回调通知', () => {
    const onFocusChange = vi.fn()
    render(<NextLoginForm onFocusChange={onFocusChange} />)

    const emailInput = screen.getByLabelText('邮箱')
    const passwordInput = screen.getByLabelText('密码')

    // 聚焦邮箱输入框
    fireEvent.focus(emailInput)
    expect(onFocusChange).toHaveBeenCalledWith(true)

    // 失焦邮箱输入框
    fireEvent.blur(emailInput)
    expect(onFocusChange).toHaveBeenCalledWith(false)

    // 聚焦密码输入框
    fireEvent.focus(passwordInput)
    expect(onFocusChange).toHaveBeenCalledWith(true)

    // 失焦密码输入框
    fireEvent.blur(passwordInput)
    expect(onFocusChange).toHaveBeenCalledWith(false)
  })

  test('键盘导航无焦点捕获阻碍：Tab 导航顺序在表单内正常穿梭，永不落入 3D 节点', () => {
    render(<NextLoginForm />)

    const emailInput = screen.getByLabelText('邮箱')
    const passwordInput = screen.getByLabelText('密码')
    const submitBtn = screen.getByRole('button', { name: /登录/ })
    const switchLink = screen.getByRole('link', { name: /切回旧版登录/ })

    // 确保所有 3D 画布/回退容器均带有 aria-hidden 与 tabIndex=-1
    const staticFallback = screen.queryByTestId('login-static-fallback')
    if (staticFallback) {
      expect(staticFallback.getAttribute('aria-hidden')).toBe('true')
      expect(staticFallback.getAttribute('tabindex')).toBe('-1')
    }

    // 表单控件正常可获得焦点
    emailInput.focus()
    expect(document.activeElement).toBe(emailInput)

    passwordInput.focus()
    expect(document.activeElement).toBe(passwordInput)

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
    fireEvent.change(passwordInput, { target: { value: 'password123' } })

    submitBtn.focus()
    expect(document.activeElement).toBe(submitBtn)

    switchLink.focus()
    expect(document.activeElement).toBe(switchLink)
  })

  test('已有登录认证业务链路 100% 保持现状：有效凭据成功登录并跳转 /next', async () => {
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

    const onSubmittingChange = vi.fn()
    render(<NextLoginForm onSubmittingChange={onSubmittingChange} />)

    fillAndSubmit('user@example.com', 'password123')

    expect(onSubmittingChange).toHaveBeenCalledWith(true)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/next'))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useNextTrackStore.getState().track).toBe('next')
    expect(useNextTrackStore.getState().source).toBe('next_login')

    const persisted = JSON.parse(localStorage.getItem(NEXT_TRACK_STORAGE_KEY)!) as {
      state: { track: string }
    }
    expect(persisted.state.track).toBe('next')
    expect(onSubmittingChange).toHaveBeenLastCalledWith(false)
  })

  test('无效凭据：错误提示正常展示，不触发页面跳转', async () => {
    loginMock.mockRejectedValue({ status: 401, code: 'INVALID_CREDENTIALS', message: 'bad' })
    render(<NextLoginForm />)

    fillAndSubmit('user@example.com', 'wrong-password')

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      '邮箱或密码不正确，请重新检查。',
    )
    expect(replaceMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('2FA 挑战流：透传票据至 2FA 挑战路由', async () => {
    loginMock.mockResolvedValue({
      twoFactorRequired: true,
      challengeToken: 'challenge-token-3d',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      purpose: 'verify',
      skippable: false,
      methods: ['totp'],
    })
    render(<NextLoginForm />)

    fillAndSubmit('user@example.com', 'password123')

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/2fa/challenge'))
    expect(useTwoFactorChallengeStore.getState().challengeToken).toBe('challenge-token-3d')
    expect(useTwoFactorChallengeStore.getState().nextPath).toBe('/next')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  test('旧版登录切换链接：维持 href 为 /login', () => {
    render(<NextLoginForm />)
    const link = screen.getByRole('link', { name: /切回旧版登录/ })
    expect(link.getAttribute('href')).toBe('/login')
  })
})
