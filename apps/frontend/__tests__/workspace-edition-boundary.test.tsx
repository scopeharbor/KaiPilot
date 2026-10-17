import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceEditionBoundary } from '@/components/layout/WorkspaceEditionBoundary'
import { useAuthStore } from '@/stores/auth-store'

const navigation = vi.hoisted(() => ({
  pathname: '/settings/security/sso',
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}))

describe('WorkspaceEditionBoundary', () => {
  beforeEach(() => {
    navigation.pathname = '/settings/security/sso'
    navigation.replace.mockReset()
    act(() => {
      useAuthStore.setState({
        hasHydrated: true,
        planTier: 'free',
        user: {
          id: 1,
          email: 'personal@example.com',
          fullName: '个人用户',
          organizations: [
            {
              id: 1,
              name: 'internal-personal-org',
              slug: 'internal-personal-org',
              role: 'owner',
              planTier: 'free',
            },
          ],
        },
      })
    })
  })

  test('个人版打开企业设置直链时不渲染页面，并返回个人资料', async () => {
    render(
      <WorkspaceEditionBoundary>
        <div>企业单点登录配置</div>
      </WorkspaceEditionBoundary>,
    )

    expect(screen.queryByText('企业单点登录配置')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在返回个人版可用页面')
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/settings/profile'))
  })

  test('个人版页面正常渲染', () => {
    navigation.pathname = '/settings/profile'
    render(
      <WorkspaceEditionBoundary>
        <div>个人资料内容</div>
      </WorkspaceEditionBoundary>,
    )

    expect(screen.getByText('个人资料内容')).toBeInTheDocument()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
