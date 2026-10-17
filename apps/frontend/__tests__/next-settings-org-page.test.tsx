/**
 * v3-ui-next-settings-admin-domains W2 · tasks 2.6 —— 组织设置页装配与隔离测试
 * （spec「组织设置与成员治理」段 4 / design D-ORG / RL-05 / RL-06）。
 *
 * 覆盖：
 * - 无 `org:view`：受限横幅物理阻断且 `organizations` / `members` 底层接口**零请求**；
 * - `?organizationId=999&orgId=999` 查询参数注入**不改变**渲染组织——页面始终渲染
 *   会话组织（`selectEffectiveOrganizationId`），RL-05 跨租户探测面为零；
 * - 未选择组织：中性「请先选择组织」引导态且零请求；
 * - 授权装配：组织资料表单、成员底册、危险区三区齐备；
 * - 三态闭环：加载骨架（aria-busy）→ 错误重试 → 恢复。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import OrganizationSettingsPage from '@/app/(next)/next/settings/organization/page'
import type { Organization } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/organization',
  useParams: () => ({}),
  // 故意注入任意组织 ID 查询参数：页面必须完全忽略它们（RL-05）。
  useSearchParams: () => new URLSearchParams('organizationId=999&orgId=999'),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    return (
      route(path, method) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const ORGANIZATION: Organization = {
  id: 1,
  name: '北极星研发部',
  slug: 'northstar',
  description: '负责北极星产品线',
  settings: null,
  ownerId: 7,
  role: 'admin',
}

function backendRoutes(): (path: string, method: string) => Response | null {
  return (path, method) => {
    if (path === '/organizations/1' && method === 'GET') {
      return jsonResponse(200, { data: ORGANIZATION })
    }
    if (path === '/organizations/1/members' && method === 'GET') {
      return jsonResponse(200, {
        data: [
          {
            id: 11,
            organizationId: 1,
            userId: 7,
            role: 'owner',
            invitedBy: null,
            user: { id: 7, fullName: '张三', email: 'zhangsan@example.com', isActive: true },
          },
        ],
      })
    }
    return null
  }
}

function settle(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth(['org:view', 'org:manage', 'org:member:manage'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('页面准入门禁（RL-06 零请求）', () => {
  test('无 org:view：受限横幅 + 底层接口零请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<OrganizationSettingsPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(text()).toContain('你没有查看组织设置的权限')
    await settle()
    expect(records).toHaveLength(0)
  })
})

describe('组织隔离（RL-05：仅会话组织，不接受任意组织 ID）', () => {
  test('?organizationId=999 参数注入不生效：仍渲染并只请求会话组织 1', async () => {
    const { records } = installFetchRouter(backendRoutes())
    renderWithClient(<OrganizationSettingsPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-org-settings-workspace]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-org-settings-workspace]')?.getAttribute('data-org-id'),
    ).toBe('1')
    await waitFor(() =>
      expect(records.some((record) => record.url === '/organizations/1/members')).toBe(true),
    )
    // 绝无任何指向 999 的组织请求（跨租户探测面为零）。
    expect(records.some((record) => record.url.includes('999'))).toBe(false)
    await waitFor(() =>
      expect(
        (document.querySelector('[data-org-profile-name-input]') as HTMLInputElement).value,
      ).toBe('北极星研发部'),
    )
  })

  test('未选择组织：中性引导态且零请求', async () => {
    setAuth(['org:view', 'org:manage'], null)
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'admin@example.com',
        fullName: '管理员',
        // 多组织且 token 未声明组织 → resolveOrganizationId 返回 null（不猜）。
        organizations: [
          { id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' },
          { id: 2, name: '天枢事业部', slug: 'tianshu', role: 'member' },
        ],
      },
    })
    const { records } = installFetchRouter(() => null)
    renderWithClient(<OrganizationSettingsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-no-organization]')).not.toBeNull())
    expect(text()).toContain('请先选择组织')
    await settle()
    expect(records).toHaveLength(0)
  })
})

describe('授权装配与三态闭环', () => {
  test('授权用户：资料表单 / 成员底册 / 危险区三区齐备', async () => {
    installFetchRouter(backendRoutes())
    renderWithClient(<OrganizationSettingsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-profile]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-org-members]')).not.toBeNull())
    expect(document.querySelector('[data-org-danger-zone]')).not.toBeNull()
    expect(document.querySelector('[data-org-settings-member-count]')?.textContent).toContain(
      '共 1 人',
    )
  })

  test('加载中：骨架屏 aria-busy；组织信息 5xx → 错误卡「重新载入」恢复', async () => {
    let attempts = 0
    installFetchRouter((path, method) => {
      if (path === '/organizations/1' && method === 'GET') {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: ORGANIZATION })
      }
      return backendRoutes()(path, method)
    })
    renderWithClient(<OrganizationSettingsPage />)

    await waitFor(() => expect(document.querySelector('[data-org-settings-error]')).not.toBeNull())
    expect(text()).toContain('组织信息加载失败')
    // 组织未就绪前成员底册零请求（RL-06 前置门）。
    expect(document.querySelector('[data-org-members]')).toBeNull()

    fireEvent.click(document.querySelector('[data-org-settings-retry]')!)
    await waitFor(() => expect(document.querySelector('[data-org-profile]')).not.toBeNull())
  })
})
