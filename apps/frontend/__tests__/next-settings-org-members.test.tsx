/**
 * v3-ui-next-settings-admin-domains W2 · tasks 2.4 —— 组织成员治理组件测试
 * （spec「组织设置与成员治理」段 2 + 场景「非法邮箱输入被前端即时拦截且零请求」）。
 *
 * 覆盖：
 * - 底册渲染（姓名/邮箱/角色徽标/加入时间 UTC 日历日）与关键字即时收敛；
 * - 角色即时修改：选中新角色即 `PUT /organizations/:id/members/:memberId`；
 *   owner 行的下拉禁用（后端拒绝改 owner 角色）；
 * - 邀请：非法邮箱即时标红且**零请求**；合法提交载荷正确、成功后失效底册缓存；
 * - 移除成员：二次确认（取消零请求）+ 影响提示；owner 行移除按钮禁用；
 * - 无 `org:member:manage`：写控件物理隐藏（无下拉 / 无移除 / 无邀请入口）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OrgMembersPanel } from '@/components/next/settings/organization/OrgMembersPanel'
import type { OrganizationMember } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/settings/organization',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
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
  route: (path: string, method: string, body: Record<string, unknown> | null) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    records.push({ method, url: path, body })
    return (
      route(path, method, body) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeRecords(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setPermissions(permissions: string[]) {
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
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

type MemberFixture = OrganizationMember & { createdAt?: string }

function makeMember(overrides: Partial<MemberFixture> = {}): MemberFixture {
  return {
    id: 11,
    organizationId: 1,
    userId: 8,
    role: 'member',
    invitedBy: 1,
    createdAt: '2026-08-14T02:30:00.000Z',
    user: { id: 8, fullName: '李四', email: 'lisi@example.com', isActive: true },
    ...overrides,
  }
}

const MEMBERS: MemberFixture[] = [
  makeMember({
    id: 11,
    userId: 7,
    role: 'owner',
    user: { id: 7, fullName: '张三', email: 'zhangsan@example.com', isActive: true },
    createdAt: '2026-06-01T00:00:00.000Z',
  }),
  makeMember({ id: 12 }),
  makeMember({
    id: 13,
    userId: 9,
    role: 'viewer',
    user: { id: 9, fullName: '王五', email: 'wangwu@example.com', isActive: true },
    createdAt: '2026-09-02T11:00:00.000Z',
  }),
]

/** 只读成员底册路由（默认 GET 命中）。 */
function membersRoute(
  members: MemberFixture[] = MEMBERS,
): (path: string, method: string, body: Record<string, unknown> | null) => Response | null {
  return (path, method) => {
    if (path === '/organizations/1/members' && method === 'GET') {
      return jsonResponse(200, { data: members })
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
  setPermissions(['org:view', 'org:member:manage'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('成员底册渲染与检索（tasks 2.2/2.4）', () => {
  test('渲染姓名/邮箱/角色徽标/加入时间（UTC 日历日）', async () => {
    installFetchRouter(membersRoute())
    renderWithClient(<OrgMembersPanel organizationId={1} />)

    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))
    expect(text()).toContain('李四')
    expect(text()).toContain('lisi@example.com')
    expect(document.querySelector('[data-org-member-role="11"]')?.textContent).toBe('所有者')
    expect(document.querySelector('[data-org-member-role="13"]')?.textContent).toBe('只读')
    expect(text()).toContain('2026-08-14')
  })

  test('检索关键词即时收敛（姓名与邮箱双通道）', async () => {
    installFetchRouter(membersRoute())
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    fireEvent.change(document.querySelector('[data-org-members-search]')!, {
      target: { value: 'wangwu' },
    })
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(1))
    expect(text()).toContain('王五')

    fireEvent.change(document.querySelector('[data-org-members-search]')!, {
      target: { value: '不存在的名字' },
    })
    await waitFor(() => expect(document.querySelector('[data-org-members-empty]')).not.toBeNull())
  })

  test('成员底册加载失败：错误卡 + 重新载入重试', async () => {
    let attempts = 0
    installFetchRouter((path, method) => {
      if (path === '/organizations/1/members' && method === 'GET') {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: MEMBERS })
      }
      return null
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)

    await waitFor(() => expect(document.querySelector('[data-org-members-error]')).not.toBeNull())
    expect(text()).toContain('成员加载失败')
    fireEvent.click(document.querySelector('[data-org-members-retry]')!)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))
  })
})

describe('角色调整与移除（tasks 2.2/2.4）', () => {
  test('角色即时修改：调用 members API 且 owner 行下拉禁用', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1/members/11' && method === 'PUT') {
        return jsonResponse(200, { data: { ...MEMBERS[0] } })
      }
      return membersRoute()(path, method, null)
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    expect(
      (document.querySelector('[data-org-member-role-select="11"]') as HTMLSelectElement).disabled,
    ).toBe(true)

    fireEvent.change(document.querySelector('[data-org-member-role-select="12"]')!, {
      target: { value: 'admin' },
    })
    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(writeRecords(records)[0]!.url).toBe('/organizations/1/members/12')
    expect(writeRecords(records)[0]!.method).toBe('PUT')
    expect(writeRecords(records)[0]!.body).toEqual({ role: 'admin' })
  })

  test('移除成员：二次确认（取消零请求）、确认后提交删除并提示影响', async () => {
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1/members/12' && method === 'DELETE') {
        return new Response(null, { status: 204 }) as unknown as Response
      }
      return membersRoute()(path, method, null)
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    // owner 行移除按钮物理禁用（后端拒绝移除组织 owner）。
    expect(
      (document.querySelector('[data-org-member-remove="11"]') as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.click(document.querySelector('[data-org-member-remove="12"]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-remove-dialog]')).not.toBeNull(),
    )
    expect(text()).toContain('指派将一并解除')

    fireEvent.click(document.querySelector('[data-org-member-remove-cancel]')!)
    await settle()
    expect(writeRecords(records)).toHaveLength(0)

    fireEvent.click(document.querySelector('[data-org-member-remove="12"]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-remove-confirm]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-org-member-remove-confirm]')!)
    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(writeRecords(records)[0]!.method).toBe('DELETE')
    expect(writeRecords(records)[0]!.url).toBe('/organizations/1/members/12')
  })

  test('移除失败：服务端错误原文回显于确认框且保持打开', async () => {
    installFetchRouter((path, method) => {
      if (path === '/organizations/1/members/12' && method === 'DELETE') {
        return jsonResponse(409, {
          error: { code: 'CONFLICT', message: '不能移除组织 owner，请先转交组织所有权' },
        })
      }
      return membersRoute()(path, method, null)
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    fireEvent.click(document.querySelector('[data-org-member-remove="12"]')!)
    fireEvent.click(
      await waitFor(() => document.querySelector('[data-org-member-remove-confirm]')!),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-remove-error]')?.textContent).toContain(
        '不能移除组织 owner',
      ),
    )
    expect(document.querySelector('[data-org-member-remove-dialog]')).not.toBeNull()
  })
})

describe('邀请成员（tasks 2.2/2.4，spec 非法邮箱零请求场景）', () => {
  test('非法邮箱即时拦截：标红且零请求', async () => {
    const { records } = installFetchRouter(membersRoute())
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    fireEvent.click(document.querySelector('[data-org-members-invite-open]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-invite-email]')).not.toBeNull(),
    )

    fireEvent.change(document.querySelector('[data-org-member-invite-email]')!, {
      target: { value: 'not-an-email' },
    })
    expect(document.querySelector('[data-org-member-invite-email-error]')?.textContent).toContain(
      '请输入有效的邮箱地址',
    )
    fireEvent.click(document.querySelector('[data-org-member-invite-submit]')!)
    await settle()
    expect(writeRecords(records)).toHaveLength(0)

    // 空邮箱失焦提示必填。
    fireEvent.change(document.querySelector('[data-org-member-invite-email]')!, {
      target: { value: '' },
    })
    fireEvent.blur(document.querySelector('[data-org-member-invite-email]')!)
    expect(document.querySelector('[data-org-member-invite-email-error]')?.textContent).toContain(
      '请输入成员邮箱',
    )
  })

  test('合法邮箱提交：载荷正确、弹窗关闭、底册重取；服务端错误原文回显', async () => {
    let invited = false
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1/members/invite' && method === 'POST') {
        invited = true
        return jsonResponse(201, { data: makeMember({ id: 21, userId: 21 }) })
      }
      if (path === '/organizations/1/members' && method === 'GET') {
        return jsonResponse(200, {
          data: invited ? [...MEMBERS, makeMember({ id: 21, userId: 21 })] : MEMBERS,
        })
      }
      return null
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    fireEvent.click(document.querySelector('[data-org-members-invite-open]')!)
    fireEvent.change(
      await waitFor(() => document.querySelector('[data-org-member-invite-email]')!),
      {
        target: { value: 'pm@aiproj.internal' },
      },
    )
    fireEvent.change(document.querySelector('[data-org-member-invite-role]')!, {
      target: { value: 'admin' },
    })
    fireEvent.click(document.querySelector('[data-org-member-invite-submit]')!)

    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(writeRecords(records)[0]!.url).toBe('/organizations/1/members/invite')
    expect(writeRecords(records)[0]!.body).toEqual({ email: 'pm@aiproj.internal', role: 'admin' })
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-invite-dialog]')).toBeNull(),
    )
    // 成功后失效底册缓存 → 重新拉取，新行出现。
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(4))
  })

  test('邀请服务端错误原文回显于弹窗（不静默、弹窗保持打开）', async () => {
    installFetchRouter((path, method) => {
      if (path === '/organizations/1/members/invite' && method === 'POST') {
        return jsonResponse(422, {
          error: { code: 'VALIDATION_ERROR', message: '该邮箱尚未注册，请先邀请对方完成注册' },
        })
      }
      return membersRoute()(path, method, null)
    })
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    fireEvent.click(document.querySelector('[data-org-members-invite-open]')!)
    fireEvent.change(
      await waitFor(() => document.querySelector('[data-org-member-invite-email]')!),
      {
        target: { value: 'unknown@aiproj.internal' },
      },
    )
    fireEvent.click(document.querySelector('[data-org-member-invite-submit]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-member-invite-error]')?.textContent).toContain(
        '该邮箱尚未注册',
      ),
    )
    expect(document.querySelector('[data-org-member-invite-dialog]')).not.toBeNull()
  })
})

describe('无 org:member:manage：写控件物理隐藏（RL-06）', () => {
  test('只读用户看不到邀请入口、角色下拉与移除按钮', async () => {
    setPermissions(['org:view'])
    installFetchRouter(membersRoute())
    renderWithClient(<OrgMembersPanel organizationId={1} />)
    await waitFor(() => expect(document.querySelectorAll('[data-org-member-row]')).toHaveLength(3))

    expect(document.querySelector('[data-org-members-invite-open]')).toBeNull()
    expect(document.querySelector('[data-org-member-role-select]')).toBeNull()
    expect(document.querySelector('[data-org-member-remove]')).toBeNull()
    // 静态角色徽标仍在（只读语义）。
    expect(document.querySelector('[data-org-member-role="11"]')?.textContent).toBe('所有者')
  })
})
