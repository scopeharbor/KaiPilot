/**
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.4 —— 技能矩阵页面装配与 RBAC 测试
 * （页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「全局资源入口、技能矩阵与问题风险入口」技能矩阵项 + tasks 8.4）：
 * - 页守卫 = resource:view / portfolio:view / ai:compiler:skill:view 任一（policy 列级
 *   明细门并集）；无任一权限 → 受限横幅渲染且矩阵接口零请求（RL-06）；
 * - ai:compiler:skill:view-only 用户同样准入（并集守卫回归锁定）；
 * - 未选择组织（有效租户上下文缺失）→ 「请先选择组织」引导态且零查询
 *   （修复旧轨 `orgId ?? 1` 静默兜底缺陷）；
 * - 授权用户完整装配：工作台标题 / KPI / summary 请求发出。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import SkillMatrixPage from '@/app/(next)/next/resources/skill-matrix/page'

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
    if (path.startsWith('/organizations/1/resource-skill-matrix/')) {
      return jsonResponse(200, {
        data: {
          meta: {
            calculatedAt: '2026-09-01T08:00:00.000Z',
            metricVersion: '1.0.0',
            organizationId: 1,
            actorId: 1,
            scope: 'organization',
            visibleProjectCount: 1,
            visibleResourceCount: 5,
            visibleRequirementCount: 3,
            visibleSkillCount: 2,
            dateWindow: { from: '2026-08-01', to: '2026-09-01' },
            sourceFreshness: [],
            inputSignatureHash: 'sig',
          },
          overallCoverageRatio: 0.6,
          totalGaps: 1,
          totalCandidateResources: 2,
          totalSkillAdvisories: 1,
          coverageBySkill: [
            {
              skillKey: 'react',
              totalResources: 5,
              skilledResources: 3,
              totalAvailableCapacityHours: 120,
              totalAllocatedCapacityHours: 80,
              coverageRatio: 0.6,
              resourceCoverageRatio: 0.6,
            },
          ],
          criticalGaps: [
            {
              skillKey: 'react',
              severity: 'critical',
              requirementCount: 3,
              requiredCapacityHours: 200,
              availableCapacityHours: 80,
              gapCapacityHours: 120,
              requirementSourceRefs: [],
              recoverySuggestion: undefined,
              warnings: [],
            },
          ],
          warnings: [],
        },
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
      <SkillMatrixPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAuth(['resource:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('SkillMatrixPage：/next/resources/skill-matrix 装配与 RBAC（tasks 8.4）', () => {
  test('具备 resource:view：工作台装配，summary 请求发出', async () => {
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '技能矩阵' })).toBeInTheDocument(),
    )
    expect(document.querySelector('[data-skill-kpis]')).not.toBeNull()
    expect(document.querySelector('[data-skill-coverage-card]')).not.toBeNull()
    expect(records.some((record) => record.url.includes('/resource-skill-matrix/summary'))).toBe(
      true,
    )
  })

  test('仅 ai:compiler:skill:view（无 resource/portfolio 权限）：并集守卫放行并请求数据', async () => {
    setAuth(['ai:compiler:skill:view'])
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '技能矩阵' })).toBeInTheDocument(),
    )
    expect(document.querySelector('[data-skill-matrix-permission-fallback]')).toBeNull()
    expect(records.some((record) => record.url.includes('/resource-skill-matrix/summary'))).toBe(
      true,
    )
  })

  test('无 resource:view / portfolio:view / ai:compiler:skill:view：受限横幅且矩阵接口零请求（RL-06）', async () => {
    setAuth(['task:view', 'org:view'])
    const { records } = installFetchRouter()
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-skill-matrix-permission-fallback]')).not.toBeNull(),
    )
    expect(screen.getByText('你没有访问技能矩阵的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-skill-matrix-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('未选择组织：引导态「请先选择组织」且零查询', async () => {
    setAuth(['resource:view'], null)
    const { records } = installFetchRouter()
    renderPage()

    expect(document.querySelector('[data-org-guidance]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    expect(document.querySelector('[data-skill-matrix-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})
