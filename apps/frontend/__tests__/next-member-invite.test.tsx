/**
 * v3-ui-next-resource-team-domains W2 · tasks 2.6 —— 邀请成员表单与即时校验测试
 * （MemberInviteModal 容器级，独立伪后端）。
 *
 * 覆盖：从组织成员中勾选加入项目（候选排除已在项目者、搜索、多选批量加入、
 * 部分失败保留并标注原因、无可授予角色时禁止提交、不暴露拥有者角色）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MemberInviteModal } from '@/components/next/members/MemberInviteModal'
import { projectKeys, type ProjectMember, type ProjectRole } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/members',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

const ROLE_FIXTURES: ProjectRole[] = [
  {
    id: 1,
    projectId: 42,
    name: 'Project Owner',
    description: null,
    permissions: [],
    isSystem: true,
  },
  {
    id: 2,
    projectId: 42,
    name: 'Project Manager',
    description: null,
    permissions: [],
    isSystem: true,
  },
  { id: 3, projectId: 42, name: 'Member', description: null, permissions: [], isSystem: true },
  {
    id: 4,
    projectId: 42,
    name: 'External Collaborator',
    description: null,
    permissions: [],
    isSystem: true,
  },
  {
    id: 5,
    projectId: 42,
    name: 'Read-only Observer',
    description: null,
    permissions: [],
    isSystem: true,
  },
]

function makeInvitedMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 9,
    projectId: 42,
    userId: 9,
    projectRoleId: 3,
    isActive: true,
    user: {
      id: 9,
      fullName: '新成员',
      email: 'developer@aiproj.internal',
      initials: 'XM',
      isActive: true,
    },
    projectRole: ROLE_FIXTURES[2],
    createdAt: '2026-09-02T02:00:00.000Z',
    updatedAt: '2026-09-02T02:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

export interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (path: string, method: string, body: Record<string, unknown> | null) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 弹窗宿主（open 受控 + onClose 记录）
// ---------------------------------------------------------------------------
function ModalHarness({ roles, onCloseSpy }: { roles: ProjectRole[]; onCloseSpy: () => void }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div>
      <button type="button" data-harness-open onClick={() => setOpen(true)}>
        打开邀请弹窗
      </button>
      <MemberInviteModal
        projectId={42}
        open={open}
        roles={roles}
        onClose={() => {
          onCloseSpy()
          setOpen(false)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 组织成员夹具：候选名单来自组织成员，已在项目中的人不出现
// ---------------------------------------------------------------------------
const ORG_MEMBERS = [
  {
    id: 1,
    organizationId: 1,
    userId: 1,
    role: 'owner',
    user: {
      id: 1,
      fullName: '王启明',
      email: 'owner@aiproj.internal',
      initials: 'WQ',
      isActive: true,
    },
  },
  {
    id: 2,
    organizationId: 1,
    userId: 7,
    role: 'member',
    user: {
      id: 7,
      fullName: '李思远',
      email: 'lisy@aiproj.internal',
      initials: 'LS',
      isActive: true,
    },
  },
  {
    id: 3,
    organizationId: 1,
    userId: 8,
    role: 'member',
    user: {
      id: 8,
      fullName: '张子涵',
      email: 'zhangzh@aiproj.internal',
      initials: 'ZZ',
      isActive: true,
    },
  },
  {
    id: 4,
    organizationId: 1,
    userId: 9,
    role: 'viewer',
    user: {
      id: 9,
      fullName: '新成员',
      email: 'developer@aiproj.internal',
      initials: 'XM',
      isActive: true,
    },
  },
]

function renderWithOrg(
  roles: ProjectRole[],
  onCloseSpy: () => void = () => undefined,
  existingProjectMembers: ProjectMember[] = [makeInvitedMember({ userId: 1, id: 1 })],
) {
  useAuthStore.setState({ currentOrganizationId: 1 })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(projectKeys.members(42), existingProjectMembers)
  render(
    <QueryClientProvider client={client}>
      <ModalHarness roles={roles} onCloseSpy={onCloseSpy} />
    </QueryClientProvider>,
  )
  fireEvent.click(document.querySelector('[data-harness-open]') as Element)
}

const orgMembersRoute = (path: string, method: string) =>
  method === 'GET' && path === '/organizations/1/members'
    ? jsonResponse(200, { data: ORG_MEMBERS })
    : null

describe('MemberInviteModal：从组织成员中勾选加入项目', () => {
  test('候选名单排除已在项目中的人，可按姓名 / 邮箱搜索', async () => {
    installFetchRouter(orgMembersRoute)
    renderWithOrg(ROLE_FIXTURES)

    await waitFor(() => expect(screen.getByText('李思远')).toBeInTheDocument())
    expect(screen.queryByText('王启明')).toBeNull()
    expect(screen.getByText('张子涵')).toBeInTheDocument()

    fireEvent.change(document.querySelector('[data-member-invite-search]') as HTMLInputElement, {
      target: { value: 'zhangzh' },
    })
    expect(screen.queryByText('李思远')).toBeNull()
    expect(screen.getByText('张子涵')).toBeInTheDocument()
  })

  test('多选 + 角色 → 逐个 POST /members，全部成功后关闭弹窗', async () => {
    const posted: Array<Record<string, unknown> | null> = []
    const { records } = installFetchRouter((path, method, body) => {
      const org = orgMembersRoute(path, method)
      if (org) return org
      if (method === 'POST' && path === '/projects/42/members') {
        posted.push(body)
        return jsonResponse(201, { data: makeInvitedMember({ userId: Number(body?.userId) }) })
      }
      return null
    })
    const onClose = vi.fn()
    renderWithOrg(ROLE_FIXTURES, onClose)

    await waitFor(() => expect(screen.getByText('李思远')).toBeInTheDocument())
    fireEvent.click(document.querySelector('[data-member-invite-candidate="7"]') as Element)
    fireEvent.click(document.querySelector('[data-member-invite-candidate="8"]') as Element)
    fireEvent.change(document.querySelector('[data-member-invite-role]') as HTMLSelectElement, {
      target: { value: '2' },
    })
    expect(screen.getByText('已选 2 人')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-member-invite-submit]') as Element)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(posted).toEqual([
      { userId: 7, projectRoleId: 2 },
      { userId: 8, projectRoleId: 2 },
    ])
    expect(records.filter((r) => r.url.includes('/invite'))).toHaveLength(0)
  })

  test('部分失败（409 已在项目中）→ 弹窗保持打开并标注原因，已成功的不重复提交', async () => {
    installFetchRouter((path, method, body) => {
      const org = orgMembersRoute(path, method)
      if (org) return org
      if (method === 'POST' && path === '/projects/42/members') {
        return Number(body?.userId) === 8
          ? jsonResponse(409, { error: { code: 'MEMBER_EXISTS', message: '该用户已是项目成员' } })
          : jsonResponse(201, { data: makeInvitedMember({ userId: Number(body?.userId) }) })
      }
      return null
    })
    const onClose = vi.fn()
    renderWithOrg(ROLE_FIXTURES, onClose)

    await waitFor(() => expect(screen.getByText('李思远')).toBeInTheDocument())
    fireEvent.click(document.querySelector('[data-member-invite-candidate="7"]') as Element)
    fireEvent.click(document.querySelector('[data-member-invite-candidate="8"]') as Element)
    fireEvent.click(document.querySelector('[data-member-invite-submit]') as Element)

    await waitFor(() => expect(screen.getByText('该用户已是项目成员')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('已选 1 人')).toBeInTheDocument()
    expect(
      document.querySelector('[data-member-invite-candidate="8"]')?.getAttribute('aria-checked'),
    ).toBe('true')
  })

  test('无可授予角色 → 提交按钮禁用，零 POST；角色下拉不暴露拥有者', async () => {
    const { records } = installFetchRouter(orgMembersRoute)
    renderWithOrg([ROLE_FIXTURES[0]!])

    await waitFor(() => expect(screen.getByText('李思远')).toBeInTheDocument())
    fireEvent.click(document.querySelector('[data-member-invite-candidate="7"]') as Element)
    const submit = document.querySelector('[data-member-invite-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(records.filter((r) => r.method === 'POST')).toHaveLength(0)
    const options = [
      ...(document.querySelector('[data-member-invite-role]') as HTMLSelectElement).options,
    ].map((o) => o.textContent)
    expect(options.join()).not.toContain('拥有者')
  })
})
