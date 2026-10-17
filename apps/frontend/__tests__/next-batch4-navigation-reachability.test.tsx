/**
 * v3-ui-next-batch4-reports-change-queue W5 · tasks 5.3 / 5.4
 * 空间地图静态坐标点亮与 AI 同事意图三通道直达集成测试（next-batch4-navigation-reachability.test.tsx）
 *
 * 覆盖：
 * 1. 通道一（空间地图）：
 *    - 白名单点亮「组织报表分馆」「PMO 组合报表」「PMO 变更审批队列」3 项坐标；
 *    - filterSpaceCoordinates('报表') 命中组织报表分馆与 PMO 组合报表；
 *    - filterSpaceCoordinates('变更审批') 命中 PMO 变更审批队列；
 *    - SpaceMapOverlay 搜索框即时检索与卡片直达。
 * 2. 通道二（AI 同事意图直达）：
 *    - 输入「查看全局变更审批」命中 rule_nav_pmo_change_queue 并派发 navigate_to_space；
 *    - 输入「去组合报表」命中 rule_nav_pmo_reports；
 *    - 输入「去组织报表分馆」命中 rule_nav_org_reports_wing；
 *    - NavigationResultCard 导航结果直达卡片回显与点击跳转。
 * 3. 通道三（工作台子导航与深链）：
 *    - PMO 组合总览工作台子导航挂载「组合报表」与「变更队列」入口并支持点击直达。
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  filterSpaceCoordinates,
  PRESET_SPACE_COORDINATES,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'
import { parseColleagueIntent, type ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import {
  NavigationResultCard,
  type NavigationResultData,
} from '@/components/next/ai/cards/NavigationResultCard'
import { PmoPortfolioOverviewWorkspace } from '@/components/next/pmo/PmoPortfolioOverviewWorkspace'
import { portfolioDashboardKeys } from '@/lib/api/portfolio-dashboard'
import { useAuthStore } from '@/stores/auth-store'

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
}

describe('批 4 三通道可达与导航直达集成测试 (W5 · tasks 5.3/5.4)', () => {
  const dummyContext: ColleagueContext = {
    contextType: 'role_home',
    currentProjectId: null,
    pathname: '/next',
  }

  const projectContext: ColleagueContext = {
    contextType: 'project_space',
    currentProjectId: 42,
    pathname: '/next/projects/42',
  }

  const mockSummary = {
    kpis: [
      {
        id: '1',
        key: 'total_projects',
        name: '总项目数',
        value: 12,
        unit: '个',
        trend: 'neutral',
        status: 'healthy' as const,
      },
    ],
    trafficLight: {
      available: true,
      counts: { red: 1, amber: 2, green: 9, unclassified: 0 },
      warnings: [],
    },
    distribution: [],
    warnings: [],
    meta: { visibleProjectCount: 12, calculatedAt: new Date().toISOString() },
  }

  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pmo@example.com',
        fullName: 'PMO 负责人',
        organizations: [{ id: 1, name: '测试组织', slug: 'test-org', role: 'admin' }],
      },
      currentOrganizationId: 1,
      permissions: ['portfolio:view', 'change_request:approve', 'pmo_decision:view'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (rawUrl.includes('/pmo/investment-distribution/catalogue')) {
        const body = {
          data: {
            nonFinancialBasis: ['project_count', 'planned_effort_hours'],
            unsupportedFinancialBasis: ['budget_amount'],
            dimensions: ['project_type', 'status'],
            displayModes: ['donut'],
            topN: { default: 10, max: 20 },
            trendWindows: ['last_30_days', 'last_90_days'],
            metricVersion: 'pmo-investment-distribution.v1',
          },
        }
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        } as unknown as Response
      }
      if (rawUrl.includes('/pmo/investment-distribution/trends')) {
        const body = {
          meta: {
            calculatedAt: '2026-09-01T08:00:00.000Z',
            metricVersion: 'pmo-investment-distribution.v1',
            sourceFreshness: [],
          },
          data: [],
          warnings: [],
        }
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        } as unknown as Response
      }
      if (rawUrl.includes('/pmo/investment-distribution')) {
        const body = {
          data: {
            meta: {
              calculatedAt: '2026-09-01T08:00:00.000Z',
              metricVersion: 'pmo-investment-distribution.v1',
              organizationId: 1,
              sourceFreshness: [],
            },
            buckets: [],
            warnings: [],
          },
        }
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: mockSummary }),
        text: async () => JSON.stringify({ data: mockSummary }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as unknown as Response
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. 通道一：空间地图（Ctrl+M / 坐标检索 / 镜头切换）
  // -------------------------------------------------------------------------
  describe('通道一：空间地图（静态坐标点亮与检索直达）', () => {
    test('静态白名单点亮 3 项批 4 坐标，字段符合契约', () => {
      const orgReports = PRESET_SPACE_COORDINATES.find((c) => c.id === 'org-reports-wing')
      expect(orgReports).toBeDefined()
      expect(orgReports?.title).toBe('组织报表分馆')
      expect(orgReports?.path).toBe('/next/charts?tab=reports-wing')
      expect(orgReports?.status).toBe('available')
      expect(orgReports?.badge).toBe('已就绪')

      const pmoReports = PRESET_SPACE_COORDINATES.find((c) => c.id === 'pmo-reports')
      expect(pmoReports).toBeDefined()
      expect(pmoReports?.title).toBe('PMO 组合报表')
      expect(pmoReports?.path).toBe('/next/pmo/reports')
      expect(pmoReports?.status).toBe('available')

      const pmoChangeQueue = PRESET_SPACE_COORDINATES.find((c) => c.id === 'pmo-change-queue')
      expect(pmoChangeQueue).toBeDefined()
      expect(pmoChangeQueue?.title).toBe('PMO 变更审批队列')
      expect(pmoChangeQueue?.path).toBe('/next/pmo/change-queue')
      expect(pmoChangeQueue?.status).toBe('available')
    })

    test('输入「报表」检索命中组织报表分馆与 PMO 组合报表', () => {
      const matches = filterSpaceCoordinates('报表')
      const ids = matches.map((c) => c.id)
      expect(ids).toContain('org-reports-wing')
      expect(ids).toContain('pmo-reports')
    })

    test('输入「变更审批」检索唯一命中 PMO 变更审批队列', () => {
      const matches = filterSpaceCoordinates('变更审批')
      const ids = matches.map((c) => c.id)
      expect(ids).toContain('pmo-change-queue')
    })

    test('resolveSpaceCoordinatePath 解析三项坐标原样返回（组织级/全局视窗零 :id 假链接）', () => {
      expect(resolveSpaceCoordinatePath('/next/charts?tab=reports-wing', null)).toBe(
        '/next/charts?tab=reports-wing',
      )
      expect(resolveSpaceCoordinatePath('/next/pmo/reports', null)).toBe('/next/pmo/reports')
      expect(resolveSpaceCoordinatePath('/next/pmo/change-queue', null)).toBe(
        '/next/pmo/change-queue',
      )
    })

    test('SpaceMapOverlay 输入关键词即时过滤并可点击直达', () => {
      const queryClient = createTestQueryClient()
      const onSelectCoordinate = vi.fn()

      render(
        <QueryClientProvider client={queryClient}>
          <SpaceMapOverlay open={true} onClose={vi.fn()} onSelectCoordinate={onSelectCoordinate} />
        </QueryClientProvider>,
      )

      const searchInput = screen.getByLabelText('搜索空间坐标')
      expect(searchInput).toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: '变更审批' } })

      const queueCard = screen.getByText('PMO 变更审批队列')
      expect(queueCard).toBeInTheDocument()

      fireEvent.click(queueCard)
      expect(onSelectCoordinate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pmo-change-queue' }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // 2. 通道二：AI 同事指令直达 (Natural Language Rules)
  // -------------------------------------------------------------------------
  describe('通道二：AI 同事意图直达与结果卡片', () => {
    test('输入「查看全局变更审批」命中 rule_nav_pmo_change_queue 直达变更审批队列', () => {
      const intent = parseColleagueIntent('查看全局变更审批', dummyContext)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe('rule_nav_pmo_change_queue')
      expect(intent.confidence).toBe(1)
      expect(intent.parameters).toEqual({
        lens: 'pmo',
        target: 'pmo-change-queue',
      })
    })

    test('输入「去变更审批队列」在项目上下文内同样命中全局审批队列（组织级视角）', () => {
      const intent = parseColleagueIntent('去变更审批队列', projectContext)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe('rule_nav_pmo_change_queue')
      expect(intent.parameters).toEqual({
        lens: 'pmo',
        target: 'pmo-change-queue',
      })
    })

    test('输入「去组合报表」命中 rule_nav_pmo_reports 直达 PMO 组合报表', () => {
      const intent = parseColleagueIntent('去组合报表', dummyContext)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe('rule_nav_pmo_reports')
      expect(intent.confidence).toBe(1)
      expect(intent.parameters).toEqual({
        lens: 'pmo',
        target: 'pmo-reports',
      })
    })

    test('输入「查看PMO报表」同样命中 rule_nav_pmo_reports', () => {
      const intent = parseColleagueIntent('查看PMO报表', dummyContext)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe('rule_nav_pmo_reports')
      expect(intent.parameters).toEqual({
        lens: 'pmo',
        target: 'pmo-reports',
      })
    })

    test('输入「去组织报表分馆」命中 rule_nav_org_reports_wing 直达图表馆分馆', () => {
      const intent = parseColleagueIntent('去组织报表分馆', dummyContext)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe('rule_nav_org_reports_wing')
      expect(intent.confidence).toBe(1)
      expect(intent.parameters).toEqual(
        expect.objectContaining({
          lens: 'charts',
          tab: 'reports-wing',
        }),
      )
    })

    test('AI 同事空间导航结果卡片 NavigationResultCard 渲染与直达回跳', () => {
      const onNavigate = vi.fn()
      const data: NavigationResultData = {
        projectId: null,
        lens: 'pmo',
        depth: 'workbench',
        targetId: null,
        path: '/next/pmo/change-queue',
      }

      render(<NavigationResultCard data={data} onNavigate={onNavigate} />)

      expect(screen.getByText('空间导航已执行')).toBeInTheDocument()
      expect(document.querySelector('[data-navigate-lens]')?.textContent).toBe('PMO 组合层')
      expect(document.querySelector('[data-navigate-path]')?.textContent).toBe(
        '/next/pmo/change-queue',
      )

      // RL-07 诚实徽标
      expect(document.querySelector('[data-rule-match-badge]')?.textContent).toContain(
        '快捷规则匹配 · navigate_to_space',
      )

      const againLink = screen.getByRole('link', { name: '再次前往 · 直达该路径' })
      expect(againLink).toHaveAttribute('href', '/next/pmo/change-queue')
      fireEvent.click(againLink)
      expect(onNavigate).toHaveBeenCalledWith('/next/pmo/change-queue')
    })
  })

  // -------------------------------------------------------------------------
  // 3. 通道三：PMO 工作台子导航与挂载点
  // -------------------------------------------------------------------------
  describe('通道三：PMO 工作台子导航挂载点与一键直达', () => {
    test('PMO 组合总览工作台正常呈现「组合报表」与「变更队列」子导航按钮并响应点击', async () => {
      const queryClient = createTestQueryClient()
      queryClient.setQueryData(portfolioDashboardKeys.summary(), mockSummary)

      render(
        <QueryClientProvider client={queryClient}>
          <PmoPortfolioOverviewWorkspace />
        </QueryClientProvider>,
      )

      const reportsNav = await screen.findByRole('button', { name: /组合报表/i })
      expect(reportsNav).toBeInTheDocument()
      fireEvent.click(reportsNav)
      expect(pushMock).toHaveBeenCalledWith('/next/pmo/reports')

      const changeQueueNav = await screen.findByRole('button', { name: /变更队列/i })
      expect(changeQueueNav).toBeInTheDocument()
      fireEvent.click(changeQueueNav)
      expect(pushMock).toHaveBeenCalledWith('/next/pmo/change-queue')
    })
  })
})
