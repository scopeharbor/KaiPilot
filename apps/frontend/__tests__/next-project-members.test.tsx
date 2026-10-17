/**
 * v3-ui-next-resource-team-domains W2 · tasks 2.8 —— 成员域主工作台与租户隔离集成测试
 * （页面级：ProjectMembersDomainPage + 伪后端）。
 *
 * 覆盖（spec「项目成员列表底册与项目角色管理」/「RBAC 权限守卫与跨租户防探测中性 404」）：
 * - 成员工作台首次加载骨架屏 → 完整底册装配（页头 / 人数度量 / 成员表）；
 * - 邀请弹窗与成员列表联动：POST 邀请成功后底册自动追加、计数 +1；
 * - 无 project:member:manage 权限：邀请按钮物理隐藏、角色控件回退静态徽章、
 *   零写请求（RL-06）；
 * - 跨租户项目与非法项目 ID：统一中性 404「项目不存在或已被移除」，成员端点零请求
 *   （RL-05 防探测，绝无 403 线索）；
 * - 无 project:view：受限横幅渲染且底层接口零请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectMembersDomainPage from '@/app/(next)/next/projects/[id]/members/page'
import type { Project, ProjectMember, ProjectRole } from '@/lib/api/projects'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/members',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1, userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: 'owner@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'owner' }],
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

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
]

function makeMember(userId: number, roleId: number): ProjectMember {
  return {
    id: userId,
    projectId: 42,
    userId,
    projectRoleId: roleId,
    isActive: true,
    user: {
      id: userId,
      fullName: ['王启明', '李四', '王五', '赵六'][userId - 1] ?? `成员${userId}`,
      email:
        ['owner@example.com', 'lisi@example.com', 'wangwu@example.com', 'zhaoliu@example.com'][
          userId - 1
        ] ?? `user${userId}@aiproj.internal`,
      initials: `U${userId}`,
      isActive: true,
    },
    projectRole: ROLE_FIXTURES.find((role) => role.id === roleId),
    createdAt: '2026-07-20T08:30:00.000Z',
    updatedAt: '2026-07-20T08:30:00.000Z',
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

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

/** 伪后端：项目上下文 + 成员底册 + 角色 + 邀请。projectOrganizationId 可切换以模拟跨租户。 */
function createBackend(projectOrganizationId = 1) {
  const roster: ProjectMember[] = [
    makeMember(1, 1),
    makeMember(2, 3),
    makeMember(3, 2),
    makeMember(4, 3),
  ]
  const project = makeProject({ organizationId: projectOrganizationId })

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: project })
    }
    if (path === '/projects/42/roles' && method === 'GET') {
      return jsonResponse(200, { data: ROLE_FIXTURES })
    }
    if (path === '/projects/42/members' && method === 'GET') {
      return jsonResponse(200, { data: roster })
    }
    if (path === '/organizations/1/members' && method === 'GET') {
      return jsonResponse(200, {
        data: [
          {
            id: 77,
            organizationId: 1,
            userId: 900,
            role: 'member',
            user: {
              id: 900,
              fullName: '新成员',
              email: 'newcomer@aiproj.internal',
              initials: 'NM',
              isActive: true,
            },
          },
        ],
      })
    }
    if (path === '/projects/42/members' && method === 'POST') {
      const email = 'newcomer@aiproj.internal'
      if (roster.some((member) => Number(member.userId) === Number(body?.userId))) {
        return jsonResponse(409, {
          error: { code: 'ALREADY_MEMBER', message: '该用户已是项目成员' },
        })
      }
      const projectRoleId = Number(body?.projectRoleId)
      const role = ROLE_FIXTURES.find((item) => item.id === projectRoleId)
      const member: ProjectMember = {
        id: 900,
        projectId: 42,
        userId: 900,
        projectRoleId: role?.id ?? null,
        isActive: true,
        user: {
          id: 900,
          fullName: '新成员',
          email,
          initials: 'NM',
          isActive: true,
        },
        projectRole: role,
        createdAt: '2026-09-02T02:00:00.000Z',
        updatedAt: '2026-09-02T02:00:00.000Z',
      }
      roster.push(member)
      return jsonResponse(201, { data: member })
    }
    return null
  }

  return { roster, project, route }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <ProjectMembersDomainPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('ProjectMembersDomainPage：首次加载骨架与完整底册装配（spec 场景「浏览项目成员底册与角色分配」）', () => {
  test('骨架屏 → 成员工作台：页头 / 人数度量「共 4 人」/ 成员底册齐备', async () => {
    setAuth(['project:view', 'project:member:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage()

    // 项目校验期：整体骨架
    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-members-workspace]')).not.toBeNull())
    // 成员数据在途：底册骨架
    await waitFor(() => expect(document.querySelector('[data-member-roster-skeleton]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))

    // 页头（DomainPageHeader：项目名 · 成员管理）与返回按钮
    expect(screen.getByText('开项核心引擎 · 成员管理')).toBeInTheDocument()
    expect(document.querySelector('[data-domain-back]')).not.toBeNull()
    expect(document.querySelector('[data-domain-title]')?.textContent).toContain('成员管理')

    // 人数度量与底册字段
    const metricTotal = document.querySelector('[data-member-metric-total]')
    expect(metricTotal?.textContent).toContain('共 4 人')
    expect(document.querySelector('[data-member-metric-owners]')?.textContent).toContain('1 人')
    expect(screen.getByText('王启明')).toBeInTheDocument()
    expect(screen.getByText('王五')).toBeInTheDocument()
    expect(screen.getByText('lisi@example.com')).toBeInTheDocument()

    // 拥有者行静态徽章 + 其余成员行角色下拉（具备 manage 权限）
    expect(document.querySelector('[data-member-role-badge="1"]')?.textContent).toContain('拥有者')
    expect(document.querySelectorAll('[data-member-role-select]')).toHaveLength(3)
  })

  test('邀请弹窗与成员列表联动：POST 成功后底册自动追加并计数 +1', async () => {
    setAuth(['project:view', 'project:member:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))
    expect(document.querySelector('[data-member-invite-open]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-member-invite-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-member-invite-panel]')).not.toBeNull())

    // 从组织成员中勾选（不再手输邮箱）
    await waitFor(() =>
      expect(document.querySelector('[data-member-invite-candidate="900"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-member-invite-candidate="900"]') as Element)
    fireEvent.click(document.querySelector('[data-member-invite-submit]') as Element)

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/members' &&
            record.body?.userId === 900,
        ),
      ).toBe(true),
    )
    // 弹窗关闭 + 缓存失效重拉：新成员追加首行语义（按底册返回顺序）、计数 +1
    await waitFor(() => expect(document.querySelector('[data-member-invite-panel]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(5))
    expect(document.querySelector('[data-member-metric-total]')?.textContent).toContain('共 5 人')
    expect(document.body.textContent).toContain('newcomer@aiproj.internal')
  })
})

describe('ProjectMembersDomainPage：无写权限安全降级（RL-06）', () => {
  test('无 project:member:manage：邀请按钮隐藏、角色控件回退静态徽章、操作列零暴露', async () => {
    setAuth(['project:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))
    expect(document.querySelector('[data-member-invite-open]')).toBeNull()
    expect(document.querySelector('[data-member-invite-modal]')).toBeNull()
    expect(document.querySelectorAll('[data-member-role-badge]')).toHaveLength(4)
    expect(document.querySelector('[data-member-role-select]')).toBeNull()
    expect(document.querySelector('[data-member-transfer-open]')).toBeNull()
    expect(document.querySelector('[data-member-remove-open]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('无 project:view：受限横幅渲染且业务请求零发出', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目成员与团队的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })
})

describe('ProjectMembersDomainPage：RL-05 跨租户与非法 ID 中性 404 防探测', () => {
  test('跨租户项目（organizationId 999 ≠ 当前组织 1）：统一中性 404，成员端点零请求', async () => {
    setAuth(['project:view', 'project:member:manage'])
    const backend = createBackend(999)
    const { records } = installFetchRouter(backend.route)
    renderPage()

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.querySelector('[data-project-space-back-home]')).not.toBeNull()
    // 绝无 403 暴露 / 成员与角色端点零发出
    expect(document.body.textContent).not.toContain('403')
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(records.some((record) => record.url.includes('/members'))).toBe(false)
    expect(records.some((record) => record.url.includes('/roles'))).toBe(false)
  })

  test('非法项目 ID：前端零发包渲染中性 404', async () => {
    setAuth(['project:view', 'project:member:manage'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderPage()

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(records).toHaveLength(0)
  })
})
