/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.8 —— 全局问题与风险页面装配测试
 * （页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「问题与风险入口」场景 + tasks 8.8）：
 * - 页守卫 org:view / risk:view 任一：无两权限 → 受限横幅且 Hub 零请求（RL-06）；
 * - 仅 risk:view（无 org:view）准入（任一集合回归锁定）；
 * - 未选择组织 → 「请先选择组织」引导态且零查询；
 * - 授权用户完整装配：三分语义卡 + 项目 Hub（仅 /projects 列表 GET，本页零风险
 *   数据请求）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import GlobalRisksPage from '@/app/(next)/next/risks/page'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations:
        organizationId === null
          ? []
          : [
              {
                id: organizationId,
                name: '北极星研发部',
                slug: 'northstar',
                role: 'project_manager',
              },
            ],
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

function installFetchRouter(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method: (init?.method ?? 'GET').toUpperCase(), url: path })
    if (path.startsWith('/projects?')) {
      return jsonResponse(200, {
        data: [
          {
            id: 3,
            organizationId: 1,
            name: '商城重构',
            code: 'MALL-R3',
            description: null,
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
        ],
        meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GlobalRisksPage />
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

describe('GlobalRisksPage：/next/risks 装配与 RBAC（tasks 8.8）', () => {
  test('具备 org:view：三分语义卡 + 项目 Hub 装配，仅 /projects GET（零风险数据请求）', async () => {
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '问题与风险' })).toBeInTheDocument(),
    )
    expect(document.querySelector('[data-risk-taxonomy-card="issue"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-taxonomy-card="risk"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-taxonomy-card="incident"]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )
    const deepLink = document.querySelector('[data-risk-project-deep-link="3"]')
    expect(deepLink?.getAttribute('href')).toBe('/next/projects/3/risks')
    // 本页零风险数据请求
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(1)
    expect(records[0]?.method).toBe('GET')
    expect(records[0]?.url).toContain('/projects?')
    expect(records[0]?.url).not.toContain('risk')
  })

  test('仅 risk:view（无 org:view）：任一集合准入，Hub 正常装配', async () => {
    setAuth(['risk:view'])
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '问题与风险' })).toBeInTheDocument(),
    )
    expect(document.querySelector('[data-risk-permission-fallback]')).toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-risk-project-row="3"]')).not.toBeNull(),
    )
    expect(records.some((record) => record.url.startsWith('/projects?'))).toBe(true)
  })

  test('无 org:view / risk:view：受限横幅且业务请求零发出（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-risk-permission-fallback]')).not.toBeNull(),
    )
    expect(screen.getByText('你没有访问问题与风险的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-global-risk-hub]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('未选择组织：引导态「请先选择组织」且零查询', async () => {
    setAuth(['org:view'], null)
    const { records } = installFetchRouter()
    renderPage()

    expect(document.querySelector('[data-org-guidance]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    expect(document.querySelector('[data-global-risk-hub]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})
