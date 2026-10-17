/**
 * v3-ui-next-risk-change-domains W4 · tasks 4.2 —— 精确档仪器感降级、加载骨架屏
 * 与错误重试测试（两域页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「精确档仪器感降级与系统状态完备性」场景）：
 * - precise 档（useNextTrackStore.immersionTier='precise'）：
 *   - html[data-immersion='precise'] 同步；
 *   - 风险 / 变更 / 变更详情各工作面根节点停用 .nx-space-atmosphere 深空光晕类，
 *     纯色 `--nx-workspace-bg` 实底；子树无任何 shadow/backdrop 发光滤镜类；
 *   - 卡片/表格/面板统一 1px 发丝线边框（border-[var(--nx-border-hairline)]）；
 * - immersive 对照：同页根节点消费 .nx-space-atmosphere（证明精确档确实切换）；
 * - 数据加载期间：仪器感骨架屏（role=status + aria-busy="true"），空态元素零闪现
 *   （杜绝「暂无…」误报）；
 * - 接口 500：规范错误卡（role=alert）+「重新载入」重试成功闭环（两域各一例）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import ProjectRisksDomainPage from '@/app/(next)/next/projects/[id]/risks/page'
import NextProjectChangeRequestsPage from '@/app/(next)/next/projects/[id]/change-requests/page'
import NextProjectChangeRequestDetailPage from '@/app/(next)/next/projects/[id]/change-requests/[crId]/page'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
} from './helpers/chart-gallery-network'
import type { ChangeRequest } from '@/lib/api/change-requests'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42', crId: '7' } as Record<string, string> }))
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

function makeSummary() {
  return {
    totalRisks: 6,
    openRisks: 5,
    highRiskCount: 2,
    criticalRiskCount: 1,
    overdueReviewCount: 1,
    incompleteResponsePlans: 1,
    trend30d: { created: 3, closed: 1 },
    healthScore: 72,
    topRisks: [
      {
        id: 101,
        title: '核心数据库迁移导致服务中断',
        riskLevel: 'critical',
        score: 20,
        status: 'identified',
      },
      { id: 103, title: '关键开发人员离职', riskLevel: 'high', score: 16, status: 'mitigating' },
    ],
  }
}

function makeQueue() {
  return [
    {
      id: 103,
      title: '关键开发人员离职',
      riskLevel: 'high',
      score: 16,
      nextReviewAt: '2025-10-01T00:00:00.000Z',
      lastReviewAt: '2025-08-01T00:00:00.000Z',
      ownerId: 1,
    },
  ]
}

function makeCr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 7,
    crCode: 'CR-2026-007',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: '在现有账号体系外补充扫码登录通道',
    changeType: 'scope',
    status: 'submitted',
    priority: 'high',
    requesterId: 2,
    approverId: null,
    requestedBy: 2,
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

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** 断言子树内不存在光晕/发光/渐变滤镜类（RL-15 精确档纯色降级）。 */
function expectNoGlowWithin(root: Element | null) {
  expect(root).not.toBeNull()
  const glowNodes = root?.querySelectorAll(
    '.nx-space-atmosphere, [class*="shadow-"], [class*="backdrop-"]',
  )
  expect(glowNodes).toHaveLength(0)
}

function expectHairlineBorder(node: Element | null) {
  expect(node?.className.toString()).toContain('border-[var(--nx-border-hairline)]')
}

/** 风险域路由全端点（项目 + 工作台三查询）。 */
function riskBackend() {
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
      return jsonResponse(200, { data: makeSummary() })
    }
    if (path === '/projects/42/risks/workbench/review-queue' && method === 'GET') {
      return jsonResponse(200, { data: makeQueue() })
    }
    return null
  }
}

/** 变更域路由端点（项目 + 成员 + 列表/详情 + 影响分析空列表 + 评论空列表）。 */
function changeBackend(cr: ChangeRequest) {
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (path === '/projects/42/members' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
      return jsonResponse(200, {
        data: [cr],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (path === '/change-requests/7' && method === 'GET') {
      return jsonResponse(200, { data: cr })
    }
    if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 10, totalPages: 1 },
      })
    }
    if (path.startsWith('/projects/42/comments') && method === 'GET') {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
      })
    }
    return null
  }
}

beforeEach(() => {
  paramsMock.value = { id: '42', crId: '7' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
describe('精确档（precise）：纯色仪器降级，停用深空光晕（spec 场景 1）', () => {
  test('precise 档风险工作台：根节点停用 nx-space-atmosphere、发丝线边框、子树零发光滤镜', async () => {
    setAuth(['risk:view', 'risk:manage'])
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(riskBackend())
    const preciseRisks = renderWithClient(<ProjectRisksDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    // 沉浸档同步到 html（useImmersionTier effect）
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    const root = document.querySelector('[data-risk-workspace-space]')
    expect(root?.className.toString()).not.toContain('nx-space-atmosphere')
    expect(root?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
    // 工作台容器与头部卡统一 1px 发丝线
    expectHairlineBorder(root)
    // 纯色降级：子树无光晕类、无任何发光阴影/背景滤镜类
    expectNoGlowWithin(root)

    // 数据加载后内容正常呈现（降级不改语义）
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
    expect(screen.getByText('开项核心引擎 · 风险管理')).toBeInTheDocument()
    await act(async () => {
      preciseRisks.unmount()
    })
  })

  test('immersive 对照：同页根节点消费 .nx-space-atmosphere（证明 precise 确实切换）', async () => {
    setAuth(['risk:view', 'risk:manage'])
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    installFetchRouter(riskBackend())
    const immersiveRisks = renderWithClient(<ProjectRisksDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    const root = document.querySelector('[data-risk-workspace-space]')
    expect(root?.className.toString()).toContain('nx-space-atmosphere')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
    await act(async () => {
      immersiveRisks.unmount()
    })
  })

  test('precise 档变更域（列表 + 详情）：两工作面纯色降级与发丝线统一', async () => {
    setAuth([
      'project:view',
      'change_request:view',
      'change_request:create',
      'change_request:approve',
      'change_impact:view',
      'comment:view',
    ])
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const cr = makeCr()
    installFetchRouter(changeBackend(cr))
    const first = renderWithClient(<NextProjectChangeRequestsPage />)
    await waitFor(() => expect(document.querySelector('[data-cr-workspace]')).not.toBeNull())

    const listRoot = document.querySelector('[data-cr-workspace]')
    expect(listRoot?.className.toString()).not.toContain('nx-space-atmosphere')
    expect(listRoot?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
    // 域头部卡发丝线边框（列表区加载完成后再校验行）
    await waitFor(() => expect(document.querySelector('[data-cr-workspace-header]')).not.toBeNull())
    expectHairlineBorder(document.querySelector('[data-cr-workspace-header]'))
    // 表格行呈现实底（列表数据已加载）
    await waitFor(() => expect(document.querySelector('[data-cr-row-id="7"]')).not.toBeNull())
    expectNoGlowWithin(listRoot)
    first.unmount()

    // 详情页：同样停用空间光晕，面板卡全部发丝线
    const second = renderWithClient(<NextProjectChangeRequestDetailPage />)
    await waitFor(() => expect(document.querySelector('[data-cr-detail]')).not.toBeNull())
    const detailRoot = document.querySelector('[data-cr-detail]')
    expect(detailRoot?.className.toString()).not.toContain('nx-space-atmosphere')
    expect(detailRoot?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
    await waitFor(() => expect(document.querySelector('[data-cr-detail-header]')).not.toBeNull())
    expectHairlineBorder(document.querySelector('[data-cr-detail-header]'))
    expectHairlineBorder(document.querySelector('[data-change-impact-adapter]'))
    expectNoGlowWithin(detailRoot)
    second.unmount()
  })
})

// ---------------------------------------------------------------------------
describe('仪器感骨架屏：aria-busy 且空态零闪现（spec 场景 2）', () => {
  /** 门控响应：fetch 立即返回，但 json 解析挂起至 gate 放行（查询保持 pending）。 */
  function gatedResponse(status: number, body: unknown, gate: Promise<void>): Response {
    const response = jsonResponse(status, body)
    response.json = async () => {
      await gate
      return body
    }
    return response
  }

  test('风险主页项目在途：整体骨架 aria-busy，期间不出现工作台空态/内容', async () => {
    setAuth(['risk:view'])
    let resolveProject!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveProject = resolve
    })
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        return gatedResponse(200, { data: makeProject() }, gate)
      }
      return riskBackend()(path, method)
    }
    installFetchRouter(route)
    renderWithClient(<ProjectRisksDomainPage />)

    const skeleton = document.querySelector('[data-project-space-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    // 数据未就绪前：工作台容器与任何空态零闪现
    expect(document.querySelector('[data-risk-workspace-space]')).toBeNull()
    expect(screen.queryByText('暂无项目风险')).toBeNull()

    resolveProject()
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
  })

  test('变更列表在途：列表骨架 aria-busy，「暂无变更请求」空态零误报', async () => {
    setAuth(['project:view', 'change_request:view', 'change_request:create'])
    let resolveList!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveList = resolve
    })
    const cr = makeCr()
    const route = (path: string, method: string): Response | null => {
      if (path.startsWith('/projects/42/change-requests') && method === 'GET') {
        return gatedResponse(
          200,
          {
            data: [cr],
            meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
          },
          gate,
        )
      }
      return changeBackend(cr)(path, method)
    }
    installFetchRouter(route)
    renderWithClient(<NextProjectChangeRequestsPage />)

    // 项目就绪后列表在途：列表专属骨架
    await waitFor(() => expect(document.querySelector('[data-cr-list-skeleton]')).not.toBeNull())
    const skeleton = document.querySelector('[data-cr-list-skeleton]')
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    // 空态元素零闪现（绝不提前渲染「暂无变更请求」）
    expect(document.querySelector('[data-cr-empty]')).toBeNull()
    expect(screen.queryByText('暂无变更请求')).toBeNull()

    resolveList()
    await waitFor(() => expect(document.querySelector('[data-cr-row-id="7"]')).not.toBeNull())
    expect(screen.queryByText('暂无变更请求')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('接口 500：规范错误卡 + 重新载入重试闭环（spec 场景 3）', () => {
  test('变更主页项目接口 500：错误卡 → 「重新载入」成功后恢复工作台', async () => {
    setAuth(['project:view', 'change_request:view', 'change_request:create'])
    let projectFailed = true
    const cr = makeCr()
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        if (projectFailed) {
          return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: makeProject() })
      }
      return changeBackend(cr)(path, method)
    }
    installFetchRouter(route)
    renderWithClient(<NextProjectChangeRequestsPage />)

    await waitFor(() => expect(document.querySelector('[data-cr-domain-error]')).not.toBeNull())
    const errorCard = document.querySelector('[data-cr-domain-error]')
    expect(errorCard?.getAttribute('role')).toBe('alert')
    expect(errorCard?.getAttribute('aria-label')).toBe('变更请求域加载失败')
    expect(screen.getByText('变更请求域加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新载入' })).toBeInTheDocument()

    projectFailed = false
    fireEvent.click(document.querySelector('[data-cr-domain-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-cr-workspace]')).not.toBeNull())
    expect(document.querySelector('[data-cr-domain-error]')).toBeNull()
    await waitFor(() => expect(document.querySelector('[data-cr-row-id="7"]')).not.toBeNull())
  })

  test('风险主页项目接口 500：ProjectSpaceErrorView 重试成功闭环', async () => {
    setAuth(['risk:view'])
    let projectFailed = true
    const route = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        if (projectFailed) {
          return jsonResponse(500, { error: { code: 'SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: makeProject() })
      }
      return riskBackend()(path, method)
    }
    installFetchRouter(route)
    renderWithClient(<ProjectRisksDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull(),
    )
    expect(screen.getByText('项目加载失败')).toBeInTheDocument()
    const retry = document.querySelector('[data-project-space-retry]')
    expect(retry).not.toBeNull()

    projectFailed = false
    fireEvent.click(retry as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
  })
})
