/**
 * v3-ui-next-chart-gallery W5 · tasks 5.4 —— 只读镜头零写保护专项集成测试。
 *
 * 在 6 项只读分析镜头（资源负荷、散布图、AON 网络图、里程碑、RBS、看板入口）
 * 中模拟高频交互（视图 Tab 切换、维度切换、节点/旗帜点击、展开折叠、技能检索、
 * 看板直达），网络层以全局 fetch 伪后端全程监控：除镜头初始 GET 数据查询外，
 * POST/PATCH/PUT/DELETE 请求次数严格为 0（RL-01 / RL-11 spec 场景）。
 *
 * 交互采用镜头真实 DOM 数据属性（与 W2-W4 镜头测试同一契约面）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ResourceLoadChartLens } from '@/components/next/charts/lenses/ResourceLoadChartLens'
import { ScatterPlotChartLens } from '@/components/next/charts/lenses/ScatterPlotChartLens'
import { MilestoneTimelineChartLens } from '@/components/next/charts/lenses/MilestoneTimelineChartLens'
import { AonNetworkChartLens } from '@/components/next/charts/lenses/AonNetworkChartLens'
import { RbsTreeChartLens } from '@/components/next/charts/RbsTreeChartLens'
import { ChartGalleryCatalog } from '@/components/next/charts/ChartGalleryCatalog'
import { useAuthStore } from '@/stores/auth-store'
import {
  installFetchRouter,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

// ECharts jsdom 桩（design §8.1，TDZ 安全写法）
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const inst = {
        setOption: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getOption: vi.fn(() => undefined),
        isDisposed: vi.fn(() => false),
      }
      dom.setAttribute('data-echarts-mock-rendered', 'true')
      return inst
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 伪后端数据（对齐既有端点响应形状）
// ---------------------------------------------------------------------------

function envelope<T>(data: T, total = data instanceof Array ? data.length : 1) {
  return { data, meta: { total, page: 1, perPage: 100, totalPages: 1 } }
}

const task = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  projectId: 42,
  name: `任务 ${id}`,
  description: null,
  status: 'in_progress',
  priority: 'medium',
  taskType: 'task',
  startDate: null,
  endDate: null,
  actualStartDate: null,
  actualEndDate: null,
  durationDays: 2,
  estimatedHours: null,
  actualHours: null,
  progressPercent: 0,
  assigneeId: null,
  reviewerId: null,
  parentTaskId: null,
  wbsNodeId: null,
  milestoneId: null,
  costEstimateCents: null,
  costActualCents: null,
  customFields: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: null,
  ...overrides,
})

const dependency = (
  id: number,
  predecessorId: number,
  successorId: number,
  type = 'fs',
  lagDays = 0,
) => ({
  id,
  predecessorId,
  successorId,
  type,
  lagDays,
  predecessor: {
    id: predecessorId,
    name: `任务 ${predecessorId}`,
    status: 'not_started',
    startDate: null,
    endDate: null,
  },
  successor: {
    id: successorId,
    name: `任务 ${successorId}`,
    status: 'not_started',
    startDate: null,
    endDate: null,
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: null,
})

const resource = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  organizationId: 1,
  projectId: 42,
  name: `成员 ${id}`,
  resourceType: 'human',
  role: id === 1 ? 'project_manager' : 'member',
  email: null,
  dailyCapacityHours: 8,
  costPerHourCents: 5000,
  skillTags: JSON.stringify(id === 1 ? ['React', '架构'] : ['测试']),
  status: 'active',
  isExternal: false,
  ...overrides,
})

/** 全镜头只读数据后端（仅 GET；未匹配 → null → 404，测试即刻暴露）。 */
function readonlyBackend(path: string, method: string): Response | null {
  if (method !== 'GET') return null
  // 资源负荷：trend/team 双视图
  if (path.startsWith('/projects/42/resources/load')) {
    const view = new URL(path, 'http://x').searchParams.get('view')
    if (view === 'team') {
      return jsonResponse(200, {
        from: '2026-09-01',
        to: '2026-09-30',
        teamAverageUtilizationPercent: 125,
        resources: [
          {
            resourceId: 1,
            resourceName: '张启明',
            role: 'project_manager',
            dailyCapacityHours: 8,
            overallUtilizationPercent: 125,
            days: [
              {
                date: '2026-09-01',
                totalAllocatedPercent: 125,
                allocatedHours: 10,
                capacityHours: 8,
              },
            ],
          },
        ],
      })
    }
    return jsonResponse(200, {
      from: '2026-09-01',
      to: '2026-09-30',
      totalResources: 1,
      days: [
        { date: '2026-09-01', capacityHours: 24, totalHours: 20, utilizationPercent: 83.3 },
        { date: '2026-09-02', capacityHours: 24, totalHours: 30, utilizationPercent: 125 },
      ],
    })
  }
  // 散布图：任务 + 风险
  if (path.startsWith('/projects/42/tasks')) {
    return jsonResponse(
      200,
      envelope([
        task(1, {
          estimatedHours: 10,
          actualHours: 12,
          costEstimateCents: 10000,
          costActualCents: 9000,
        }),
        task(2, { estimatedHours: 8, actualHours: 8 }),
        task(3, { estimatedHours: 5, actualHours: 2 }),
      ]),
    )
  }
  if (path.startsWith('/projects/42/risks') && !path.includes('/risks/')) {
    return jsonResponse(
      200,
      envelope([
        {
          id: 1,
          projectId: 42,
          title: '上游依赖延期',
          probability: 4,
          impact: 4,
          score: 16,
          status: 'identified',
        },
      ]),
    )
  }
  // 里程碑：列表 + 关联任务
  if (path.startsWith('/projects/42/milestones')) {
    return jsonResponse(
      200,
      envelope([
        { id: 1, projectId: 42, name: '需求冻结', status: 'achieved', plannedDate: '2026-09-10' },
        { id: 2, projectId: 42, name: '联调通过', status: 'at_risk', plannedDate: '2026-10-05' },
      ]),
    )
  }
  // AON：依赖 + 任务（plain array 依赖契约）
  if (path.startsWith('/projects/42/dependencies')) {
    return jsonResponse(200, [dependency(11, 1, 2)])
  }
  // RBS：资源分页清单
  if (path.startsWith('/projects/42/resources')) {
    return jsonResponse(
      200,
      envelope(
        [resource(1), resource(2, { role: 'member', skillTags: JSON.stringify(['React', 'Vue']) })],
        2,
      ),
    )
  }
  return null
}

// 本文件按 tasks.md 命名保持 .ts 后缀：用 createElement 组装（无 JSX 语法）
const h = React.createElement

function mountLens(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    h(QueryClientProvider, { client }, h('div', { style: { height: 760, width: 1200 } }, node)),
  )
}

function clickN(selector: string, times: number) {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
  for (let i = 0; i < times; i += 1) {
    const node = nodes[i % Math.max(nodes.length, 1)]
    if (node) fireEvent.click(node)
  }
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('只读镜头高频交互零写保护（RL-01/RL-11 spec 场景）', () => {
  test('资源负荷：Trend/Team 高频切换 + 窗口点击，全程零写请求', async () => {
    const router = installFetchRouter(readonlyBackend)
    mountLens(h(ResourceLoadChartLens, { projectId: 42 }))
    await waitFor(() => expect(document.querySelector('[data-lens-view-tabs]')).not.toBeNull())
    clickN('[data-lens-view-tab]', 6)

    expect(writeMethods(router.records)).toEqual([])
    const urls = router.records.map((r) => r.url)
    expect(urls.every((url) => url.includes('/resources/load'))).toBe(true)
  })

  test('散布图：工时/成本/风险维度高频切换，全程零写请求', async () => {
    const router = installFetchRouter(readonlyBackend)
    mountLens(h(ScatterPlotChartLens, { projectId: 42 }))
    await waitFor(() => expect(document.querySelector('[data-scatter-dim-tabs]')).not.toBeNull())
    clickN('[data-scatter-dim-tab]', 9)

    expect(writeMethods(router.records)).toEqual([])
  })

  test('里程碑：点击各状态旗帜开合详情，全程零写请求', async () => {
    const router = installFetchRouter(readonlyBackend)
    mountLens(h(MilestoneTimelineChartLens, { projectId: 42 }))
    await waitFor(() => expect(document.querySelector('[data-milestone-node]')).not.toBeNull())
    clickN('[data-milestone-node]', 6)
    const close = document.querySelector('[data-milestone-detail-close]')
    if (close) fireEvent.click(close)

    expect(writeMethods(router.records)).toEqual([])
  })

  test('AON 网络图：节点点击/取消与详情抽屉关闭高频交互，全程零写请求', async () => {
    const router = installFetchRouter(readonlyBackend)
    mountLens(h(AonNetworkChartLens, { projectId: 42 }))
    await waitFor(() => expect(document.querySelector('[data-aon-node]')).not.toBeNull())
    clickN('[data-aon-node]', 6)
    const close = document.querySelector('[data-aon-drawer-close]')
    if (close) fireEvent.click(close)

    expect(writeMethods(router.records)).toEqual([])
  })

  test('RBS：展开/折叠/技能检索高频交互，全程零写请求', async () => {
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '王启明',
        organizations: [
          { id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' },
        ],
      },
      accessToken: null,
      refreshToken: null,
      permissions: ['project:view', 'resource:view'],
      currentOrganizationId: 1,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })
    const router = installFetchRouter(readonlyBackend)
    mountLens(h(RbsTreeChartLens, { projectId: 42 }))
    await waitFor(() => expect(document.querySelector('[data-rbs-expand-all]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-rbs-expand-all]')!)
    fireEvent.click(document.querySelector('[data-rbs-collapse-all]')!)
    fireEvent.click(document.querySelector('[data-rbs-expand-all]')!)
    clickN('[data-rbs-toggle]', 4)

    const search = document.querySelector<HTMLInputElement>('[data-rbs-skill-search]')
    expect(search).not.toBeNull()
    if (search) {
      fireEvent.change(search, { target: { value: 'React' } })
      fireEvent.change(search, { target: { value: '测试' } })
      fireEvent.change(search, { target: { value: '' } })
    }

    expect(writeMethods(router.records)).toEqual([])
    const urls = router.records.map((r) => r.url)
    expect(urls.every((url) => url.includes('/resources'))).toBe(true)
  })

  test('看板入口：目录点击直达主工作面（lens=kanban），零网络请求', async () => {
    const router = installFetchRouter(() => null)
    mountLens(h(ChartGalleryCatalog, { projectId: 42 }))
    fireEvent.click(document.querySelector('[data-chart-card="kanban"]')!)

    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42?lens=kanban')
    expect(router.records).toHaveLength(0)
    expect(writeMethods(router.records)).toEqual([])
  })
})
