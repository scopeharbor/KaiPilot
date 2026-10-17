import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextAuthCallbackShell } from '@/components/next/auth/NextAuthCallbackShell'
import { useNextTrackStore } from '@/stores/next-track-store'

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
}))

describe('W4 任务 4.2: OAuth / SSO 深空加载态组件单元测试 (NextAuthCallbackShell)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNextTrackStore.getState().reset()
    document.documentElement.removeAttribute('data-immersion')
    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载态：正确挂载 BrandLoader (size 64) 与文本回显', () => {
    const { container } = render(<NextAuthCallbackShell loadingLabel="正在完成 Google 登录…" />)

    const main = container.querySelector('[data-auth-callback-shell]')
    expect(main).toBeTruthy()
    expect(main?.hasAttribute('data-next-track')).toBe(true)
    expect(main?.getAttribute('aria-busy')).toBe('true')
    expect(main?.className).toContain('nx-space-atmosphere')

    // BrandLoader role="status" and text
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('正在完成 Google 登录…')).toBeTruthy()

    // 默认未指定错误时不渲染错误卡片与返回登录按钮
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('返回登录')).toBeNull()
  })

  it('错误态：渲染暗黑仪器风错误卡、标题、信息与返回登录按钮', () => {
    render(
      <NextAuthCallbackShell
        error="Google 登录回调缺少系统会话，请重新登录。"
        errorTitle="Google 登录未完成"
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(screen.getByText('Google 登录未完成')).toBeTruthy()
    expect(screen.getByText('Google 登录回调缺少系统会话，请重新登录。')).toBeTruthy()

    const button = screen.getByRole('button', { name: '返回登录' })
    expect(button).toBeTruthy()
    expect(button.getAttribute('data-next-action')).toBe('return-to-login')
  })

  it('返回登录：触发自定义 onReturnToLogin / onBackToLogin 回调', () => {
    const onReturn = vi.fn()
    render(
      <NextAuthCallbackShell
        error="SSO 会话失效"
        errorTitle="登录失败"
        onReturnToLogin={onReturn}
      />,
    )

    const button = screen.getByRole('button', { name: '返回登录' })
    fireEvent.click(button)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('返回登录：双轨偏好 next 时智能导流至 /next-login', () => {
    useNextTrackStore.getState().setTrack('next')

    render(<NextAuthCallbackShell error="SSO 会话失效" errorTitle="企业 SSO 登录未完成" />)

    const button = screen.getByRole('button', { name: '返回登录' })
    fireEvent.click(button)

    expect(routerMock.replace).toHaveBeenCalledWith('/next-login')
  })

  it('返回登录：双轨偏好 next 且存在安全 nextPath 时携带参数导流', () => {
    useNextTrackStore.getState().setTrack('next')

    render(
      <NextAuthCallbackShell
        error="SSO 会话失效"
        errorTitle="企业 SSO 登录未完成"
        nextPath="/projects/42"
      />,
    )

    const button = screen.getByRole('button', { name: '返回登录' })
    fireEvent.click(button)

    expect(routerMock.replace).toHaveBeenCalledWith('/next-login?next=%2Fprojects%2F42')
  })

  it('返回登录：双轨偏好 legacy 默认导流至 /login', () => {
    useNextTrackStore.getState().setTrack('legacy')

    render(<NextAuthCallbackShell error="未授权登录" errorTitle="企业 SSO 登录未完成" />)

    const button = screen.getByRole('button', { name: '返回登录' })
    fireEvent.click(button)

    expect(routerMock.replace).toHaveBeenCalledWith('/login')
  })

  it('精确档（precise）纯平深空黑底降级与零画布守护', () => {
    useNextTrackStore.getState().setImmersionTier('precise')

    const { container } = render(<NextAuthCallbackShell loadingLabel="正在完成企业 SSO 登录…" />)

    const shell = container.querySelector('[data-auth-callback-shell]')
    expect(shell?.getAttribute('data-immersion')).toBe('precise')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

    // 零 Canvas / 零 WebGL 守护
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('系统减弱动画偏好（prefers-reduced-motion）自动降级至精确档', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const { container } = render(<NextAuthCallbackShell loadingLabel="正在完成 SAML 登录…" />)

    const shell = container.querySelector('[data-auth-callback-shell]')
    expect(shell?.getAttribute('data-immersion')).toBe('precise')
    expect(container.querySelector('canvas')).toBeNull()
  })
})
