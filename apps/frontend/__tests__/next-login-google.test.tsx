import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextLoginForm } from '@/components/next/auth/NextLoginForm'
import { useNextTrackStore } from '@/stores/next-track-store'

const { googleConfigMock } = vi.hoisted(() => ({ googleConfigMock: vi.fn() }))
vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    authApi: { ...actual.authApi, googleConfig: googleConfigMock },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next-login',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  googleConfigMock.mockReset()
  useNextTrackStore.getState().reset()
  localStorage.clear()
})

describe('新 UI 登录页：Google 登录', () => {
  test('按回跳目标取授权地址，点击后记住新 UI 偏好', async () => {
    googleConfigMock.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=x',
      missingEnvKeys: [],
      preflight: { status: 'configured' },
    })
    render(<NextLoginForm nextPath="/next/projects" />)

    const link = await screen.findByRole('link', { name: /使用 Google 登录/ })
    await waitFor(() =>
      expect(link).toHaveAttribute('href', 'https://accounts.google.com/o/oauth2/v2/auth?state=x'),
    )
    expect(googleConfigMock).toHaveBeenCalledWith('/next/projects')

    fireEvent.click(link)
    expect(useNextTrackStore.getState().track).toBe('next')
  })

  test('未配置时按钮不可用并提示', async () => {
    googleConfigMock.mockResolvedValue({
      authorizationUrl: null,
      missingEnvKeys: ['GOOGLE_OAUTH_CLIENT_ID'],
      preflight: null,
    })
    render(<NextLoginForm />)

    expect(await screen.findByText('Google 登录尚未配置，请联系管理员。')).toBeInTheDocument()
    expect(screen.getByText('使用 Google 登录').closest('a')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
