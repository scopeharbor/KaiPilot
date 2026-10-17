/**
 * v3-ui-next-settings-admin-domains W2 · tasks 2.3 —— 组织资料表单与危险操作区测试
 * （spec「组织设置与成员治理」段 1/3 + design「敏感写操作二次确认与审计矩阵」）。
 *
 * 覆盖：
 * - 资料表单 Zod 校验（名称过短 / slug 非法）即时标红且**零请求**；
 * - 合法且脏的改动 → `PUT /organizations/:id` 载荷正确，成功后表单基线重置
 *   （保存按钮回到禁用态）并刷新组织查询缓存（列表前缀失效）；
 * - 服务端错误按 `ApiError.message` 原文回显，不静默；
 * - 无 `org:manage`：表单物理隐藏，改渲染只读定义列表；
 * - 转交所有权：阻断式弹窗明示影响，取消零请求，确认后调用 `transfer-owner`；
 * - 删除组织：仅 `system:admin` 可见；未输入组织名时确认按钮禁用零请求；
 *   输入正确组织名后提交 `DELETE /organizations/:id` 并跳转 `/next`。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OrgProfileForm } from '@/components/next/settings/organization/OrgProfileForm'
import { OrgDangerZone } from '@/components/next/settings/organization/OrgDangerZone'
import type { Organization, OrganizationMember } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings/organization',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
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
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
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

const ORGANIZATION: Organization = {
  id: 1,
  name: '北极星研发部',
  slug: 'northstar',
  description: '负责北极星产品线',
  settings: null,
  ownerId: 7,
  role: 'admin',
}

function makeMember(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: 11,
    organizationId: 1,
    userId: 8,
    role: 'member',
    invitedBy: 1,
    user: { id: 8, fullName: '李四', email: 'lisi@example.com', isActive: true },
    ...overrides,
  }
}

function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setPermissions(['org:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('组织资料表单（tasks 2.1/2.3）', () => {
  test('非法输入即时标红且提交零请求（名称过短 / slug 大写）', async () => {
    setPermissions(['org:view', 'org:manage'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<OrgProfileForm organization={ORGANIZATION} />)

    const nameInput = document.querySelector('[data-org-profile-name-input]')!
    fireEvent.change(nameInput, { target: { value: 'x' } })
    expect(document.querySelector('[data-org-profile-name-error]')?.textContent).toContain(
      '至少需要 2 个字符',
    )

    const slugInput = document.querySelector('[data-org-profile-slug-input]')!
    fireEvent.change(slugInput, { target: { value: 'NorthStar' } })
    expect(document.querySelector('[data-org-profile-slug-error]')?.textContent).toContain(
      '只能使用小写字母、数字和短横线',
    )

    fireEvent.click(document.querySelector('[data-org-profile-save]')!)
    await settle()
    expect(writeRecords(records)).toHaveLength(0)
  })

  test('合法改动保存：载荷正确、脏检查复位、组织缓存失效', async () => {
    setPermissions(['org:view', 'org:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1' && method === 'PUT') {
        return jsonResponse(200, {
          data: { ...ORGANIZATION, name: '北极星研发中心', description: '新的简介' },
        })
      }
      return null
    })
    renderWithClient(<OrgProfileForm organization={ORGANIZATION} />)

    // 初始无改动：保存按钮禁用 + 提示「当前无改动」。
    expect((document.querySelector('[data-org-profile-save]') as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(document.querySelector('[data-org-profile-dirty-hint]')?.textContent).toContain(
      '当前无改动',
    )

    fireEvent.change(document.querySelector('[data-org-profile-name-input]')!, {
      target: { value: '北极星研发中心' },
    })
    fireEvent.change(document.querySelector('[data-org-profile-description-input]')!, {
      target: { value: '新的简介' },
    })
    expect(document.querySelector('[data-org-profile-dirty-hint]')?.textContent).toContain(
      '有未保存的改动',
    )

    fireEvent.click(document.querySelector('[data-org-profile-save]')!)
    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(records[0]!.url).toBe('/organizations/1')
    expect(records[0]!.method).toBe('PUT')
    expect(records[0]!.body).toMatchObject({
      name: '北极星研发中心',
      slug: 'northstar',
      description: '新的简介',
    })

    await waitFor(() => expect(document.querySelector('[data-org-profile-saved]')).not.toBeNull())
    expect((document.querySelector('[data-org-profile-save]') as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  test('服务端错误原文回显且不静默', async () => {
    setPermissions(['org:view', 'org:manage'])
    installFetchRouter((path, method) => {
      if (path === '/organizations/1' && method === 'PUT') {
        return jsonResponse(409, {
          error: { code: 'CONFLICT', message: '组织标识已被占用' },
        })
      }
      return null
    })
    renderWithClient(<OrgProfileForm organization={ORGANIZATION} />)

    fireEvent.change(document.querySelector('[data-org-profile-slug-input]')!, {
      target: { value: 'taken-slug' },
    })
    fireEvent.click(document.querySelector('[data-org-profile-save]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-profile-server-error]')?.textContent).toContain(
        '组织标识已被占用',
      ),
    )
    expect(document.querySelector('[data-org-profile-saved]')).toBeNull()
  })

  test('无 org:manage：表单物理隐藏并渲染只读信息', () => {
    installFetchRouter(() => null)
    renderWithClient(<OrgProfileForm organization={ORGANIZATION} />)

    expect(document.querySelector('[data-org-profile-readonly]')).not.toBeNull()
    expect(document.querySelector('[data-org-profile-save]')).toBeNull()
    expect(document.querySelector('[data-org-profile-name]')?.textContent).toBe('北极星研发部')
    expect(document.querySelector('[data-org-profile-slug]')?.textContent).toBe('northstar')
  })
})

describe('组织危险操作区（tasks 2.1/2.3）', () => {
  test('转交所有权：阻断式弹窗、取消零请求、确认后调用 transfer-owner', async () => {
    setPermissions(['org:view', 'org:manage'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1/transfer-owner' && method === 'POST') {
        return jsonResponse(200, {
          data: { organization: ORGANIZATION, previousOwnerId: 7, newOwnerId: 8 },
        })
      }
      return null
    })
    renderWithClient(
      <OrgDangerZone
        organization={ORGANIZATION}
        members={[makeMember({ id: 11, role: 'member' }), makeMember({ id: 12, role: 'owner' })]}
      />,
    )

    fireEvent.click(document.querySelector('[data-org-danger-transfer-open]')!)
    const dialog = await waitFor(() => {
      const node = document.querySelector('[data-testid="org-danger-transfer-dialog"]')
      expect(node).not.toBeNull()
      return node!
    })
    expect(dialog.textContent).toContain('当前所有者会自动变为管理员')

    // 未选目标：确认按钮禁用，取消零请求。
    expect(
      (document.querySelector('[data-testid="org-danger-transfer-confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(document.querySelector('[data-org-confirm-cancel]')!)
    await settle()
    expect(writeRecords(records)).toHaveLength(0)
    expect(document.querySelector('[data-testid="org-danger-transfer-dialog"]')).toBeNull()

    fireEvent.click(document.querySelector('[data-org-danger-transfer-open]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-danger-transfer-target]')).not.toBeNull(),
    )
    fireEvent.change(document.querySelector('[data-org-danger-transfer-target]')!, {
      target: { value: '11' },
    })
    fireEvent.click(document.querySelector('[data-testid="org-danger-transfer-confirm"]')!)
    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(records[0]!.url).toBe('/organizations/1/transfer-owner')
    expect(records[0]!.body).toEqual({ memberId: 11 })
  })

  test('转交失败：服务端错误原文回显于弹窗且弹窗保持打开', async () => {
    setPermissions(['org:view', 'org:manage'])
    installFetchRouter((path, method) => {
      if (path === '/organizations/1/transfer-owner' && method === 'POST') {
        return jsonResponse(403, {
          error: { code: 'PERMISSION_DENIED', message: '仅组织所有者可转交所有权' },
        })
      }
      return null
    })
    renderWithClient(<OrgDangerZone organization={ORGANIZATION} members={[makeMember()]} />)

    fireEvent.click(document.querySelector('[data-org-danger-transfer-open]')!)
    fireEvent.change(
      await waitFor(() => document.querySelector('[data-org-danger-transfer-target]')!),
      {
        target: { value: '11' },
      },
    )
    fireEvent.click(document.querySelector('[data-testid="org-danger-transfer-confirm"]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-danger-transfer-error]')?.textContent).toContain(
        '仅组织所有者可转交所有权',
      ),
    )
    expect(document.querySelector('[data-testid="org-danger-transfer-dialog"]')).not.toBeNull()
  })

  test('删除组织：非 system:admin 不可见危险区；system:admin 需输入组织名后提交并跳转', async () => {
    setPermissions(['org:view', 'org:manage'])
    installFetchRouter(() => null)
    const nonAdmin = renderWithClient(
      <OrgDangerZone organization={ORGANIZATION} members={[makeMember()]} />,
    )
    expect(document.querySelector('[data-org-danger-delete]')).toBeNull()
    expect(text()).not.toContain('删除组织')
    nonAdmin.unmount()

    setPermissions(['org:view', 'system:admin'])
    const { records } = installFetchRouter((path, method) => {
      if (path === '/organizations/1' && method === 'DELETE') {
        return new Response(null, { status: 204 }) as unknown as Response
      }
      return null
    })
    renderWithClient(<OrgDangerZone organization={ORGANIZATION} members={[makeMember()]} />)

    fireEvent.click(document.querySelector('[data-org-danger-delete-open]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="org-danger-delete-dialog"]')).not.toBeNull(),
    )

    // 未输入组织名：确认禁用，零请求。
    expect(
      (document.querySelector('[data-testid="org-danger-delete-confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(document.querySelector('[data-testid="org-danger-delete-confirm"]')!)
    await settle()
    expect(writeRecords(records)).toHaveLength(0)

    fireEvent.change(document.querySelector('[data-org-danger-delete-confirm-input]')!, {
      target: { value: '北极星研发部' },
    })
    fireEvent.click(document.querySelector('[data-testid="org-danger-delete-confirm"]')!)
    await waitFor(() => expect(writeRecords(records)).toHaveLength(1))
    expect(records[0]!.method).toBe('DELETE')
    expect(records[0]!.url).toBe('/organizations/1')
    await waitFor(() => expect(navMock.push).toHaveBeenCalledWith('/next'))
  })

  test('删除组织失败：服务端错误原文回显且不跳转', async () => {
    setPermissions(['system:admin'])
    installFetchRouter((path, method) => {
      if (path === '/organizations/1' && method === 'DELETE') {
        return jsonResponse(409, {
          error: { code: 'CONFLICT', message: '组织仍有关联项目，无法删除' },
        })
      }
      return null
    })
    renderWithClient(<OrgDangerZone organization={ORGANIZATION} members={[makeMember()]} />)

    fireEvent.click(document.querySelector('[data-org-danger-delete-open]')!)
    fireEvent.change(
      await waitFor(() => document.querySelector('[data-org-danger-delete-confirm-input]')!),
      {
        target: { value: '北极星研发部' },
      },
    )
    fireEvent.click(document.querySelector('[data-testid="org-danger-delete-confirm"]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-org-danger-delete-error]')?.textContent).toContain(
        '组织仍有关联项目，无法删除',
      ),
    )
    expect(navMock.push).not.toHaveBeenCalled()
  })
})
