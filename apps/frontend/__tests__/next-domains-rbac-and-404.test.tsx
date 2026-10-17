/**
 * v3-ui-next-risk-change-domains W4 · tasks 4.1 —— RBAC 权限守卫与 RL-05
 * 跨租户中性 404 防探测测试（两域页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「RBAC 权限守卫与 RL-05 跨租户中性 404 防泄露」场景）：
 * - 仅有普通权限、无 risk:view 或无 change_request 系权限的用户访问两域主页：
 *   渲染受限横幅（data-permission-fallback）且全局业务请求零发出（RL-06）；
 * - 非数字项目 ID（/next/projects/invalid/risks 与 …/change-requests）零网络
 *   请求直接渲染中性 404 视图（RL-05）；
 * - 跨组织项目访问：项目数据组织不匹配 → 统一渲染中性 ProjectSpaceNotFoundView
 *   （文案恒为「项目不存在或已被移除」），零 403 暴露、零敏感属性泄露（RL-05
 *   防探测），写请求同样零发出。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectRisksDomainPage from '@/app/(next)/next/projects/[id]/risks/page'
import NextProjectChangeRequestsPage from '@/app/(next)/next/projects/[id]/change-requests/page'
import NextProjectNewChangeRequestPage from '@/app/(next)/next/projects/[id]/change-requests/new/page'
import { ChangeRequestDetailPage } from '@/components/next/change-requests/ChangeRequestDetailPage'
import {
  API_PREFIX,
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
} from './helpers/chart-gallery-network'
import type { ChangeRequest } from '@/lib/api/change-requests'

// ---------------------------------------------------------------------------
// next/navigation mock（页面路由消费 useRouter / useParams；usePathname 各页恒定）
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
function setAuth(permissions: string[], organizationId: number | null = 1, userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
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
    description: null,
    changeType: 'scope',
    status: 'submitted',
    priority: 'urgent',
    requesterId: 2,
    approverId: null,
    requestedBy: 2,
    reviewedBy: null,
    impactSummary: null,
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

/** 读请求 URL 清单（过滤掉 api 前缀后的 path）。 */
function requestPaths(records: Array<{ method: string; url: string }>): string[] {
  return records.map((record) => record.url.replace(API_PREFIX, ''))
}

function writeMethods(records: Array<{ method: string; url: string }>): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
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
describe('无域权限访问两域主页：受限横幅 + 业务请求零发出（RL-06）', () => {
  test('仅有普通任务权限、无 risk:view：风险管理主页渲染受限横幅且零网络请求', async () => {
    setAuth(['task:view', 'project:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<ProjectRisksDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目风险工作台的权限')).toBeInTheDocument()
    expect(screen.queryByText('项目不存在或已被移除')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })

  test('持有 risk:view 但无 change_request 系权限：变更请求主页受限横幅且零请求', async () => {
    setAuth(['task:view', 'project:view', 'risk:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<NextProjectChangeRequestsPage />)

    expect(document.querySelector('[data-change-requests-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('暂无变更请求访问权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })

  test('持有 change_request:view（无 create）：变更主页正常可读、新建入口物理隐藏', async () => {
    setAuth(['project:view', 'change_request:view'])
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: makeProject() })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        return jsonResponse(200, {
          data: [makeCr()],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    }
    installFetchRouter(route)
    renderWithClient(<NextProjectChangeRequestsPage />)

    expect(await screen.findByText('增加移动端扫码登录模块')).toBeInTheDocument()
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    // 无 create：新建入口物理隐藏
    expect(document.querySelector('[data-cr-new]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('非法项目 ID：中性 404 视图 + 零网络请求（RL-05）', () => {
  test('/next/projects/invalid/risks：渲染「项目不存在或已被移除」且零请求', async () => {
    setAuth(['risk:view', 'risk:manage'])
    paramsMock.value = { id: 'invalid' }
    const { records } = installFetchRouter(() => null)
    renderWithClient(<ProjectRisksDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(records).toHaveLength(0)
  })

  test('/next/projects/abc/change-requests：中性 404 且零请求', async () => {
    setAuth(['change_request:view', 'change_request:create'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderWithClient(<NextProjectChangeRequestsPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(records).toHaveLength(0)
  })

  test('/next/projects/abc/change-requests/new：新建页同样零请求直接中性 404', async () => {
    setAuth(['change_request:create'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderWithClient(<NextProjectNewChangeRequestPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('跨组织项目访问：统一中性 404 防探测（RL-05）', () => {
  test('风险域：项目 organizationId 不匹配 → 中性 404，除项目校验外零业务请求、零 403', async () => {
    setAuth(['risk:view', 'risk:manage', 'project:view'], 1)
    // 目标项目属于组织 2（当前会话组织 1）
    const foreignProject = makeProject({ organizationId: 2, name: '竞品机密项目引擎' })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: foreignProject })
      }
      return null
    })
    renderWithClient(<ProjectRisksDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    // 中性文案：绝无「无权访问」等泄露存在性的线索
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('竞品机密项目引擎')
    expect(document.body.textContent).not.toContain('无权访问')
    expect(document.body.textContent).not.toContain('403')
    // 风险业务请求（summary/queue/candidates/risks）零发出：仅项目校验一次
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(requestPaths(records)).toEqual(['/projects/42'])
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('变更域主页：跨组织 → 中性 404 空态，CR 数据与项目名零渲染、零写请求', async () => {
    setAuth(['change_request:view', 'change_request:create', 'project:view'], 1)
    const foreignProject = makeProject({ organizationId: 2, name: '他组织绝密项目' })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: foreignProject })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        return jsonResponse(200, {
          data: [makeCr()],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })
    renderWithClient(<NextProjectChangeRequestsPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    // 中性：变更数据 / 项目名 / 存在性线索一律不外露
    expect(document.body.textContent).not.toContain('增加移动端扫码登录模块')
    expect(document.body.textContent).not.toContain('他组织绝密项目')
    expect(document.body.textContent).not.toContain('无权访问')
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('变更域详情页：跨组织项目 → 中性 404（不依赖变更实体是否可达）', async () => {
    setAuth(['change_request:view', 'change_request:create', 'project:view'], 1)
    const foreignProject = makeProject({ organizationId: 2, name: '外部组织项目' })
    const { records } = installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: foreignProject })
      }
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      if (path === '/change-requests/3' && method === 'GET') {
        // 即便变更实体真实存在，跨组织下也不得渲染任何内容
        return jsonResponse(200, { data: makeCr() })
      }
      return null
    })
    renderWithClient(<ChangeRequestDetailPage projectId={42} changeRequestId={3} />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('增加移动端扫码登录模块')
    expect(writeMethods(records)).toHaveLength(0)
    expect(navMock.push).not.toHaveBeenCalled()
  })

  test('跨组织风险域：后续页面无 push/replace 自动跳转（防探测无副作用）', async () => {
    setAuth(['risk:view'], 1)
    const foreignProject = makeProject({ organizationId: 3, name: '绝密' })
    installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(200, { data: foreignProject })
      }
      return null
    })
    renderWithClient(<ProjectRisksDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    await waitFor(() => expect(document.querySelector('[data-project-space-empty]')).not.toBeNull())
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
  })
})
