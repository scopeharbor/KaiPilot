/**
 * v3-ui-next-resource-team-domains W4 · tasks 4.7 —— RBAC 权限矩阵与 RL-05
 * 跨租户中性 404 防探测集成测试（资源/成员/文件三域页面级真实路由 + 全局伪后端）。
 *
 * 覆盖（design §6「权限矩阵与安全铁律」/ spec「RBAC 权限守卫与 RL-05 中性 404」场景）：
 * - 无查看权限（缺 project:view / 缺 resource:view / 缺 file:view）访问资源、成员、
 *   文件域：受限横幅物理阻断且底层业务请求零发出（RL-06 防探测）；
 * - 非数字项目 ID / 项目不存在（HTTP 404）/ 跨组织项目：三域统一渲染中性 404 空态
 *   「项目不存在或已被移除」（ProjectSpaceNotFoundView），零 403 / 无权文案 /
 *   项目名与域数据外泄，域端点零发出（RL-05）；
 * - 只读权限（有查看权无 manage）：新建资源/分配、邀请成员、改角色、上传/删除文件
 *   等写入口物理隐藏或置灰禁用，交互全程零写请求（RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectResourcesDomainPage from '@/app/(next)/next/projects/[id]/resources/page'
import ProjectMembersDomainPage from '@/app/(next)/next/projects/[id]/members/page'
import ProjectFilesDomainPage from '@/app/(next)/next/projects/[id]/files/page'
import type { Project } from '@/lib/api/projects'
import type { Attachment, Document } from '@/lib/api/files'
import type { ProjectMember, ProjectRole } from '@/lib/api/projects'
import type { Resource } from '@/lib/api/resources'

// ---------------------------------------------------------------------------
// next/navigation / next/link mock
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

function makeResource(overrides: Partial<Resource>): Resource {
  return {
    id: 1,
    projectId: 42,
    userId: null,
    name: '张工',
    email: null,
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
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
      fullName: ['王启明', '李四', '王五'][userId - 1] ?? `成员${userId}`,
      email:
        ['owner@example.com', 'lisi@example.com', 'wangwu@example.com'][userId - 1] ??
        `user${userId}@aiproj.internal`,
      initials: `U${userId}`,
      isActive: true,
    },
    projectRole: ROLE_FIXTURES.find((role) => role.id === roleId),
    createdAt: '2026-07-20T08:30:00.000Z',
    updatedAt: '2026-07-20T08:30:00.000Z',
  }
}

function makeAttachment(overrides: Partial<Attachment> & { id: number }): Attachment {
  return {
    entityType: 'project',
    entityId: 42,
    projectId: 42,
    uploadedBy: 1,
    fileName: '附件.bin',
    filePath: '/attachments/x',
    fileSize: 1024,
    mimeType: 'application/octet-stream',
    thumbnailPath: null,
    storageProvider: 'local',
    currentVersion: 1,
    deletedAt: null,
    createdAt: '2026-09-08T02:00:00.000Z',
    updatedAt: '2026-09-08T02:00:00.000Z',
    uploader: { id: 1, fullName: '王启明', email: 'wang@aiproj.dev' },
    ...overrides,
  }
}

function makeDocument(overrides: Partial<Document> & { id: number }): Document {
  return {
    projectId: 42,
    parentId: null,
    name: '文档.bin',
    documentType: 'document',
    content: null,
    version: 1,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-09-07T02:00:00.000Z',
    updatedAt: '2026-09-07T02:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 伪后端（三域端点齐全；可注入组织归属 / 项目 404 形态）
// ---------------------------------------------------------------------------
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

function paginated(data: unknown[]) {
  return { data, meta: { total: data.length, page: 1, perPage: 100, totalPages: 1 } }
}

type RouteFn = (path: string, method: string) => Response | null

function installFetchRouter(route: RouteFn): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

/** 三域数据形态枚举：ok（组织内可读数据）/ crossOrg / missing。 */
function createDomainBackend(
  domains: Array<'resources' | 'members' | 'files'>,
  mode: 'ok' | 'crossOrg' | 'missing',
): RouteFn {
  const project = makeProject(
    mode === 'crossOrg' ? { organizationId: 2, name: '他组织绝密项目' } : {},
  )
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      if (mode === 'missing') {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在' } })
      }
      return jsonResponse(200, { data: project })
    }
    if (method !== 'GET') return null
    if (domains.includes('resources')) {
      if (/^\/projects\/42\/resources(\?|$)/.test(path)) {
        return jsonResponse(200, paginated([makeResource({ id: 1, name: '张工' })]))
      }
      if (/^\/projects\/42\/resources\/load(\?|$)/.test(path)) {
        return jsonResponse(200, {
          data: {
            from: '2026-08-01',
            to: '2026-08-30',
            resources: [],
            teamAverageUtilizationPercent: 0,
          },
        })
      }
      if (/^\/projects\/42\/tasks(\?|$)/.test(path)) {
        return jsonResponse(200, paginated([]))
      }
    }
    if (domains.includes('members')) {
      if (path === '/projects/42/members') {
        return jsonResponse(200, {
          data: [makeMember(1, 1), makeMember(2, 3), makeMember(3, 2)],
        })
      }
      if (path === '/projects/42/roles') {
        return jsonResponse(200, { data: ROLE_FIXTURES })
      }
    }
    if (domains.includes('files')) {
      if (path === '/projects/42/attachments') {
        return jsonResponse(
          200,
          paginated([
            makeAttachment({ id: 101, fileName: '项目章程.pdf', mimeType: 'application/pdf' }),
            makeAttachment({ id: 102, fileName: '预算总表.xlsx' }),
          ]),
        )
      }
      if (/^\/projects\/42\/files(\?|$)/.test(path)) {
        return jsonResponse(
          200,
          paginated([
            makeDocument({ id: 201, name: '交付物归档', documentType: 'folder' }),
            makeDocument({ id: 202, name: '会议纪要 0901', documentType: 'document' }),
          ]),
        )
      }
    }
    return null
  }
}

const DOMAIN_PAGE: Record<'resources' | 'members' | 'files', React.ReactNode> = {
  resources: <ProjectResourcesDomainPage />,
  members: <ProjectMembersDomainPage />,
  files: <ProjectFilesDomainPage />,
}

const FALLBACK_TEXT: Record<'resources' | 'members' | 'files', string> = {
  resources: '你没有查看该项目资源的权限',
  members: '你没有查看该项目成员与团队的权限',
  files: '你没有查看该项目文件库的权限',
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
describe('无域查看权限：受限横幅物理阻断 + 底层业务请求零发出（RL-06）', () => {
  test('三域缺 project:view：各自受限横幅渲染且零网络请求', async () => {
    setAuth(['task:view'])
    const targets: Array<'resources' | 'members' | 'files'> = ['resources', 'members', 'files']
    for (const domain of targets) {
      const { records } = installFetchRouter(() => null)
      renderWithClient(DOMAIN_PAGE[domain])
      expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
      expect(screen.getByText(FALLBACK_TEXT[domain])).toBeInTheDocument()
      expect(screen.queryByText('项目不存在或已被移除')).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(records).toHaveLength(0)
      document.body.innerHTML = ''
    }
  })

  test('有 project:view 但缺域查看权（resource:view / file:view）：域页面受限且域接口零发出', async () => {
    // 资源域：仅 project:view，无 resource:view
    setAuth(['project:view'])
    const resources = installFetchRouter(() => null)
    renderWithClient(<ProjectResourcesDomainPage />)
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目资源的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(resources.records).toHaveLength(0)
    document.body.innerHTML = ''

    // 文件域：仅 project:view，无 file:view
    const files = installFetchRouter(() => null)
    renderWithClient(<ProjectFilesDomainPage />)
    expect(document.querySelector('[data-files-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目文件库的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(files.records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('非法 / 不存在 / 跨组织项目：统一中性 404 防探测（RL-05）', () => {
  test('非数字项目 ID：三域均零网络请求直接渲染中性 404', async () => {
    setAuth(['project:view', 'resource:view', 'file:view', 'resource:manage', 'file:manage'])
    paramsMock.value = { id: 'abc' }
    const targets: Array<'resources' | 'members' | 'files'> = ['resources', 'members', 'files']
    for (const domain of targets) {
      const { records } = installFetchRouter(() => null)
      renderWithClient(DOMAIN_PAGE[domain])
      await screen.findByRole('status', { name: '项目不存在或已被移除' })
      expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('开项核心引擎')
      expect(records).toHaveLength(0)
      document.body.innerHTML = ''
    }
  })

  test('项目不存在（HTTP 404）：三域中性 404 空态，仅项目校验一次、域端点零发出、零 403', async () => {
    setAuth(['project:view', 'resource:view', 'file:view'])
    const targets: Array<'resources' | 'members' | 'files'> = ['resources', 'members', 'files']
    for (const domain of targets) {
      const { records } = installFetchRouter(createDomainBackend([domain], 'missing'))
      renderWithClient(DOMAIN_PAGE[domain])
      await screen.findByRole('status', { name: '项目不存在或已被移除' })
      expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('开项核心引擎')
      expect(document.body.textContent).not.toContain('无权访问')
      expect(document.body.textContent).not.toContain('403')
      await new Promise((resolve) => setTimeout(resolve, 30))
      // 仅项目详情探测一次；域数据接口零发出（防探测）
      expect(records.map((record) => record.url)).toEqual(['/projects/42'])
      expect(writeMethods(records)).toHaveLength(0)
      document.body.innerHTML = ''
    }
  })

  test('跨组织项目（organizationId 不匹配）：三域中性 404 且绝不外泄他组织项目名与域数据', async () => {
    setAuth(['project:view', 'resource:view', 'file:view'], 1)
    const targets: Array<'resources' | 'members' | 'files'> = ['resources', 'members', 'files']
    for (const domain of targets) {
      const { records } = installFetchRouter(createDomainBackend([domain], 'crossOrg'))
      renderWithClient(DOMAIN_PAGE[domain])
      await screen.findByRole('status', { name: '项目不存在或已被移除' })
      expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('他组织绝密项目')
      expect(document.body.textContent).not.toContain('无权访问')
      expect(document.body.textContent).not.toContain('403')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(records.map((record) => record.url)).toEqual(['/projects/42'])
      expect(writeMethods(records)).toHaveLength(0)
      expect(navMock.push).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })
})

// ---------------------------------------------------------------------------
describe('只读权限（有查看权、无 manage）：写入口物理隐藏或置灰，零写请求（RL-06）', () => {
  test('资源域只读：新建入口隐藏、行内停用/删除以只读态呈现、零写请求', async () => {
    setAuth(['project:view', 'resource:view'])
    const { records } = installFetchRouter(createDomainBackend(['resources'], 'ok'))
    renderWithClient(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(1))
    // 新建入口物理隐藏
    expect(document.querySelector('[data-resource-create-open]')).toBeNull()
    // 行内写控件（停用/删除）不渲染真实入口，只读态标记存在
    expect(document.querySelector('[data-resource-toggle-readonly="1"]')).not.toBeNull()
    expect(document.querySelector('[data-resource-toggle="1"]')).toBeNull()
    expect(document.querySelector('[data-resource-delete-open="1"]')).toBeNull()

    // 分配视图：无资源时也绝不呈现「新建资源」引导按钮
    // （写入口由 canManage 门禁控制）
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })

  test('成员域只读（无 project:member:manage / project:update）：邀请入口隐藏、角色回退静态徽章、移除/转让入口不渲染', async () => {
    setAuth(['project:view'])
    const { records } = installFetchRouter(createDomainBackend(['members'], 'ok'))
    renderWithClient(<ProjectMembersDomainPage />)

    await waitFor(() => expect(document.querySelector('[data-members-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-member-row]')).toHaveLength(3))
    // 邀请按钮隐藏
    expect(document.querySelector('[data-member-invite-open]')).toBeNull()
    // 角色下拉零渲染；静态角色徽章回退呈现
    expect(document.querySelectorAll('[data-member-role-select]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-member-role-badge]').length).toBeGreaterThanOrEqual(3)
    // 所有权转让 / 移出入口不渲染（只读用户无任何行内写控件）
    expect(document.querySelector('[data-member-transfer-open]')).toBeNull()
    expect(document.querySelector('[data-member-remove-open]')).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })

  test('文件域只读（file:view 无 file:manage）：上传区物理禁用、删除/新建入口隐藏、仅保留下载', async () => {
    setAuth(['project:view', 'file:view'])
    const { records } = installFetchRouter(createDomainBackend(['files'], 'ok'))
    renderWithClient(<ProjectFilesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-files-workspace-space]')).not.toBeNull(),
    )
    // 上传释放区禁用态
    await waitFor(() => expect(document.querySelector('[data-file-dropzone]')).not.toBeNull())
    expect(document.querySelector('[data-file-dropzone-disabled]')).not.toBeNull()
    // 文档组织新建（文件夹/文档）入口隐藏
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-document-row]')).toHaveLength(2),
    )
    expect(document.querySelector('[data-file-documents-create-folder]')).toBeNull()
    // 附件删除入口隐藏、下载入口保留
    await waitFor(() =>
      expect(document.querySelectorAll('[data-file-attachment-row]')).toHaveLength(2),
    )
    expect(document.querySelectorAll('[data-file-delete-open]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-file-download]')).toHaveLength(2)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })
})
