/**
 * v3-ui-next-resource-team-domains W2 · tasks 2.4 —— 成员底册与受控角色/转让/移除操作测试
 * （容器级：ProjectMembersWorkspace + 伪后端全端点语义）。
 *
 * 覆盖（spec「项目成员列表底册与项目角色管理」/ tasks 2.3）：
 * - 成员底册数据渲染：姓名 / 邮箱 / 角色徽章 / 加入时间 / 头像缩写 + 人数度量；
 * - 角色下拉变更触发 PATCH /members/:userId 并即时更新角色徽章；
 * - 项目所有权转让：仅拥有者可发起、阻断式二次确认（取消零请求 / 确认后
 *   POST /transfer-owner），成功后新旧 Owner 徽章对调；
 * - 任何 Owner 行「移出」按钮一律物理 disabled 且附带 Tooltip 警示（对齐后端
 *   拒绝移除任意 Project Owner 语义，含多位拥有者场景）；
 * - 普通成员移出二次确认（取消不动 / 确认 DELETE 后行从底册移除）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { ProjectMembersWorkspace } from '@/components/next/members/ProjectMembersWorkspace'
import type { Project, ProjectMember, ProjectRole } from '@/lib/api/projects'

// ---------------------------------------------------------------------------
// next/navigation mock（workspace / DomainPageHeader 消费 router）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/members',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], userId = 1) {
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
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
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

function makeRole(id: number): ProjectRole {
  const role = ROLE_FIXTURES.find((item) => item.id === id)
  if (!role) throw new Error(`未知角色夹具 id=${id}`)
  return { ...role }
}

function makeMember(
  userId: number,
  roleId: number | null,
  overrides: Partial<ProjectMember> = {},
): ProjectMember {
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
      initials: ['WQM', 'LS', 'WW', 'ZL'][userId - 1] ?? `U${userId}`,
      isActive: true,
    },
    projectRole: roleId ? makeRole(roleId) : undefined,
    createdAt: '2026-07-20T08:30:00.000Z',
    updatedAt: '2026-07-20T08:30:00.000Z',
    ...overrides,
  }
}

function defaultRoster(): ProjectMember[] {
  return [
    makeMember(1, 1), // 王启明 · 拥有者（当前账号）
    makeMember(2, 3), // 李四 · 成员
    makeMember(3, 2), // 王五 · 项目经理
    makeMember(4, 3), // 赵六 · 成员
  ]
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
  route: (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | Promise<Response> | null,
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
    const matched = await route(path, method, body)
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

/** 伪后端：成员底册 / 角色 / 角色调整 / 移除 / 转让全端点语义。 */
function createBackend() {
  const roster = defaultRoster()
  const project = makeProject()

  const memberDto = (member: ProjectMember): ProjectMember => member
  const findMember = (userId: number) => roster.find((member) => member.userId === userId)

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // 项目上下文
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: project })
    }
    if (path === '/projects/42/roles' && method === 'GET') {
      return jsonResponse(200, { data: ROLE_FIXTURES })
    }
    if (path === '/projects/42/members' && method === 'GET') {
      return jsonResponse(200, { data: roster.map(memberDto) })
    }
    // 邀请（本文件不用，占位返回 409 语义即可）
    if (path === '/projects/42/members/invite' && method === 'POST') {
      return jsonResponse(409, {
        error: { code: 'ALREADY_MEMBER', message: '该用户已是项目成员' },
      })
    }
    // 变更角色 PATCH /members/:userId
    const patchMatch = path.match(/^\/projects\/42\/members\/(\d+)$/)
    if (patchMatch && method === 'PATCH') {
      const userId = Number(patchMatch[1])
      const member = findMember(userId)
      if (!member) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '成员不存在' } })
      const projectRoleId = Number(body?.projectRoleId)
      if (!ROLE_FIXTURES.some((role) => role.id === projectRoleId)) {
        return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', message: '项目角色不存在' } })
      }
      member.projectRoleId = projectRoleId
      member.projectRole = makeRole(projectRoleId)
      return jsonResponse(200, { data: memberDto(member) })
    }
    // 移除 DELETE /members/:userId
    const deleteMatch = path.match(/^\/projects\/42\/members\/(\d+)$/)
    if (deleteMatch && method === 'DELETE') {
      const userId = Number(deleteMatch[1])
      const index = roster.findIndex((member) => member.userId === userId)
      if (index < 0)
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '成员不存在' } })
      const [removed] = roster.splice(index, 1)
      if (!removed)
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '成员不存在' } })
      return jsonResponse(204, {})
    }
    // 所有权转让 POST /transfer-owner
    if (path === '/projects/42/transfer-owner' && method === 'POST') {
      const targetUserId = Number(body?.userId)
      const target = findMember(targetUserId)
      const owner = roster.find((member) => member.projectRoleId === 1)
      if (!target || !owner) {
        return jsonResponse(404, { error: { code: 'NOT_FOUND', message: '目标成员不存在' } })
      }
      target.projectRoleId = 1
      target.projectRole = makeRole(1)
      owner.projectRoleId = 2
      owner.projectRole = makeRole(2)
      return jsonResponse(200, {
        data: { project, previousOwnerId: owner.userId, newOwnerId: target.userId },
      })
    }
    return null
  }

  return { roster, project, route }
}

// ---------------------------------------------------------------------------
// 渲染基建
// ---------------------------------------------------------------------------
function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProjectMembersWorkspace projectId={42} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('ProjectMembersWorkspace：成员底册数据渲染（spec 场景「浏览项目成员底册」）', () => {
  test('成员表渲染姓名 / 邮箱 / 角色徽章 / 加入时间，度量卡回显共 4 人', async () => {
    setAuth(['project:view', 'project:member:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderWorkspace()

    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-members-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))

    // 度量卡：总数与拥有者数
    const metricTotal = document.querySelector('[data-member-metric-total]')
    expect(metricTotal?.textContent).toContain('共 4 人')
    expect(metricTotal?.getAttribute('data-member-metric-total')).toBe('4')
    expect(
      document
        .querySelector('[data-member-metric-owners]')
        ?.getAttribute('data-member-metric-owners'),
    ).toBe('1')

    // 成员行字段
    expect(screen.getByText('王启明')).toBeInTheDocument()
    expect(screen.getByText('李四')).toBeInTheDocument()
    expect(screen.getByText('lisi@example.com')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-member-email]')).toHaveLength(4)
    expect(document.body.textContent).toContain('wangwu@example.com')
    expect(document.body.textContent).toContain('2026-07-20')

    // 拥有者行静态徽章（即使有写权限也不出下拉），普通成员行是下拉
    const ownerBadge = document.querySelector('[data-member-role-badge="1"]')
    expect(ownerBadge?.textContent).toContain('拥有者')
    expect(document.querySelector('[data-member-role-select="1"]')).toBeNull()
    expect(document.querySelector('[data-member-role-select="2"]')).not.toBeNull()
    expect(document.querySelector('[data-member-role-select="2"]')?.textContent).toContain(
      '项目经理',
    )
  })

  test('只读权限：角色下拉不渲染（静态徽章），操作列零暴露', async () => {
    setAuth(['project:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))
    expect(document.querySelector('[data-member-role-select]')).toBeNull()
    expect(document.querySelector('[data-member-role-badge="2"]')?.textContent).toContain('成员')
    expect(document.querySelector('[data-member-transfer-open]')).toBeNull()
    expect(document.querySelector('[data-member-remove-open]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)
  })
})

describe('ProjectMembersWorkspace：角色调整（spec 场景「修改成员项目角色并即时更新」）', () => {
  test('下拉选择新角色 → PATCH /members/:userId → 徽章即时更新', async () => {
    setAuth(['project:view', 'project:member:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))
    const roleSelect = document.querySelector('[data-member-role-select="2"]') as HTMLSelectElement
    expect(roleSelect).not.toBeNull()
    expect(roleSelect.value).toBe('3') // 李四当前为 Member

    fireEvent.change(roleSelect, { target: { value: '2' } }) // 调整为项目经理

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'PATCH' &&
            record.url === '/projects/42/members/2' &&
            record.body?.projectRoleId === 2,
        ),
      ).toBe(true),
    )
    // 底册缓存失效重拉后下拉即时指向新角色
    await waitFor(() =>
      expect(
        (document.querySelector('[data-member-role-select="2"]') as HTMLSelectElement).value,
      ).toBe('2'),
    )
    expect(writeMethods(records)).toEqual(['PATCH'])
  })
})

describe('ProjectMembersWorkspace：所有权转让阻断式确认（spec 场景「转让项目所有权」）', () => {
  test('仅当前拥有者可发起；取消零请求；确认后 POST transfer-owner 且新旧徽章对调', async () => {
    setAuth(['project:view', 'project:member:manage'], 1)
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))

    // 转让入口仅出现于「其他非拥有者成员行」：自己（Owner）行与角色下拉均无入口
    expect(document.querySelector('[data-member-transfer-open="1"]')).toBeNull() // 自己行无入口
    expect(document.querySelector('[data-member-transfer-open="2"]')).not.toBeNull()
    expect(document.querySelector('[data-member-transfer-open="3"]')).not.toBeNull()

    // 取消路径：弹窗阻断，取消后零写请求
    fireEvent.click(document.querySelector('[data-member-transfer-open="3"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-member-transfer-dialog]')).not.toBeNull(),
    )
    expect(
      screen.getByText(/转让所有权后，你将不再拥有该项目的拥有者专属管辖权/),
    ).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-member-transfer-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-member-transfer-dialog]')).toBeNull())
    expect(writeMethods(records)).toHaveLength(0)

    // 确认路径：POST transfer-owner，目标（王五）成为拥有者、原拥有者降为项目经理
    fireEvent.click(document.querySelector('[data-member-transfer-open="3"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-member-transfer-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-member-transfer-confirm]') as Element)

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/transfer-owner' &&
            record.body?.userId === 3,
        ),
      ).toBe(true),
    )
    await waitFor(() => {
      const targetBadge = document.querySelector('[data-member-role-badge="3"]')
      expect(targetBadge?.textContent).toContain('拥有者')
    })
    // 原拥有者降为项目经理：行内角色下拉即时指向项目经理（不再持有拥有者专属管辖权）
    await waitFor(() => {
      const oldOwnerSelect = document.querySelector(
        '[data-member-role-select="1"]',
      ) as HTMLSelectElement | null
      expect(oldOwnerSelect).not.toBeNull()
      expect(oldOwnerSelect?.value).toBe('2')
      expect(oldOwnerSelect?.textContent).toContain('项目经理')
    })
  })
})

describe('ProjectMembersWorkspace：拥有者移除阻断（任何 Owner）与普通成员移除', () => {
  test('拥有者行：移出按钮 disabled 且悬停 Tooltip 警示（spec 场景「尝试移除项目拥有者时被系统阻断」）', async () => {
    setAuth(['project:view', 'project:member:manage'], 1)
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))

    const ownerRemove = document.querySelector('[data-member-remove-open="1"]') as HTMLButtonElement
    expect(ownerRemove).not.toBeNull()
    expect(ownerRemove.disabled).toBe(true)
    expect(ownerRemove.getAttribute('aria-disabled')).toBe('true')

    const tip = document.querySelector('[data-member-owner-remove-tip="1"]')
    expect(tip?.getAttribute('role')).toBe('tooltip')
    expect(tip?.textContent).toContain('不能移除项目拥有者，请先转让所有权')

    // 点击 disabled 按钮不产生任何请求
    fireEvent.click(ownerRemove)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector('[data-member-remove-dialog]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)

    // 非拥有者行移除按钮可用
    const normalRemove = document.querySelector(
      '[data-member-remove-open="2"]',
    ) as HTMLButtonElement
    expect(normalRemove.disabled).toBe(false)
  })

  test('多位拥有者场景：任一 Owner 行移除按钮均 disabled 且带 Tooltip，零请求', async () => {
    setAuth(['project:view', 'project:member:manage'], 1)
    const backend = createBackend()
    backend.roster.push(makeMember(5, 1)) // 追加第二位 Owner（用户 5）
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(5))

    for (const ownerId of [1, 5]) {
      const remove = document.querySelector(
        `[data-member-remove-open="${ownerId}"]`,
      ) as HTMLButtonElement
      expect(remove).not.toBeNull()
      expect(remove.disabled).toBe(true)
      expect(remove.getAttribute('aria-disabled')).toBe('true')
      const tip = document.querySelector(`[data-member-owner-remove-tip="${ownerId}"]`)
      expect(tip?.getAttribute('role')).toBe('tooltip')
      expect(tip?.textContent).toContain('不能移除项目拥有者，请先转让所有权')
      fireEvent.click(remove)
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector('[data-member-remove-dialog]')).toBeNull()
    expect(writeMethods(records)).toHaveLength(0)

    // 普通成员行不受影响，仍可发起移除确认
    const normalRemove = document.querySelector(
      '[data-member-remove-open="2"]',
    ) as HTMLButtonElement
    expect(normalRemove.disabled).toBe(false)
  })

  test('普通成员移除：取消不动；确认 DELETE 后行从底册移除', async () => {
    setAuth(['project:view', 'project:member:manage'], 1)
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(4))

    // 取消路径
    fireEvent.click(document.querySelector('[data-member-remove-open="2"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-member-remove-dialog]')).not.toBeNull(),
    )
    expect(screen.getByText(/移出成员将解除/)).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-member-remove-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-member-remove-dialog]')).toBeNull())
    expect(writeMethods(records)).toHaveLength(0)

    // 确认路径：DELETE /members/2 后行消失、总数减一
    fireEvent.click(document.querySelector('[data-member-remove-open="2"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-member-remove-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-member-remove-confirm]') as Element)
    await waitFor(() =>
      expect(
        records.some(
          (record) => record.method === 'DELETE' && record.url === '/projects/42/members/2',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(3))
    expect(document.querySelector('[data-member-row="2"]')).toBeNull()
    expect(document.body.textContent).not.toContain('lisi@example.com')
    expect(document.querySelector('[data-member-metric-total]')?.textContent).toContain('共 3 人')
  })
})
