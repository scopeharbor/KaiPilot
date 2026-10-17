/**
 * v3-ui-next-settings-admin-domains W6 · tasks 6.6 —— 用户管理测试
 * （spec「管理后台门户与平台治理控制台」Requirement 4 + 场景）。
 *
 * 覆盖：
 * - 列表渲染（身份徽标/状态徽标/所属组织）与搜索关键词过滤；
 * - 启用/禁用账号二次确认弹窗、影响提示文案、确认后调用 PUT /users/:id 与状态徽标刷新；
 * - 管理员重置他人 2FA 高危确认流：阻断式弹窗、人工核身理由校验（<4 字拦截且零请求）、
 *   确认后调用 POST /users/:id/two-factor/reset 与成功提示；
 * - 非 system:admin 受限横幅且网络零请求（RL-06）；
 * - RoleVersion 变更提示语义（notice 展示）；
 * - 页面装配：真实 route 页面 /next/admin/users/page.tsx。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { UsersAdminWorkspace } from '@/components/next/admin/users/UsersAdminWorkspace'
import NextAdminUsersPage from '@/app/(next)/next/admin/users/page'
import type { ManagedUser } from '@/lib/api-client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/admin/users',
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body: string | undefined) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : undefined
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: 1, name: '核心研发部', slug: 'core-dev', role: 'owner' }],
    },
    accessToken: 'test-token',
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: 'enterprise',
    roleVersion: 1,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <UsersAdminWorkspace />
    </QueryClientProvider>,
  )
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextAdminUsersPage />
    </QueryClientProvider>,
  )
}

const mockUsers: ManagedUser[] = [
  {
    id: 10,
    email: 'alice@example.com',
    fullName: '爱丽丝',
    isSuperAdmin: true,
    isActive: true,
    organizations: [{ id: 1, name: '核心研发部', slug: 'core-dev', role: 'admin' }],
  },
  {
    id: 20,
    email: 'bob@example.com',
    fullName: '鲍勃',
    isSuperAdmin: false,
    isActive: false,
    organizations: [{ id: 1, name: '核心研发部', slug: 'core-dev', role: 'member' }],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  useNextTrackStore.setState({ immersionTier: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useNextTrackStore.setState({ immersionTier: null })
})

describe('用户管理工作区：列表渲染与搜索（tasks 6.5 / 6.6）', () => {
  test('渲染用户底册：身份徽标、状态徽标、组织与操作按钮', async () => {
    setAuth(['system:admin'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: mockUsers,
          meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })

    renderWorkspace()

    await waitFor(() => {
      expect(screen.getByText('爱丽丝')).toBeInTheDocument()
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
      expect(screen.getAllByText('鲍勃').length).toBeGreaterThan(0)
      expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    })

    // 身份徽标
    expect(screen.getByText('超级管理员')).toBeInTheDocument()
    expect(screen.getByText('平台一般用户')).toBeInTheDocument()

    // 状态徽标
    expect(screen.getByText('已启用')).toBeInTheDocument()
    expect(screen.getByText('已禁用')).toBeInTheDocument()

    // 操作按钮
    const toggle10 = document.querySelector('[data-admin-user-toggle="10"]')
    const toggle20 = document.querySelector('[data-admin-user-toggle="20"]')
    const reset10 = document.querySelector('[data-admin-user-reset-2fa="10"]')
    const reset20 = document.querySelector('[data-admin-user-reset-2fa="20"]')

    expect(toggle10).toHaveTextContent('禁用账号')
    expect(toggle20).toHaveTextContent('启用账号')
    expect(reset10).not.toBeNull()
    expect(reset20).not.toBeNull()
  })

  test('搜索输入触发带 search 参数的 API 请求', async () => {
    setAuth(['system:admin'])
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: [mockUsers[0]],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })

    renderWorkspace()

    const searchInput = screen.getByLabelText('搜索用户')
    fireEvent.change(searchInput, { target: { value: 'alice' } })

    await waitFor(() => {
      expect(records.some((r) => r.method === 'GET' && r.url.includes('search=alice'))).toBe(true)
    })
  })
})

describe('用户管理工作区：启用/禁用二次确认与状态刷新（tasks 6.5 / 6.6）', () => {
  test('点击禁用账号弹出确认弹窗，确认后发 PUT 请求并提示 RoleVersion 变更', async () => {
    setAuth(['system:admin'])
    let userState = { ...mockUsers[0], isActive: true }

    const { records } = installFetchRouter((path, method, body) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: [userState],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      if (path === '/users/10' && method === 'PUT') {
        const parsed = JSON.parse(body || '{}')
        userState = { ...userState, isActive: parsed.isActive }
        return jsonResponse(200, { data: userState })
      }
      return null
    })

    renderWorkspace()

    await waitFor(() => {
      expect(document.querySelector('[data-admin-user-toggle="10"]')).not.toBeNull()
    })

    // 点击禁用
    const toggleBtn = document.querySelector('[data-admin-user-toggle="10"]') as HTMLElement
    fireEvent.click(toggleBtn)

    // 弹窗出现
    const dialog = screen.getByRole('alertdialog', { name: '禁用该账号？' })
    expect(dialog).toBeInTheDocument()
    expect(document.querySelector('[data-admin-user-toggle-impact]')).toHaveTextContent(
      'RoleVersion 递增即刻失效',
    )

    // 取消测试：点击取消关闭弹窗，不发 PUT
    const cancelBtn = within(dialog).getByText('取消')
    fireEvent.click(cancelBtn)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(records.some((r) => r.method === 'PUT')).toBe(false)

    // 重新打开并确认
    fireEvent.click(document.querySelector('[data-admin-user-toggle="10"]') as HTMLElement)
    const submitBtn = document.querySelector('[data-admin-action-submit]') as HTMLElement
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(records.some((r) => r.method === 'PUT' && r.url === '/users/10')).toBe(true)
    })

    // 提示 RoleVersion 变更通知
    await waitFor(() => {
      const notice = document.querySelector('[data-admin-users-notice]')
      expect(notice).not.toBeNull()
      expect(notice).toHaveTextContent('RoleVersion')
      expect(notice).toHaveTextContent('已禁用')
    })
  })
})

describe('用户管理工作区：管理员重置他人 2FA 高危确认流（tasks 6.5 / 6.6）', () => {
  test('高危阻断式弹窗：理由不足 4 字阻断提交，理由充足提交成功并留痕', async () => {
    setAuth(['system:admin'])
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: [mockUsers[0]],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      if (path === '/users/10/two-factor/reset' && method === 'POST') {
        return jsonResponse(200, {
          data: { userId: 10, state: 'disabled', message: '已人工核身并重置' },
        })
      }
      return null
    })

    renderWorkspace()

    await waitFor(() => {
      expect(document.querySelector('[data-admin-user-reset-2fa="10"]')).not.toBeNull()
    })

    // 打开高危重置弹窗
    fireEvent.click(document.querySelector('[data-admin-user-reset-2fa="10"]') as HTMLElement)

    const dialog = screen.getByRole('alertdialog', { name: '重置该用户的两步验证？' })
    expect(dialog).toBeInTheDocument()
    expect(document.querySelector('[data-admin-user-reset-2fa-impact]')).toHaveTextContent(
      '人工核身',
    )

    // 理由输入 <4 字：按钮禁用
    const reasonInput = screen.getByLabelText('核身与重置理由')
    const submitBtn = document.querySelector('[data-admin-user-reset-submit]') as HTMLButtonElement
    expect(submitBtn).toBeDisabled()

    fireEvent.change(reasonInput, { target: { value: '测试' } })
    expect(submitBtn).toBeDisabled()

    // 理由 ≥4 字：按钮启用
    fireEvent.change(reasonInput, { target: { value: '电话人工核身确认' } })
    expect(submitBtn).not.toBeDisabled()

    // 提交
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(
        records.some((r) => r.method === 'POST' && r.url === '/users/10/two-factor/reset'),
      ).toBe(true)
    })

    // 成功提示
    await waitFor(() => {
      const notice = document.querySelector('[data-admin-users-notice]')
      expect(notice).not.toBeNull()
      expect(notice).toHaveTextContent('已重置该用户的两步验证')
    })
  })

  test('重置 2FA 服务端失败回显错误且不静默', async () => {
    setAuth(['system:admin'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: [mockUsers[0]],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      if (path === '/users/10/two-factor/reset' && method === 'POST') {
        return jsonResponse(400, {
          error: { code: 'OPERATION_FAILED', message: '用户尚未启用两步验证' },
        })
      }
      return null
    })

    renderWorkspace()

    await waitFor(() => {
      expect(document.querySelector('[data-admin-user-reset-2fa="10"]')).not.toBeNull()
    })

    fireEvent.click(document.querySelector('[data-admin-user-reset-2fa="10"]') as HTMLElement)
    const reasonInput = screen.getByLabelText('核身与重置理由')
    fireEvent.change(reasonInput, { target: { value: '电话人工核身确认' } })
    fireEvent.click(document.querySelector('[data-admin-user-reset-submit]') as HTMLElement)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('用户尚未启用两步验证')
    })
  })
})

describe('用户管理：权限守卫与 RL-06 零请求（tasks 6.5 / 6.6）', () => {
  test('无 system:admin 权限渲染受限横幅且底层 0 业务请求', async () => {
    setAuth(['org:view', 'audit:view']) // 缺少 system:admin
    const { records } = installFetchRouter(() => null)

    renderWorkspace()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看用户管理的权限')).toBeInTheDocument()

    // 断言零业务请求
    expect(records.filter((r) => r.url.startsWith('/users'))).toHaveLength(0)
  })

  test('页面装配（NextAdminUsersPage）：无权限时通过 PermissionGuard 渲染 fallback 且 0 请求', async () => {
    setAuth(['org:view'])
    const { records } = installFetchRouter(() => null)

    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(records.filter((r) => r.url.startsWith('/users'))).toHaveLength(0)
  })

  test('页面装配（NextAdminUsersPage）：有权限时正常挂载工作区并展示底册', async () => {
    setAuth(['system:admin'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/users') && method === 'GET') {
        return jsonResponse(200, {
          data: mockUsers,
          meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('爱丽丝')).toBeInTheDocument()
    })
  })
})
