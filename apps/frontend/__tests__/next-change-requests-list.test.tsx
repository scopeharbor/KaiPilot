/**
 * v3-ui-next-risk-change-domains W2 · tasks 2.2 —— 变更请求新轨列表页
 * 渲染、多维组合筛选与行导航测试（页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「变更请求新轨列表与多维检索过滤」）：
 * - 列表数据加载与高密度表格渲染（CR 编码/标题/类型/状态/优先级/申请人/提交时间）；
 * - 双通道状态徽标（文本 + 图标）与优先级色标映射；
 * - 多维组合筛选（状态 × 优先级 × 日期范围…）触发服务端过滤且页码重置为第 1 页；
 * - 空态区分：无数据（暂无变更请求 + 新建引导）与筛选无匹配（未找到匹配的记录 +
 *   清除筛选条件）；
 * - 点击行平滑导航至详情主页；非法项目 ID 零网络请求中性 404（RL-05）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Project } from '@/lib/api/projects'
import type { ChangeRequest } from '@/lib/api/change-requests'
import NextProjectChangeRequestsPage from '@/app/(next)/next/projects/[id]/change-requests/page'
import { useAuthStore } from '@/stores/auth-store'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
  API_PREFIX,
} from './helpers/chart-gallery-network'

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/change-requests',
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

function makeCr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 3,
    crCode: 'CR-2026-003',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: '在现有账号体系外补充扫码登录通道',
    changeType: 'scope',
    status: 'submitted',
    priority: 'urgent',
    requesterId: 1,
    approverId: null,
    requestedBy: 1,
    reviewedBy: null,
    impactSummary: { scope: '新增登录入口', schedule: '整体延期 5 天' },
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: '2026-09-05T02:30:00.000Z',
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-05T02:30:00.000Z',
    currentImpactAnalysisId: null,
    approveRefAnalysisId: null,
    impactAnalysisConfirmStatus: null,
    ...overrides,
  }
}

function makeMembers() {
  return [
    {
      id: 1,
      projectId: 42,
      userId: 1,
      projectRoleId: null,
      isActive: true,
      user: { id: 1, fullName: '王启明', email: 'pm@example.com', initials: '王', isActive: true },
    },
    {
      id: 2,
      projectId: 42,
      userId: 2,
      projectRoleId: null,
      isActive: true,
      user: { id: 2, fullName: '李思远', email: 'li@example.com', initials: '李', isActive: true },
    },
  ]
}

const emptyMeta = { total: 0, page: 1, perPage: 20, totalPages: 1 }

function changeRequestsBackend(
  project: Project = makeProject(),
  rows: ChangeRequest[] = [],
  meta: { total: number; page: number; perPage: number; totalPages: number } = emptyMeta,
) {
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: project })
    }
    if (path === '/projects/42/members' && method === 'GET') {
      return jsonResponse(200, { data: makeMembers() })
    }
    if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
      return jsonResponse(200, { data: rows, meta })
    }
    return null
  }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth(['change_request:view', 'change_request:create'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('列表渲染与双通道状态（spec「用户在变更列表中查看全部变更」）', () => {
  test('加载完成后渲染高密度表格行：编码/标题/类型/状态徽标/优先级/申请人/提交时间', async () => {
    const urgent = makeCr()
    const draft = makeCr({
      id: 5,
      crCode: 'CR-2026-005',
      title: '升级核心数据库连接池',
      changeType: 'quality',
      status: 'draft',
      priority: 'medium',
      requesterId: 2,
      requestedBy: 2,
      submittedAt: null,
      createdAt: '2026-09-02T08:00:00.000Z',
    })
    installFetchRouter(
      changeRequestsBackend(makeProject(), [urgent, draft], {
        total: 2,
        page: 1,
        perPage: 20,
        totalPages: 1,
      }),
    )
    renderPage(<NextProjectChangeRequestsPage />)

    expect(await screen.findByText('变更请求')).toBeInTheDocument()
    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
    expect(screen.getByText('升级核心数据库连接池')).toBeInTheDocument()
    // 行级状态与类型数据属性（双通道定位）
    expect(document.querySelector('[data-cr-row-id="3"]')).not.toBeNull()
    expect(document.querySelector('[data-cr-row-status="submitted"]')).not.toBeNull()
    expect(document.querySelector('[data-cr-status="submitted"]')?.textContent).toContain('已提交')
    expect(document.querySelector('[data-cr-status="draft"]')?.textContent).toContain('草稿')
    expect(document.querySelector('[data-cr-type="scope"]')?.textContent).toContain('范围')
    expect(document.querySelector('[data-cr-priority="urgent"]')?.textContent).toContain('紧急')
    // 双通道：状态徽标内存在语义图标（svg）与文本并存
    const statusBadge = document.querySelector('[data-cr-status="submitted"]')
    expect(statusBadge?.querySelector('svg')).not.toBeNull()
    // 申请人名称由成员映射解析
    expect(document.querySelector('[data-cr-row-id="5"]')?.textContent).toContain('李思远')
    // 顶栏返回项目空间 + 新建入口
    expect(screen.getByLabelText('返回项目主空间')).toHaveAttribute('href', '/next/projects/42')
    expect(document.querySelector('[data-cr-new]')).not.toBeNull()
  })

  test('状态空态：无任何变更请求时展示「暂无变更请求」与新建引导', async () => {
    installFetchRouter(changeRequestsBackend(makeProject(), [], emptyMeta))
    renderPage(<NextProjectChangeRequestsPage />)
    expect(await screen.findByText('暂无变更请求')).toBeInTheDocument()
    expect(document.querySelector('[data-cr-empty-create]')).not.toBeNull()
    expect(document.querySelector('[data-cr-table]')).toBeNull()
  })

  test('无 change_request:create 权限时新建按钮物理隐藏（有 view 仍可浏览）', async () => {
    setAuth(['change_request:view'])
    const cr = makeCr()
    installFetchRouter(
      changeRequestsBackend(makeProject(), [cr], {
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      }),
    )
    renderPage(<NextProjectChangeRequestsPage />)
    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
    expect(document.querySelector('[data-cr-new]')).toBeNull()
  })
})

describe('多维组合筛选（spec「组合过滤 + 页码重置」）', () => {
  test('筛选「已提交」×「紧急」时按服务端过滤且页码重置为第 1 页', async () => {
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: makeMembers() })
      }
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        const url = new URL(`${API_PREFIX}${path}`)
        const hasFilter = url.searchParams.get('status') !== null
        if (hasFilter) {
          return jsonResponse(200, {
            data: [makeCr()],
            meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
          })
        }
        return jsonResponse(200, {
          data: Array.from({ length: 25 }, (_, index) =>
            makeCr({ id: 100 + index, crCode: `CR-2026-${String(100 + index)}` }),
          ),
          meta: { total: 25, page: 1, perPage: 20, totalPages: 2 },
        })
      }
      return null
    }
    const { records } = installFetchRouter(route)
    renderPage(<NextProjectChangeRequestsPage />)

    // 首页 25 条 → 分页器出现，进入第 2 页
    const nextButton = await screen.findByText('下一页')
    fireEvent.click(nextButton)
    await waitFor(() => {
      expect(records.some((record) => record.url.includes('page=2'))).toBe(true)
    })

    // 组合筛选：状态=已提交，优先级=紧急
    fireEvent.change(document.querySelector('[data-cr-filter-status]')!, {
      target: { value: 'submitted' },
    })
    fireEvent.change(document.querySelector('[data-cr-filter-priority]')!, {
      target: { value: 'urgent' },
    })
    await waitFor(() => {
      const last = records[records.length - 1]!
      expect(last.url).toContain('status=submitted')
      expect(last.url).toContain('priority=urgent')
      // 页码重置为第 1 页（page=1）
      expect(last.url).toContain('page=1')
    })
    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-cr-row]')).toHaveLength(1)
  })

  test('日期范围与申请人筛选加入查询串', async () => {
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: makeMembers() })
      }
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        const url = new URL(`${API_PREFIX}${path}`)
        if (url.searchParams.get('requesterId') !== null || url.searchParams.get('startDate')) {
          return jsonResponse(200, {
            data: [makeCr()],
            meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
          })
        }
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      return null
    }
    const { records } = installFetchRouter(route)
    renderPage(<NextProjectChangeRequestsPage />)
    await screen.findByText('变更请求')

    // 申请人下拉来自项目成员
    fireEvent.change(document.querySelector('[data-cr-filter-requester]')!, {
      target: { value: '2' },
    })
    fireEvent.change(document.querySelector('[data-cr-filter-start-date]')!, {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(document.querySelector('[data-cr-filter-end-date]')!, {
      target: { value: '2026-09-30' },
    })
    await waitFor(() => {
      const last = records[records.length - 1]!
      expect(last.url).toContain('requesterId=2')
      expect(last.url).toContain('startDate=2026-09-01')
      expect(last.url).toContain('endDate=2026-09-30')
      expect(last.url).toContain('page=1')
    })
  })

  test('筛选无匹配时展示「未找到匹配的记录」，清除筛选恢复全量', async () => {
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: makeMembers() })
      }
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        const url = new URL(`${API_PREFIX}${path}`)
        if (url.searchParams.get('status') === 'rejected') {
          return jsonResponse(200, { data: [], meta: emptyMeta })
        }
        return jsonResponse(200, {
          data: [makeCr()],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    }
    const { records } = installFetchRouter(route)
    renderPage(<NextProjectChangeRequestsPage />)
    await screen.findByText('增加移动端扫码登录模块')

    fireEvent.change(document.querySelector('[data-cr-filter-status]')!, {
      target: { value: 'rejected' },
    })
    expect(await screen.findByText('未找到匹配的记录')).toBeInTheDocument()
    expect(
      screen.getByText('当前组合筛选条件下没有变更请求，可清除筛选条件查看全部。'),
    ).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-cr-empty-reset]')!)
    await waitFor(() => {
      const last = records[records.length - 1]!
      expect(last.url).not.toContain('status=')
    })
    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
  })
})

describe('行导航与 RL-05 中性守卫', () => {
  test('点击表格行平滑路由跳转至详情主页', async () => {
    installFetchRouter(
      changeRequestsBackend(makeProject(), [makeCr()], {
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
      }),
    )
    renderPage(<NextProjectChangeRequestsPage />)
    const row = await screen.findByText('增加移动端扫码登录模块')
    fireEvent.click(row.closest('[data-cr-row]')!)
    await waitFor(() => {
      expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests/3')
    })
  })

  test('非法项目 ID：零网络请求直接渲染中性 404（RL-05）', async () => {
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderPage(<NextProjectChangeRequestsPage />)
    expect(await screen.findByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(records).toHaveLength(0)
  })

  test('无任何变更域权限：受限横幅 + 零业务数据请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<NextProjectChangeRequestsPage />)
    expect(await screen.findByText('暂无变更请求访问权限')).toBeInTheDocument()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(records).toHaveLength(0)
  })
})
