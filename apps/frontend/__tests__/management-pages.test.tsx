import AdminUsersPage from '@/app/(dashboard)/admin/users/page'
import OrganizationSettingsPage from '@/app/(dashboard)/settings/organization/page'
import { membersApi, organizationsApi, usersApi } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accessTokenWith } from './_jwt-helper'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('管理页面', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.restoreAllMocks()
  })

  test('系统管理员看到用户表，普通用户只看到无权提示', async () => {
    vi.spyOn(usersApi, 'list').mockResolvedValue({
      data: [
        {
          id: 1,
          fullName: '测试用户',
          email: 'user@example.com',
          isActive: true,
          isSuperAdmin: false,
          organizations: [],
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    useAuthStore.getState().setSession({
      user: {
        id: 9,
        fullName: '管理员',
        email: 'admin@example.com',
        isSuperAdmin: true,
        organizations: [],
      },
      accessToken: accessTokenWith(['system:admin']),
      refreshToken: 'r',
    })
    const first = renderWithQuery(<AdminUsersPage />)
    expect(await screen.findByText('user@example.com')).toBeInTheDocument()
    first.unmount()

    useAuthStore.getState().setSession({
      user: { id: 2, fullName: '成员', email: 'm@example.com', organizations: [] },
      accessToken: accessTokenWith(['org:view']),
      refreshToken: 'r',
    })
    renderWithQuery(<AdminUsersPage />)
    expect(screen.getByText('无权访问用户管理')).toBeInTheDocument()
    expect(screen.queryByText('用户管理')).not.toBeInTheDocument()
  })

  test('组织管理员看到邀请、角色和移除控件', async () => {
    vi.spyOn(organizationsApi, 'get').mockResolvedValue({
      id: 1,
      name: '开项团队',
      slug: 'aiproj',
      description: '一起把复杂项目变清楚',
      settings: null,
      ownerId: 1,
    })
    vi.spyOn(membersApi, 'list').mockResolvedValue([
      {
        id: 2,
        organizationId: 1,
        userId: 2,
        role: 'member',
        invitedBy: 1,
        user: {
          id: 2,
          fullName: '项目成员',
          email: 'member@example.com',
          isActive: true,
        },
      },
    ])
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        fullName: '组织管理员',
        email: 'owner@example.com',
        organizations: [{ id: 1, name: '开项团队', slug: 'aiproj', role: 'owner' }],
      },
      accessToken: accessTokenWith(['org:view', 'org:member:manage'], { organizationId: 1 }),
      refreshToken: 'r',
    })

    renderWithQuery(<OrganizationSettingsPage />)
    expect(await screen.findByText('member@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeInTheDocument()
    // aria-label 使用展示名（email/name 均可缺失时也有稳定标识）
    expect(screen.getByRole('button', { name: /移除 项目成员/ })).toBeInTheDocument()
  })

  test('成员缺少 user 关联（个人账号/关联缺失）时页面不崩且显示占位', async () => {
    vi.spyOn(organizationsApi, 'get').mockResolvedValue({
      id: 1,
      name: '开项团队',
      slug: 'aiproj',
      description: null,
      settings: null,
      ownerId: 1,
    })
    // 后端 DTO 在关联缺失场景不返回 user 字段——模拟该真实响应。
    vi.spyOn(membersApi, 'list').mockResolvedValue([
      {
        id: 3,
        organizationId: 1,
        userId: 3,
        role: 'member',
        invitedBy: 1,
      },
    ])
    useAuthStore.getState().setSession({
      user: {
        id: 1,
        fullName: '组织管理员',
        email: 'owner@example.com',
        organizations: [{ id: 1, name: '开项团队', slug: 'aiproj', role: 'owner' }],
      },
      accessToken: accessTokenWith(['org:view', 'org:member:manage'], { organizationId: 1 }),
      refreshToken: 'r',
    })

    renderWithQuery(<OrganizationSettingsPage />)
    // 不崩：显示占位名与占位邮箱
    expect(await screen.findByText('未知成员')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /移除 未知成员/ })).toBeInTheDocument()
  })
})
