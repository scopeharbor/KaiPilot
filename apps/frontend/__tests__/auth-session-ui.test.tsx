import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LoginForm } from '@/components/auth/LoginForm'
import { AiConnectionsAccess } from '@/components/ai/AiConnectionsAccess'
import { UserMenu } from '@/components/layout/UserMenu'
import { authApi } from '@/lib/api/auth'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { AUTH_SESSION_STORAGE_KEY, useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const replace = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/settings/ai-connections',
}))

describe('前端登录与会话恢复', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clear()
    useAuthStore.getState().setHasHydrated(true)
    replace.mockReset()
    refresh.mockReset()
    vi.restoreAllMocks()
    vi.spyOn(authApi, 'googleConfig').mockResolvedValue({
      configured: false,
      missingEnvKeys: ['GOOGLE_OAUTH_CLIENT_ID'],
      authorizationUrl: null,
    })
  })

  test('只接受安全站内返回路径', () => {
    expect(safeNextPath('/settings/ai-connections')).toBe('/settings/ai-connections')
    expect(safeNextPath('https://example.com')).toBe('/dashboard')
    expect(safeNextPath('//example.com')).toBe('/dashboard')
    expect(safeNextPath('/login?next=%2Fsettings')).toBe('/dashboard')
  })

  test('登录成功建立会话并回到目标页面', async () => {
    const session = {
      user: {
        id: 1,
        email: 'admin@aiproj.local',
        fullName: '测试管理员',
        organizations: [],
      },
      accessToken: accessTokenWith(['ai:connection:manage']),
      refreshToken: 'refresh-1',
    }
    vi.spyOn(authApi, 'login').mockResolvedValue(session)

    render(<LoginForm nextPath="/settings/ai-connections" />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'admin@aiproj.local' },
    })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(authApi.login).toHaveBeenCalledOnce())
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(replace).toHaveBeenCalledWith('/settings/ai-connections')
    expect(refresh).toHaveBeenCalledOnce()
  })

  test('登录页展示可用的 Google 登录入口', async () => {
    vi.mocked(authApi.googleConfig).mockResolvedValue({
      configured: true,
      missingEnvKeys: [],
      authorizationUrl: 'http://localhost:3333/api/v1/auth/google/authorize?next=%2Fdashboard',
    })

    render(<LoginForm nextPath="/dashboard" />)

    const link = await screen.findByRole('link', { name: /使用 Google 登录/ })
    expect(link).toHaveAttribute(
      'href',
      'http://localhost:3333/api/v1/auth/google/authorize?next=%2Fdashboard',
    )
  })

  test('sessionStorage 保存会话但不包含密码或 API key', async () => {
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'admin@aiproj.local', fullName: '管理员', organizations: [] },
      accessToken: accessTokenWith(['ai:connection:manage']),
      refreshToken: 'refresh-safe',
    })
    const persisted = sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY)
    expect(persisted).toContain('refresh-safe')
    expect(persisted).not.toContain('password123')
    expect(persisted).not.toContain('sk-')

    useAuthStore.getState().clear()
    sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, persisted!)
    await useAuthStore.persist.rehydrate()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user?.email).toBe('admin@aiproj.local')
  })

  test('未登录 AI 连接页与用户菜单都提供登录入口', () => {
    useAuthStore.getState().clear()
    const first = render(<AiConnectionsAccess />)
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute(
      'href',
      '/login?next=%2Fsettings%2Fai-connections',
    )
    first.unmount()

    render(<UserMenu />)
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
      'href',
      '/login?next=%2Fsettings%2Fai-connections',
    )
  })
})
