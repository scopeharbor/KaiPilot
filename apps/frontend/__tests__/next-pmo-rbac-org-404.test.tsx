/**
 * v3-ui-next-pmo-domain W9 · tasks 9.7 —— PMO 组合层 RBAC 门禁矩阵与 RL-05
 * 组织隔离 / 中性 404 集成测试（spec「组织级空间坐标与 AI 同事全域导航接线」要求 5
 * 与 design Decision 5/6）。
 *
 * 与各 W 页级装配测试互补：本文件以统一夹具对 9 个 PMO 页面做矩阵化收口断言——
 * - 权限矩阵：无准入权限时渲染受限横幅（data-permission-fallback）且底层业务接口
 *   零请求（RL-06）；impact-analysis 依 G2 对全部规范角色受限（显式授予 view/manage
 *   方可进入）；
 * - 组织上下文：orgId 未水合（无组织关系 + JWT 无组织声明）→ 中性引导态且零请求；
 * - RL-05：非法 decisionId（/next/pmo/decisions/abc 等非正整数形态）零发包渲染中性
 *   404，文案不含「无权/其他组织」等区分性线索；
 * - dependencies 页按 design Decision 5 不做页面级硬断：普通组织成员（无
 *   portfolio:manage）可读底册，管理写入口物理隐藏（服务端脱敏与 isOrgAdmin 终裁）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoPortfolioOverviewPage from '@/app/(next)/next/pmo/page'
import PmoTrafficLightPage from '@/app/(next)/next/pmo/traffic-light/page'
import PmoGroupingViewsPage from '@/app/(next)/next/pmo/grouping-views/page'
import PmoPriorityScoringPage from '@/app/(next)/next/pmo/priority-scoring/page'
import PmoAiPriorityRecommendationsPage from '@/app/(next)/next/pmo/ai-priority-recommendations/page'
import PmoDecisionsPage from '@/app/(next)/next/pmo/decisions/page'
import PmoDecisionDetailPage from '@/app/(next)/next/pmo/decisions/[decisionId]/page'
import PmoDependenciesPage from '@/app/(next)/next/pmo/dependencies/page'
import PmoImpactAnalysisPage from '@/app/(next)/next/pmo/impact-analysis/page'

// ---------------------------------------------------------------------------
// next/navigation mock（decisionId 动态可换；其余页面不消费路径参数）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: {} as Record<string, string>,
  searchParams: new URLSearchParams(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo',
  useParams: () => navMock.params,
  useSearchParams: () => navMock.searchParams,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与网络夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'member' }],
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

/** orgId 未水合：无组织成员关系 + JWT 无组织声明 → 有效租户上下文为 null。 */
function setNoOrganization(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 9,
      email: 'solo@example.com',
      fullName: '未入组成员',
      organizations: [],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface RequestRecord {
  method: string
  url: string
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
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  navMock.params = {}
  navMock.searchParams = new URLSearchParams()
  setAuth(['task:view'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 权限矩阵：逐页无准入权限 → 受限呈现且业务接口零请求（RL-06）
// ---------------------------------------------------------------------------
interface PageCase {
  name: string
  node: React.ReactNode
  /** 无权限时是否渲染受限横幅（dependencies 页无页面级硬断）。 */
  fallback: boolean
}

const PAGES: readonly PageCase[] = [
  { name: '/next/pmo 组合仪表盘', node: <PmoPortfolioOverviewPage />, fallback: true },
  { name: '/next/pmo/traffic-light 红绿灯', node: <PmoTrafficLightPage />, fallback: true },
  { name: '/next/pmo/grouping-views 分组视图', node: <PmoGroupingViewsPage />, fallback: true },
  {
    name: '/next/pmo/priority-scoring 优先级评分',
    node: <PmoPriorityScoringPage />,
    fallback: true,
  },
  {
    name: '/next/pmo/ai-priority-recommendations AI 推荐',
    node: <PmoAiPriorityRecommendationsPage />,
    fallback: true,
  },
  { name: '/next/pmo/decisions 决策队列', node: <PmoDecisionsPage />, fallback: true },
  { name: '/next/pmo/impact-analysis 影响分析', node: <PmoImpactAnalysisPage />, fallback: true },
]

describe('PMO 权限矩阵：无准入权限 → 受限横幅且底层接口零请求（RL-06）', () => {
  for (const page of PAGES) {
    test(`${page.name}：仅持无关权限（task:view）→ 受限横幅，业务接口零请求`, async () => {
      const { records } = installFetchRouter(() => null)
      renderPage(page.node)

      expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
      await settle()
      expect(records).toHaveLength(0)
    })
  }

  test('impact-analysis 依 G2 对 ORG_ADMIN 常态受限：portfolio:view 亦不解锁（零请求）', async () => {
    setAuth(['portfolio:view', 'pmo_decision:view', 'resource:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<PmoImpactAnalysisPage />)

    expect(document.querySelector('[data-imp-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-imp-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('决策详情（合法 ID）：无 pmo_decision:view → 受限横幅且零请求', async () => {
    navMock.params = { decisionId: '101' }
    const { records } = installFetchRouter(() => null)
    renderPage(<PmoDecisionDetailPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-detail-workspace]')).toBeNull()
    expect(document.querySelector('[data-pmo-decision-not-found]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('dependencies 页无页面级硬断：普通成员（portfolio:view）进入只读底册，写入口物理隐藏', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter((path, method) => {
      if (method !== 'GET') return null
      if (path.startsWith('/organizations/1/multi-project-dependencies')) {
        return jsonResponse(200, {
          data: [
            {
              id: 7,
              organizationId: 1,
              providerEndpoint: {
                endpointType: 'project',
                projectId: 1,
                projectName: '上游项目',
                redacted: false,
              },
              consumerEndpoint: {
                endpointType: 'task',
                projectId: 2,
                projectName: '下游项目',
                taskId: 301,
                taskName: '下游任务',
                redacted: false,
              },
              category: 'deliverable',
              type: 'fs',
              lagDays: 0,
              strength: 'hard',
              bufferDays: 2,
              status: 'active',
              riskLevel: 'high',
              sourceMode: 'manual',
              freshnessSignature: 'sig',
              freshnessCheckedAt: '2026-09-10T02:00:00.000Z',
              freshnessStatus: 'fresh',
              createdAt: '2026-09-01T08:00:00.000Z',
              updatedAt: '2026-09-02T08:00:00.000Z',
            },
          ],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      return null
    })
    renderPage(<PmoDependenciesPage />)

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-pmo-deps-workspace]')).not.toBeNull()
    expect(await screen.findByText('上游项目')).toBeInTheDocument()
    // 只读视图：新建/归档/编辑/删除入口全部隐藏；服务端 isOrgAdmin 终裁
    expect(document.querySelector('[data-pmo-deps-create]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-archive]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-edit]')).toBeNull()
    expect(document.querySelector('[data-mpd-row-delete]')).toBeNull()
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 组织上下文未水合：中性引导态且零请求（RL-05）
// ---------------------------------------------------------------------------
describe('PMO 组织上下文：orgId 未水合 → 中性引导态且零请求', () => {
  for (const page of PAGES) {
    test(`${page.name}：orgId 未水合 → 引导态（非受限横幅），零请求`, async () => {
      setNoOrganization(['portfolio:view', 'pmo_decision:view', 'multi_project_impact:view'])
      const { records } = installFetchRouter(() => null)
      renderPage(page.node)

      expect(
        document.querySelector('[data-org-guide-state], [data-org-no-organization]'),
      ).not.toBeNull()
      expect(document.querySelector('[data-permission-fallback]')).toBeNull()
      await settle()
      expect(records).toHaveLength(0)
    })
  }

  test('dependencies 页 orgId 未水合：引导态且零请求（组织成员读语义不豁免上下文）', async () => {
    setNoOrganization(['portfolio:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<PmoDependenciesPage />)

    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-deps-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// RL-05：非法 decisionId 零发包中性 404
// ---------------------------------------------------------------------------
describe('RL-05 中性 404：非法 decisionId（/next/pmo/decisions/abc）', () => {
  for (const bad of ['abc', '0', '-3', '1.5', '1e3', '']) {
    test(`decisionId=${bad === '' ? '<empty>' : bad}：零发包渲染中性 404（无区分性线索）`, async () => {
      setAuth(['pmo_decision:view', 'pmo_decision:manage', 'pmo_decision:decide'])
      navMock.params = { decisionId: bad }
      const { records } = installFetchRouter(() => null)
      renderPage(<PmoDecisionDetailPage />)

      expect(document.querySelector('[data-pmo-decision-not-found]')).not.toBeNull()
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).toBeNull()
      expect(document.querySelector('[data-permission-fallback]')).toBeNull()
      const body = document.body.textContent ?? ''
      expect(body).toContain('该决策议题不存在或已下线。')
      expect(body).not.toContain('无权访问')
      expect(body).not.toContain('其它组织')
      await settle()
      expect(records).toHaveLength(0)
    })
  }
})

// ---------------------------------------------------------------------------
// 跨组织/接口 404：中性受限不泄露（RL-05）
// ---------------------------------------------------------------------------
describe('RL-05 跨组织与接口 404：中性文案（不区分「不存在/无权」）', () => {
  test('组合仪表盘接口 404 → 中性受限错态 + 返回角色首页动线（零写请求）', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/portfolio-dashboard')) {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '组织不存在' } })
      }
      return null
    })
    renderPage(<PmoPortfolioOverviewPage />)

    const errorCard = await screen.findByText('组合态势数据不可用')
    expect(errorCard).toBeInTheDocument()
    expect(screen.getByText(/数据不存在或当前会话无权访问/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('组织不存在')
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })

  test('决策详情接口 404（跨组织/已删除）→ 中性 404 态，返回队列按钮可用', async () => {
    setAuth(['pmo_decision:view'])
    navMock.params = { decisionId: '101' }
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path === '/organizations/1/pmo/decision-workbench/cases/101') {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } })
      }
      return null
    })
    renderPage(<PmoDecisionDetailPage />)

    expect(await screen.findByText('该决策议题不存在或已下线。')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-decision-not-found]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('资源不存在')
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })
})
