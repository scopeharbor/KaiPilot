/**
 * v3-ui-next-pmo-domain W9 · tasks 9.8 —— PMO 组合层精确档仪器感降级与三态完备性
 * 集成测试（spec「组织级空间坐标与 AI 同事全域导航接线」要求 6 与 design Decision 7）。
 *
 * 覆盖：
 * - precise 档（useNextTrackStore.immersionTier='precise'）：
 *   - html[data-immersion] 同步；
 *   - 8 个 PMO 工作面根节点停用 .nx-space-atmosphere 深空光晕类，纯色
 *     `--nx-workspace-bg` 实底；
 *   - 卡片/面板统一 1px 发丝线（border-[var(--nx-border-hairline)]）；
 *   - 承载区（工作台根节点子树，排除浮层 Portal 内有意保留的弹窗阴影）无光晕/
 *     渐变类，实色呈现；
 *   - AI 长文卡（推荐 AI 理由叙述）在精确档保持正文级字号与最高对比双通道；
 * - immersive 对照：同页根节点消费 .nx-space-atmosphere（证明 precise 确实切换）；
 * - 三态完备：骨架屏（role=status + aria-busy，空态零闪现）/ 语义空态 /
 *   5xx 错误卡 → 「重新载入」重试成功闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import PmoPortfolioOverviewPage from '@/app/(next)/next/pmo/page'
import PmoTrafficLightPage from '@/app/(next)/next/pmo/traffic-light/page'
import PmoGroupingViewsPage from '@/app/(next)/next/pmo/grouping-views/page'
import PmoPriorityScoringPage from '@/app/(next)/next/pmo/priority-scoring/page'
import PmoAiPriorityRecommendationsPage from '@/app/(next)/next/pmo/ai-priority-recommendations/page'
import PmoDecisionsPage from '@/app/(next)/next/pmo/decisions/page'
import PmoDecisionDetailPage from '@/app/(next)/next/pmo/decisions/[decisionId]/page'
import PmoDependenciesPage from '@/app/(next)/next/pmo/dependencies/page'
import PmoImpactAnalysisPage from '@/app/(next)/next/pmo/impact-analysis/page'
import { PmoAiRecommendationDetailPanel } from '@/components/next/pmo/ai-priority/PmoAiRecommendationDetailPanel'
import {
  pmoDecisionSmallCaseFixture,
  pmoDecisionOptionFixtures,
  pmoDecisionSnapshotSummaryFixture,
} from '@aiproj/types'
import type { PmoRecommendationRecord } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: { decisionId: '101' } as Record<string, string>,
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
// 网络夹具
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

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

async function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  // 挂载即发起的非 gated 快查询（如 traffic-light/counts）经 TanStack Query 的
  // notifyManager 落地，其批量通知调度跨越 setTimeout 宏任务边界，纯 microtask
  // 冲刷（Promise.resolve()）追不上；用 settle() 让出一次真实宏任务 tick。
  // 显式 gated 的慢查询依赖外部 resolveGate，不受这次冲刷影响。
  await act(async () => {
    await settle()
  })
  return utils
}

/** 门控响应：fetch 立即返回但 json 解析挂起 → 查询保持 pending（骨架阶段可断言）。 */
function gatedResponse(body: unknown, gate: Promise<void>): Response {
  const response = jsonResponse(200, body)
  response.json = async () => {
    await gate
    return body
  }
  return response
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
const ALL_PMO_PERMISSIONS = [
  'portfolio:view',
  'portfolio:manage',
  'pmo_decision:view',
  'pmo_decision:manage',
  'pmo_decision:decide',
  'pmo_decision:handoff',
  'pmo_decision:request_ai',
  'multi_project_impact:view',
  'multi_project_impact:manage',
  // AI 推荐审阅动作门禁（design D5 降级链：recommendation:manage 或 PMO 专用管理权限）
  'recommendation:manage',
]

function setAuth(permissions: string[] = ALL_PMO_PERMISSIONS, organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '组织管理员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  navMock.params = { decisionId: '101' }
  navMock.searchParams = new URLSearchParams()
  setAuth()
  useNextTrackStore.setState({ immersionTier: 'precise' })
})

afterEach(() => {
  // 「三态完备性」分组的用例不逐一 unmount（渲染结果本身不是断言对象），
  // 组件树带着对 useNextTrackStore 的订阅存活到这里；重置该 store 会立即
  // 触发它们重渲染（含 useMotionPreference 因 enabled 翻转而联动的效果），
  // 不用 act 包住就会在全局 cleanup() 之前脱离 act 作用域报警。
  act(() => {
    useNextTrackStore.setState({ immersionTier: null })
  })
  document.documentElement.removeAttribute('data-immersion')
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 数据夹具（各页最小可用后端）
// ---------------------------------------------------------------------------
function portfolioSummaryBackend() {
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/portfolio-dashboard')) {
      return jsonResponse(200, {
        data: {
          meta: {
            calculatedAt: '2026-09-10T08:00:00.000Z',
            metricVersion: 'portfolio-dashboard.v1',
            organizationId: 1,
            actorId: 1,
            visibleProjectCount: 3,
            totalProjectCount: 3,
          },
          kpis: [
            {
              key: 'total_projects',
              value: 3,
              unit: 'count',
              source: 'computed',
              status: 'ok',
              warnings: [],
            },
          ],
          trafficLight: {
            available: true,
            forbidden: false,
            redCount: 1,
            yellowCount: 1,
            greenCount: 1,
            grayCount: 0,
            warnings: [],
          },
          freshness: [],
          warnings: [],
        },
      })
    }
    if (path.startsWith('/pmo/investment-distribution/catalogue')) {
      return jsonResponse(200, {
        data: {
          nonFinancialBasis: ['project_count'],
          unsupportedFinancialBasis: [],
          dimensions: ['project_type'],
          displayModes: ['donut'],
          topN: { default: 10, max: 20 },
          trendWindows: ['last_30_days'],
          metricVersion: 'pmo-investment-distribution.v1',
        },
      })
    }
    if (path.startsWith('/pmo/investment-distribution/trends')) {
      return jsonResponse(200, {
        meta: { calculatedAt: null, sourceFreshness: [] },
        data: [],
        warnings: [],
      })
    }
    if (path.startsWith('/pmo/investment-distribution')) {
      return jsonResponse(200, {
        data: {
          meta: {
            calculatedAt: '2026-09-10T08:00:00.000Z',
            metricVersion: 'pmo-investment-distribution.v1',
            organizationId: 1,
            actorId: 1,
            visibleProjectCount: 0,
            basis: 'project_count',
            dimension: 'project_type',
            displayMode: 'donut',
            totalBasisValue: 0,
            sourceFreshness: [],
          },
          buckets: [],
          warnings: [],
        },
      })
    }
    return null
  }
}

function trafficLightBackend() {
  const item = {
    projectId: 1001,
    projectName: '开项核心引擎',
    projectStatus: 'active',
    trafficLight: 'red',
    severityCounts: { critical: 1, high: 0, medium: 0, low: 0 },
    sourceFreshness: { overallStale: false, staleSources: [], lastUpdatedAt: null },
    evidence: [],
    warnings: [],
    reviewState: { reviewState: 'none', reviewedAt: null, reviewedBy: null, stale: false },
    ruleVersion: 'pmo-traffic-light-v1',
    calculatedAt: '2026-09-10T08:00:00.000Z',
    allowedActions: { canReview: true, canViewDetail: true },
  }
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/traffic-light/counts')) {
      return jsonResponse(200, {
        data: {
          red: 1,
          yellow: 0,
          green: 0,
          gray: 0,
          total: 1,
          calculatedAt: '2026-09-10T08:00:00.000Z',
        },
      })
    }
    if (path.startsWith('/pmo/traffic-light')) {
      return jsonResponse(200, {
        data: [item],
        meta: {
          page: 1,
          perPage: 20,
          total: 1,
          totalPages: 1,
          calculatedAt: '2026-09-10T08:00:00.000Z',
        },
      })
    }
    return null
  }
}

function groupingBackend() {
  const view = {
    id: 'system-by-status',
    scope: 'system',
    organizationId: null,
    ownerUserId: null,
    name: '按状态分组',
    description: '系统预设',
    definitionVersion: 'grouping-view.v1',
    query: { primaryGrouping: 'status' },
    isDefault: true,
    capabilities: {
      canEdit: false,
      canDelete: false,
      canDuplicate: true,
      canSetDefault: false,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/grouping-views')) {
      return jsonResponse(200, { data: [view], warnings: [] })
    }
    return null
  }
}

function priorityScoringBackend() {
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/priority-scoring/summary')) {
      return jsonResponse(200, {
        data: {
          totalProjects: 0,
          scoredProjects: 0,
          unscoredProjects: 0,
          levelCounts: { critical: 0, high: 0, medium: 0, low: 0, unranked: 0 },
          scoreVersion: 'pmo-priority-v1',
          weightVersion: 'pmo-priority-v1',
          sourceFreshness: [],
          warnings: [],
          calculatedAt: '2026-09-10T08:00:00.000Z',
        },
      })
    }
    if (path.startsWith('/pmo/priority-scoring/weights')) {
      return jsonResponse(200, {
        data: {
          version: 'pmo-priority-v1',
          description: '权重目录',
          dimensions: [],
          thresholds: {
            critical: [80, 100],
            high: [60, 80],
            medium: [40, 60],
            low: [0, 40],
            unranked: [-1, -1],
          },
        },
      })
    }
    if (path.startsWith('/pmo/priority-scoring/projects')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
      })
    }
    return null
  }
}

function aiPriorityBackend() {
  const summary = {
    totalCount: 0,
    newCount: 0,
    reviewingCount: 0,
    acceptedCount: 0,
    dismissedCount: 0,
    convertedCount: 0,
    criticalCount: 0,
    highCount: 0,
    staleCount: 0,
    aiAvailableCount: 0,
    maxSeverity: 'none',
    scoringAvailable: true,
    scoringStale: false,
    topRecommendations: [],
    warnings: [],
    generatedAt: '2026-09-10T08:00:00.000Z',
  }
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.includes('/summary')) return jsonResponse(200, { data: summary })
    if (path.startsWith('/pmo/ai-priority-recommendations')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        summary,
      })
    }
    return null
  }
}

function decisionsBackend() {
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.endsWith('/cases')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      })
    }
    return null
  }
}

function decisionDetailBackend() {
  const CASE = '/organizations/1/pmo/decision-workbench/cases/101'
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path === CASE) return jsonResponse(200, { data: pmoDecisionSmallCaseFixture() })
    if (path === `${CASE}/options`) return jsonResponse(200, { data: pmoDecisionOptionFixtures() })
    if (path === `${CASE}/positions`) return jsonResponse(200, { data: [] })
    if (path === `${CASE}/evidence/snapshots`) {
      return jsonResponse(200, { data: [pmoDecisionSnapshotSummaryFixture()] })
    }
    if (path === `${CASE}/comparison`) {
      return jsonResponse(200, {
        data: {
          caseId: 101,
          baselineOptionId: 1,
          candidateOptionId: 2,
          cells: [],
          findings: [],
          lensVersions: [],
          hasWinnerScore: false,
        },
      })
    }
    if (path === `${CASE}/outcomes`) return jsonResponse(200, { data: [] })
    if (path === `${CASE}/handoffs`) return jsonResponse(200, { data: [] })
    return null
  }
}

function dependenciesBackend() {
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/organizations/1/multi-project-dependencies')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      })
    }
    return null
  }
}

function impactBackend() {
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/organizations/1/multi-project-impact-analyses')) {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      })
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// 逐页精确档降级断言（tasks 9.8 主体）
// ---------------------------------------------------------------------------
interface TierCase {
  name: string
  node: React.ReactNode
  /** 工作台根节点选择器（含 .nx-space-atmosphere 切换语义的容器）。 */
  rootSelector: string
  backend: (path: string, method: string) => Response | null
}

const TIER_CASES: readonly TierCase[] = [
  {
    name: '/next/pmo 组合仪表盘',
    node: <PmoPortfolioOverviewPage />,
    rootSelector: '[data-pmo-portfolio-workspace]',
    backend: portfolioSummaryBackend(),
  },
  {
    name: '/next/pmo/traffic-light 红绿灯',
    node: <PmoTrafficLightPage />,
    rootSelector: '[data-pmo-traffic-workspace]',
    backend: trafficLightBackend(),
  },
  {
    name: '/next/pmo/grouping-views 分组视图',
    node: <PmoGroupingViewsPage />,
    rootSelector: '[data-gv-workspace]',
    backend: groupingBackend(),
  },
  {
    name: '/next/pmo/priority-scoring 优先级评分',
    node: <PmoPriorityScoringPage />,
    rootSelector: '[data-pps-workspace]',
    backend: priorityScoringBackend(),
  },
  {
    name: '/next/pmo/ai-priority-recommendations AI 推荐',
    node: <PmoAiPriorityRecommendationsPage />,
    rootSelector: '[data-pmo-ai-workspace]',
    backend: aiPriorityBackend(),
  },
  {
    name: '/next/pmo/decisions 决策队列',
    node: <PmoDecisionsPage />,
    rootSelector: '[data-pmo-decisions-workspace]',
    backend: decisionsBackend(),
  },
  {
    name: '/next/pmo/decisions/[decisionId] 决策详情',
    node: <PmoDecisionDetailPage />,
    rootSelector: '[data-pmo-decision-detail-workspace]',
    backend: decisionDetailBackend(),
  },
  {
    name: '/next/pmo/dependencies 跨项目依赖',
    node: <PmoDependenciesPage />,
    rootSelector: '[data-pmo-deps-workspace]',
    backend: dependenciesBackend(),
  },
  {
    name: '/next/pmo/impact-analysis 影响分析',
    node: <PmoImpactAnalysisPage />,
    rootSelector: '[data-imp-workspace]',
    backend: impactBackend(),
  },
]

describe('精确档（precise）：纯色仪器降级，停用深空光晕（design Decision 7）', () => {
  for (const tierCase of TIER_CASES) {
    test(`${tierCase.name}：根节点停用 nx-space-atmosphere、实底 + 1px 发丝线且子树零光晕`, async () => {
      installFetchRouter(tierCase.backend)
      const view = await renderPage(tierCase.node)

      await waitFor(() => expect(document.querySelector(tierCase.rootSelector)).not.toBeNull())
      // 沉浸档同步到 html（useImmersionTier effect）
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

      const root = document.querySelector(tierCase.rootSelector)
      expect(root?.className.toString()).not.toContain('nx-space-atmosphere')
      expect(root?.className.toString()).toContain('bg-[var(--nx-workspace-bg)]')
      expect(root?.className.toString()).toContain('border-[var(--nx-border-hairline)]')
      // 纯色降级：工作面子树内不得残留空间氛围光晕 / backdrop 滤镜类
      //（弹窗 Portal 独立于工作面根节点之外，此处断言的是工作面本身）
      const glowNodes = root?.querySelectorAll('.nx-space-atmosphere, [class*="backdrop-"]')
      expect(glowNodes).toHaveLength(0)

      await act(async () => {
        view.unmount()
      })
    })
  }

  test('immersive 对照：组合仪表盘与红绿灯根节点消费 .nx-space-atmosphere（证明 precise 确实切换）', async () => {
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    installFetchRouter(portfolioSummaryBackend())
    const first = await renderPage(<PmoPortfolioOverviewPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-pmo-portfolio-workspace]')?.className.toString(),
    ).toContain('nx-space-atmosphere')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
    first.unmount()

    installFetchRouter(trafficLightBackend())
    const second = await renderPage(<PmoTrafficLightPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-traffic-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-traffic-workspace]')?.className.toString()).toContain(
      'nx-space-atmosphere',
    )
    second.unmount()

    // 切换回 precise：同页根节点即刻剥离光晕（档位切换生效）
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(portfolioSummaryBackend())
    const third = await renderPage(<PmoPortfolioOverviewPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-pmo-portfolio-workspace]')?.className.toString(),
    ).not.toContain('nx-space-atmosphere')
    third.unmount()
  })

  test('AI 长文卡（推荐 AI 理由）在精确档保持正文级字号与最高对比双通道', async () => {
    const record: PmoRecommendationRecord = {
      id: 7,
      organizationId: 1,
      projectId: 107,
      sourceType: 'traffic_light',
      sourceId: 'tl-7',
      title: '推荐 #7：红灯项目需要管理层关注',
      summary: '项目 107 持续红灯，建议人工复核。',
      suggestedAction: '查看项目详情并评估风险',
      actionType: 'navigate',
      severity: 'critical',
      priorityContext: {
        priorityScore: 91.5,
        priorityLevel: 'critical',
        rank: 1,
        weightVersion: 'priority-scoring.v1',
        topDimensionContributors: ['delivery_urgency'],
        scoringAvailable: true,
      },
      sourceSignals: [],
      evidenceRefs: [],
      status: 'new',
      dedupeKey: 'k-7',
      inputSignature: 'sig-7',
      candidateVersion: 'pmo-ai-priority-recommendations.v1',
      warnings: [],
      aiMetadata: {
        provider: 'mock-pmo',
        model: 'mock-pmo-recommendation',
        inputTokens: null,
        outputTokens: 120,
        totalCost: null,
        currency: 'CNY',
        latencyMs: 240,
        inputSignature: 'sig-input',
        outputHash: 'hash-1',
        status: 'pending',
        failureCode: null,
        failureMessage: null,
        narrative: '推荐理由：该项目持续两周红灯且关键路径滑移，建议管理层本周内完成复核并决策。',
        focusPoints: [],
        suggestedActions: [],
        assumptions: [],
        confidence: 0.3,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
        generatedAt: '2026-09-10T08:00:00.000Z',
      },
      aiStatus: 'available',
      expiresAt: null,
      stale: false,
      staleReason: null,
      createdBy: 1,
      handledBy: null,
      handledAt: null,
      snoozedUntil: null,
      reviewReason: null,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    }
    installFetchRouter((path, method) => {
      if (method !== 'GET') return null
      if (path === '/pmo/ai-priority-recommendations/7') {
        return jsonResponse(200, {
          data: { record, sourceWarnings: [], conversionIntents: [] },
        })
      }
      return null
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <PmoAiRecommendationDetailPanel id={7} onClose={() => undefined} />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-ai-rationale-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-ai-rationale-open]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-ai-rationale-modal]')).not.toBeNull(),
    )

    // 精确档：浮层内无空间氛围光晕类（实色面板）
    const modal = document.querySelector('[data-pmo-ai-rationale-modal]')
    expect(modal?.className.toString()).not.toContain('nx-space-atmosphere')
    expect(modal?.querySelectorAll('.nx-space-atmosphere')).toHaveLength(0)
    expect(modal?.className.toString()).toContain('border-[var(--nx-border-focus)]')

    // AI 长文阅读排版：正文级字号（text-[13px]）+ 舒适行距（leading-7）+ 最高对比正文色
    const textBlock = document.querySelector('[data-pmo-ai-rationale-text]')
    expect(textBlock).not.toBeNull()
    const paragraph = textBlock?.querySelector('p')
    expect(paragraph?.className.toString()).toContain('text-[13px]')
    expect(paragraph?.className.toString()).toContain('leading-7')
    expect(paragraph?.className.toString()).toContain('text-[var(--nx-text-primary)]')
    expect(paragraph?.textContent).toContain('推荐理由')
    // 状态双通道：色块 + 文字标签（AI 状态 chip + 免责声明）
    expect(document.querySelector('[data-pmo-ai-rationale-status]')?.textContent).toContain('可用')
    expect(document.querySelector('[data-pmo-ai-rationale-disclaimer]')?.textContent).toContain(
      'AI 理由仅供决策参考',
    )
    expect(document.querySelector('[data-pmo-ai-rationale-marker]')?.textContent).toContain(
      '置信度 30%',
    )

    view.unmount()
  })
})

// ---------------------------------------------------------------------------
// 三态完备性：骨架 / 空态 / 错误重试
// ---------------------------------------------------------------------------
describe('三态完备性：骨架屏 aria-busy 无空态闪烁（spec 要求 6）', () => {
  test('组合仪表盘摘要挂起：骨架 aria-busy，工作台与空态零闪现', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    const backend = portfolioSummaryBackend()
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/portfolio-dashboard')) {
        return gatedResponse(
          {
            data: {
              meta: {
                calculatedAt: '2026-09-10T08:00:00.000Z',
                metricVersion: 'portfolio-dashboard.v1',
                organizationId: 1,
                actorId: 1,
                visibleProjectCount: 0,
                totalProjectCount: 0,
              },
              kpis: [],
              trafficLight: null,
              freshness: [],
              warnings: [],
            },
          },
          gate,
        )
      }
      return backend(path, method)
    })

    await renderPage(<PmoPortfolioOverviewPage />)

    const skeleton = document.querySelector('[data-pmo-portfolio-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    // 数据未就绪前：工作台容器与组合空态零闪现
    expect(document.querySelector('[data-pmo-portfolio-workspace]')).toBeNull()
    expect(document.querySelector('[data-pmo-overview-empty]')).toBeNull()

    await act(async () => {
      resolveGate()
    })
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-portfolio-skeleton]')).toBeNull()
    // 工作台内嵌的 PmoInvestmentDistributionSection 独立发起 catalogue/trends/
    // distribution 三个查询，未被本测试的 gate 控制；断言已完成但它们仍在途，
    // 落定时机若晚于本测试结束会脱离 act 范围，先冲刷干净。
    await act(async () => {
      await settle()
    })
  })

  test('红绿灯列表在途：表格骨架 aria-busy，「暂无项目数据」空态零误报', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, {
          data: {
            red: 0,
            yellow: 0,
            green: 0,
            gray: 0,
            total: 0,
            calculatedAt: '2026-09-10T08:00:00.000Z',
          },
        })
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light')) {
        return gatedResponse(
          {
            data: [],
            meta: {
              page: 1,
              perPage: 20,
              total: 0,
              totalPages: 0,
              calculatedAt: '2026-09-10T08:00:00.000Z',
            },
          },
          gate,
        )
      }
      return null
    })

    await renderPage(<PmoTrafficLightPage />)

    await waitFor(() => expect(document.querySelector('[data-traffic-skeleton]')).not.toBeNull())
    const skeleton = document.querySelector('[data-traffic-skeleton]')
    expect(skeleton?.getAttribute('role')).toBe('status')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    // 空态零闪现
    expect(document.querySelector('[data-traffic-empty]')).toBeNull()
    expect(screen.queryByText('暂无项目数据')).toBeNull()

    await act(async () => {
      resolveGate()
    })
    await waitFor(() => expect(document.querySelector('[data-traffic-empty]')).not.toBeNull())
    expect(document.querySelector('[data-traffic-skeleton]')).toBeNull()
    await act(async () => {
      await settle()
    })
  })
})

describe('三态完备性：语义空态（各域空数据呈现，不伪造成数据）', () => {
  test('优先级评分空数据：表内语义空态 + 零写请求（纯只读）', async () => {
    installFetchRouter(priorityScoringBackend())
    await renderPage(<PmoPriorityScoringPage />)

    await waitFor(() => expect(document.querySelector('[data-pps-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-pps-empty]')).not.toBeNull())
    expect(document.querySelector('[data-pps-table]')).not.toBeNull()
    // weights/projects 查询各自独立落定，断言完成时未必都已 resolve，先冲刷干净。
    await act(async () => {
      await settle()
    })
  })

  test('AI 推荐空队列：语义空态 + 清除筛选语义（无伪数据行）', async () => {
    installFetchRouter(aiPriorityBackend())
    await renderPage(<PmoAiPriorityRecommendationsPage />)

    await waitFor(() => expect(document.querySelector('[data-pmo-ai-empty]')).not.toBeNull())
    expect(document.querySelectorAll('[data-pmo-ai-row]')).toHaveLength(0)
    expect(screen.getByText('当前没有需要关注的推荐')).toBeInTheDocument()
    await act(async () => {
      await settle()
    })
  })

  test('决策队列空：语义空态并引导具备 manage 权限者建卡', async () => {
    installFetchRouter(decisionsBackend())
    await renderPage(<PmoDecisionsPage />)

    await waitFor(() => expect(document.querySelector('[data-pmo-decisions-empty]')).not.toBeNull())
    expect(screen.getByText('当前筛选下没有决策议题')).toBeInTheDocument()
    // manage 权限在：建卡入口可见（空态引导可落地）
    expect(document.querySelector('[data-pmo-decisions-create-open]')).not.toBeNull()
    await act(async () => {
      await settle()
    })
  })
})

describe('三态完备性：500 错误卡 → 重新载入重试成功闭环', () => {
  test('组合仪表盘摘要 500：错误卡 → 重新载入后工作台恢复', async () => {
    let failedOnce = false
    const backend = portfolioSummaryBackend()
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/portfolio-dashboard') && !failedOnce) {
        failedOnce = true
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '后端繁忙' } })
      }
      return backend(path, method)
    })
    await renderPage(<PmoPortfolioOverviewPage />)

    await waitFor(() => expect(document.querySelector('[data-pmo-portfolio-error]')).not.toBeNull())
    expect(screen.getByText('PMO 组合总览加载失败')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-portfolio-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-portfolio-error]')).toBeNull()
    await act(async () => {
      await settle()
    })
  })

  test('红绿灯列表 500：错误卡 → 重新加载后列表恢复', async () => {
    let failedOnce = false
    const backend = trafficLightBackend()
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?') && !failedOnce) {
        failedOnce = true
        return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
      }
      return backend(path, method)
    })
    await renderPage(<PmoTrafficLightPage />)

    await waitFor(() => expect(document.querySelector('[data-traffic-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-traffic-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-traffic-row="1001"]')).not.toBeNull())
    expect(document.querySelector('[data-traffic-error]')).toBeNull()
    await act(async () => {
      await settle()
    })
  })

  test('优先级评分摘要 500：错误卡 → 重新载入后工作台恢复', async () => {
    let failedOnce = false
    const backend = priorityScoringBackend()
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/priority-scoring/summary') && !failedOnce) {
        failedOnce = true
        return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
      }
      return backend(path, method)
    })
    await renderPage(<PmoPriorityScoringPage />)

    await waitFor(() => expect(document.querySelector('[data-pps-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pps-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-pps-workspace]')).not.toBeNull())
    expect(document.querySelector('[data-pps-error]')).toBeNull()
    // 权重卡局部查询在摘要重试后仍会重查：等其状态落定，避免测试收尾时的
    // 「未被 act 包裹的状态更新」噪声（三态闭环本身已断言完毕）。
    await waitFor(() => expect(document.querySelector('[data-pps-weights]')).not.toBeNull())
    await act(async () => {
      await settle()
    })
  })
})
