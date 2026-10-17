/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.7 —— 全局风险 Hub 组件测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「问题与风险入口」场景 + tasks 8.7）：
 * - 三分语义卡渲染：项目问题/项目风险/产品故障徽标均「可用」（Issue 已投产接线）；
 * - 产品故障卡「去帮助中心故障排查」深链 → /next/help/search?q=故障；
 * - 项目问题卡附「进入问题工作台」按钮（onIssueEntry 切 tab）；
 * - 项目风险登记册 Hub：项目列表渲染 + 行内深链指向 /next/projects/:id/risks；
 *   本页零风险数据请求（仅 /projects 列表 GET）；
 * - 无项目 → 引导空态 + 创建入口 /next/create；
 * - 「项目问题」tab → IssueWorkbench 真实工作台（项目选择 + 空清单态 + 登记对话框）；
 *   返回项目风险 tab 正常；
 * - 项目列表 5xx → 错误态可重试。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { GlobalRiskHub } from '@/components/next/org-risk-global/GlobalRiskHub'
import { INCIDENT_HELP_SEARCH_HREF } from '@/lib/next/org-risk-global/global-risk-adapter'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
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

interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
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
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function projectsFixture() {
  return [
    {
      id: 3,
      organizationId: 1,
      name: '商城重构',
      code: 'MALL-R3',
      description: '支付与订单域重构',
      status: 'active',
      priority: 'high',
      startDate: null,
      endDate: null,
      budgetCents: null,
      currency: null,
      progressPercent: 32,
      healthStatus: 'on_track',
      settings: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 7,
      organizationId: 1,
      name: '户外演出季',
      code: 'FEST-2026',
      description: '夏季音乐节场地与票务',
      status: 'planning',
      priority: 'medium',
      startDate: null,
      endDate: null,
      budgetCents: null,
      currency: null,
      progressPercent: 10,
      healthStatus: 'at_risk',
      settings: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ]
}

function createBackend(mode: 'normal' | 'empty' | 'flaky' = 'normal') {
  let listCalls = 0
  return {
    route: (path: string, method: string): Response | null => {
      if (method === 'GET' && path.startsWith('/projects?')) {
        listCalls += 1
        if (mode === 'flaky' && listCalls === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
        }
        const rows = mode === 'empty' ? [] : projectsFixture()
        return jsonResponse(200, {
          data: rows,
          meta: { total: rows.length, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      // 问题工作台：项目问题清单（默认空清单）
      if (method === 'GET' && /^\/projects\/\d+\/issues\?/.test(path)) {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
        })
      }
      return null
    },
  }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderHub(organizationId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GlobalRiskHub organizationId={organizationId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAuth(['org:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('GlobalRiskHub：三分语义卡与状态徽标（tasks 8.7）', () => {
  test('渲染 项目问题/项目风险/产品故障 三卡，徽标全为可用', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderHub()

    expect(document.querySelector('[data-risk-taxonomy-card="issue"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-taxonomy-card="risk"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-taxonomy-card="incident"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-taxonomy-status="issue"]')?.textContent).toBe('可用')
    expect(document.querySelector('[data-risk-taxonomy-status="risk"]')?.textContent).toBe('可用')
    expect(document.querySelector('[data-risk-taxonomy-status="incident"]')?.textContent).toBe(
      '可用',
    )
    // 卡片内文案（标签/定义/示例）在位——用卡片作用域断言避免跨卡重复命中
    const issueCard = document.querySelector('[data-risk-taxonomy-card="issue"]')
    expect(issueCard?.textContent).toContain('项目问题')
    expect(issueCard?.textContent).toContain('阻塞')
    expect(issueCard?.textContent).toContain('供应商交付延迟')
    const riskCard = document.querySelector('[data-risk-taxonomy-card="risk"]')
    expect(riskCard?.textContent).toContain('项目风险')
    expect(riskCard?.textContent).toContain('概率')
    const incidentCard = document.querySelector('[data-risk-taxonomy-card="incident"]')
    expect(incidentCard?.textContent).toContain('产品故障')
    expect(incidentCard?.textContent).toContain('故障排查')
  })

  test('产品故障卡附帮助中心深链（/next/help/search?q=故障），且非风险登记册入口', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderHub()

    const incidentLink = document.querySelector('[data-risk-taxonomy-incident-link]')
    expect(incidentLink).not.toBeNull()
    expect(incidentLink?.getAttribute('href')).toBe(INCIDENT_HELP_SEARCH_HREF)
  })
})

describe('GlobalRiskHub：项目风险登记册 Hub 与零风险请求（tasks 8.7）', () => {
  test('项目列表渲染 + 深链指向 /next/projects/:id/risks；仅 /projects 一个 GET，零风险数据请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderHub()

    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )
    expect(screen.getByText('商城重构')).toBeInTheDocument()
    expect(document.querySelector('[data-risk-project-row="7"]')).not.toBeNull()
    const deepLink3 = document.querySelector('[data-risk-project-deep-link="3"]')
    expect(deepLink3?.getAttribute('href')).toBe('/next/projects/3/risks')
    expect(deepLink3?.textContent).toContain('进入风险登记册')
    const deepLink7 = document.querySelector('[data-risk-project-deep-link="7"]')
    expect(deepLink7?.getAttribute('href')).toBe('/next/projects/7/risks')

    // 本页零风险数据请求：仅项目列表 GET（无任何 /risks 或风险相关端点）
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(1)
    expect(records[0]?.method).toBe('GET')
    expect(records[0]?.url).toContain('/projects?')
    expect(records[0]?.url).not.toContain('risk')
  })

  test('无项目 → 引导空态与创建入口（/next/create）', async () => {
    const backend = createBackend('empty')
    const { records } = installFetchRouter(backend.route)
    renderHub()

    await waitFor(() => expect(document.querySelector('[data-risk-projects-empty]')).not.toBeNull())
    expect(screen.getByText('还没有项目')).toBeInTheDocument()
    const createLink = document.querySelector('[data-risk-projects-create]')
    expect(createLink?.getAttribute('href')).toBe('/next/create')
    expect(records).toHaveLength(1)
  })

  test('项目列表 5xx → 错误态重试成功', async () => {
    const backend = createBackend('flaky')
    const { records } = installFetchRouter(backend.route)
    renderHub()

    await waitFor(() => expect(document.querySelector('[data-risk-projects-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-risk-projects-error-retry]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )
    expect(records.filter((record) => record.url.startsWith('/projects?'))).toHaveLength(2)
  })
})

describe('GlobalRiskHub：「项目问题」工作台（真实 CRUD 接线）', () => {
  test('切到项目问题 tab → 工作台呈现（项目选择器 + 空清单态）；语义卡入口按钮直达', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderHub()

    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )

    // 语义卡「进入问题工作台」按钮直达问题 tab
    fireEvent.click(document.querySelector('[data-risk-taxonomy-issue-link]') as Element)
    await waitFor(() => expect(document.querySelector('[data-issue-workbench]')).not.toBeNull())
    expect(document.querySelector('[data-issue-project-select]')).not.toBeNull()
    // 默认选中首个项目（商城重构 id=3）并发起问题清单查询
    await waitFor(() => expect(document.querySelector('[data-issue-list-empty]')).not.toBeNull())
    expect(
      records.some(
        (record) => record.method === 'GET' && record.url.startsWith('/projects/3/issues?'),
      ),
    ).toBe(true)
    // 工作台提供真实写入口（登记问题按钮），点击弹出登记对话框
    expect(screen.getByText('登记问题')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-issue-create-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-issue-create-dialog]')).not.toBeNull())

    // 返回项目风险 tab 正常
    fireEvent.click(document.querySelector('[data-risk-hub-tab="risk"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )
    // 全程无写请求
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})
