import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Milestone } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import { OrgReportsGalleryWing } from '@/components/next/charts/OrgReportsGalleryWing'
import { useAuthStore } from '@/stores/auth-store'
import { jsonResponse } from './helpers/chart-gallery-network'

/**
 * v3-ui-next-batch4-reports-change-queue W1 · tasks 1.3 / 1.4
 * 图表馆组织级报表分馆容器与模板过滤测试（next-org-reports-gallery-wing.test.tsx）
 *
 * 覆盖：
 * 1. 分馆 Tab 切换与 4 类预设模板卡片渲染；
 * 2. 按项目多选与日期范围过滤工具栏交互；
 * 3. 精确档（data-immersion="precise"）纯平降级与零 Canvas/WebGL（RL-15）；
 * 4. 纯只读浏览全程零写网络请求（RL-01）；
 * 5. 未选组织时的中性引导态与零请求（RL-05）。
 */
describe('图表馆组织级报表分馆（W1 · tasks 1.3/1.4）', () => {
  let queryClient: QueryClient
  const recordedRequests: Array<{ url: string; method: string }> = []

  const mockProjects: Project[] = [
    {
      id: 101,
      organizationId: 1,
      name: '开项核心引擎',
      code: 'CORE-01',
      description: null,
      category: null,
      status: 'active',
      priority: 'high',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      budgetCents: null,
      currency: null,
      progressPercent: 45,
      healthStatus: 'healthy',
      settings: null,
      createdBy: 1,
      updatedBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 102,
      organizationId: 1,
      name: '深空控制台',
      code: 'SPACE-02',
      description: null,
      category: null,
      status: 'active',
      priority: 'critical',
      startDate: '2026-02-01',
      endDate: '2026-10-31',
      budgetCents: null,
      currency: null,
      progressPercent: 75,
      healthStatus: 'warning',
      settings: null,
      createdBy: 1,
      updatedBy: null,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  ]

  function makeTask(overrides: Partial<Task>): Task {
    return {
      id: 0,
      projectId: 0,
      name: '',
      description: null,
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: null,
      endDate: null,
      actualStartDate: null,
      actualEndDate: null,
      durationDays: null,
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  function makeMilestone(overrides: Partial<Milestone>): Milestone {
    return {
      id: 0,
      projectId: 0,
      name: '',
      description: null,
      plannedDate: null,
      status: 'planned',
      storedStatus: 'planned',
      autoCalculated: true,
      displayOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  const mockTasksProject101: Task[] = [
    makeTask({
      id: 1,
      projectId: 101,
      name: '架构重构模块',
      status: 'completed',
      priority: 'high',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      durationDays: 31,
      estimatedHours: 40,
      actualHours: 35,
      progressPercent: 100,
      assigneeId: 10,
    }),
    makeTask({
      id: 2,
      projectId: 101,
      name: '跨项目合成器调优',
      description: '等待依赖接口',
      status: 'blocked',
      priority: 'highest',
      startDate: '2026-02-01',
      endDate: '2026-03-01',
      durationDays: 28,
      estimatedHours: 30,
      actualHours: 10,
      progressPercent: 30,
      assigneeId: 10,
    }),
  ]

  const mockTasksProject102: Task[] = [
    makeTask({
      id: 3,
      projectId: 102,
      name: '控制台深色主题渲染',
      status: 'in_progress',
      priority: 'medium',
      startDate: '2026-02-01',
      endDate: '2026-05-01',
      durationDays: 89,
      estimatedHours: 25,
      actualHours: 20,
      progressPercent: 60,
      assigneeId: 20,
    }),
  ]

  const mockMilestonesProject101: Milestone[] = [
    makeMilestone({
      id: 1,
      projectId: 101,
      name: 'Alpha 架构就绪',
      plannedDate: '2026-03-01',
      status: 'achieved',
      storedStatus: 'achieved',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }),
  ]

  const mockMilestonesProject102: Milestone[] = [
    makeMilestone({
      id: 2,
      projectId: 102,
      name: 'Beta 试运行',
      plannedDate: '2026-06-01',
      status: 'planned',
      storedStatus: 'planned',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    }),
  ]

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
    recordedRequests.length = 0

    // 初始化 Auth 状态
    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目总监',
        organizations: [{ id: 1, name: '北极星研发中心', slug: 'northstar', role: 'owner' }],
      },
      accessToken: 'test-token',
      refreshToken: null,
      permissions: ['portfolio:view', 'report:view'],
      currentOrganizationId: 1,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })

    // 全局 fetch 桩（RL-01 / RL-05）
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      recordedRequests.push({ url, method })

      if (url.includes('/projects?')) {
        return jsonResponse(200, {
          data: mockProjects,
          meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (url.includes('/projects/101/tasks')) {
        return jsonResponse(200, { data: mockTasksProject101 })
      }
      if (url.includes('/projects/102/tasks')) {
        return jsonResponse(200, { data: mockTasksProject102 })
      }
      if (url.includes('/projects/101/milestones')) {
        return jsonResponse(200, { data: mockMilestonesProject101 })
      }
      if (url.includes('/projects/102/milestones')) {
        return jsonResponse(200, { data: mockMilestonesProject102 })
      }

      return jsonResponse(404, {})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-immersion')
  })

  function renderWing(props: React.ComponentProps<typeof OrgReportsGalleryWing> = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <OrgReportsGalleryWing {...props} />
      </QueryClientProvider>,
    )
  }

  test('1. 未选组织时渲染中性引导态且零数据网络发包 (RL-05)', () => {
    useAuthStore.setState({ currentOrganizationId: null })
    const { container } = renderWing({ organizationId: null })

    expect(screen.getByText('未选择有效组织')).toBeDefined()
    expect(container.querySelector('[data-unselected-org-neutral]')).not.toBeNull()

    // 严苛断言：零网络发包
    expect(recordedRequests).toHaveLength(0)
  })

  test('2. 正常加载组织级分馆，渲染 4 类标准化预设报表模板卡片', async () => {
    renderWing()

    expect(screen.getByText('组织级报表分馆')).toBeDefined()
    const cardsGrid = document.querySelector('[data-org-reports-cards-grid]') as HTMLElement
    expect(within(cardsGrid).getByText('组织进度概览报表')).toBeDefined()
    expect(within(cardsGrid).getByText('全域延期任务全景')).toBeDefined()
    expect(within(cardsGrid).getByText('组织资源工时负荷')).toBeDefined()
    expect(within(cardsGrid).getByText('里程碑交付全景')).toBeDefined()

    // 等待项目列表加载
    await waitFor(() => {
      expect(screen.getByText('共 2 个纳入项目')).toBeDefined()
    })

    // 全程零写请求 (RL-01)
    const writes = recordedRequests.filter((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    )
    expect(writes).toHaveLength(0)
  })

  test('3. 点击分馆 Tab 切换模板并渲染进度概览快照预览面板', async () => {
    renderWing()

    const progressTab = document.querySelector('[data-template-tab="progress"]')
    expect(progressTab).not.toBeNull()
    fireEvent.click(progressTab!)

    // 快照预览面板滑出展开
    await waitFor(() => {
      expect(document.querySelector('[data-report-snapshot-panel]')).not.toBeNull()
    })

    // 等待进度快照合成指标渲染
    await waitFor(() => {
      const metric = document.querySelector('[data-snapshot-metric-overall-progress]')
      expect(metric).not.toBeNull()
      // 加权进度指标显示
      expect(metric?.textContent).toContain('%')
    })

    // 验证阻塞项汇总指标（项目 101 存在 1 项 blocked 任务）
    expect(screen.getByText('阻塞高危任务')).toBeDefined()

    // 点击全览 Tab 关闭快照
    const allTab = document.querySelector('[data-template-tab="all"]')
    expect(allTab).not.toBeNull()
    fireEvent.click(allTab!)

    expect(document.querySelector('[data-report-snapshot-panel]')).toBeNull()
  })

  test('4. 点击延期全景模板卡片展开延期大盘并断言延期率', async () => {
    renderWing()

    const delayCard = document.querySelector('[data-report-template-card="delay"]')
    expect(delayCard).not.toBeNull()
    fireEvent.click(delayCard!)

    await waitFor(() => {
      expect(document.querySelector('[data-snapshot-metric-delay-rate]')).not.toBeNull()
    })

    expect(screen.getByText('跨项目高危逾期任务')).toBeDefined()
  })

  test('5. 过滤工具栏：项目多选与日期范围变更交互', async () => {
    renderWing()

    await waitFor(() => {
      expect(document.querySelector('[data-project-filter-item="101"]')).not.toBeNull()
    })

    // 勾选项目 101
    const item101 = document.querySelector('[data-project-filter-item="101"]')!
    fireEvent.click(item101)

    // 重置按钮出现
    expect(screen.getByText('重置项目 (1)')).toBeDefined()

    // 输入日期范围
    const fromInput = document.querySelector('[data-from-date-input]') as HTMLInputElement
    const toInput = document.querySelector('[data-to-date-input]') as HTMLInputElement
    expect(fromInput).not.toBeNull()
    expect(toInput).not.toBeNull()

    fireEvent.change(fromInput, { target: { value: '2026-01-01' } })
    fireEvent.change(toInput, { target: { value: '2026-12-31' } })

    expect(fromInput.value).toBe('2026-01-01')
    expect(toInput.value).toBe('2026-12-31')

    // 点击重置
    const clearBtn = document.querySelector('[data-action="clear-project-filters"]')!
    fireEvent.click(clearBtn)
    expect(document.querySelector('[data-action="clear-project-filters"]')).toBeNull()
  })

  test('6. 精确档（data-immersion="precise"）纯平降级与零画布/零 WebGL (RL-15)', () => {
    const { container } = renderWing({ immersionTier: 'precise' })

    const wingRoot = container.querySelector('[data-org-reports-gallery-wing]')
    expect(wingRoot).not.toBeNull()
    expect(wingRoot?.getAttribute('data-immersion')).toBe('precise')

    // 严苛断言：DOM 中零 canvas 与零 WebGL 元素 (RL-15)
    expect(container.querySelector('canvas')).toBeNull()
  })

  test('7. 汇出下拉菜单挂载槽位正常就绪', async () => {
    renderWing({ initialTemplate: 'progress' })

    await waitFor(() => {
      expect(document.querySelector('[data-chart-export-mount]')).not.toBeNull()
    })
  })

  test('8. 严苛断言浏览与快照查看全流程零写网络请求 (RL-01)', async () => {
    renderWing({ initialTemplate: 'workload' })

    await waitFor(() => {
      expect(document.querySelector('[data-snapshot-metric-workload]')).not.toBeNull()
    })

    const writeRequests = recordedRequests.filter((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    )
    expect(writeRequests).toHaveLength(0)
  })
})
