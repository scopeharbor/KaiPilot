/**
 * v3-ui-next-batch3-global-convergence W3 · 任务 3.4
 * 全域时间主轴渲染与刻度缩放测试。
 *
 * 覆盖：
 * 1. 多项目泳道首屏渲染（项目名、项目特征色彩微标、进度百分比）；
 * 2. 今天锚点指示线对齐（--nx-space-cyan 电光指示线、三区划分与百分比）；
 * 3. 周/月/季刻度档位切换与标尺重排；
 * 4. 精确档（precise）移除光晕纯平呈现与 RL-15 视觉红线守护（零 Canvas / 零 WebGL）。
 */

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GlobalTimelineBar } from '@/components/next/project-space/GlobalTimelineBar'
import {
  composeGlobalTimelineSeries,
  type GlobalTimelineSeriesTree,
} from '@/lib/next/global-timeline-composer'
import { useNextTrackStore } from '@/stores/next-track-store'

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/next',
  useSearchParams: () => new URLSearchParams(),
}))

function makeMockSeries(): GlobalTimelineSeriesTree {
  return composeGlobalTimelineSeries({
    projects: [
      {
        id: 1,
        organizationId: 1,
        name: '火星探测二期',
        code: 'MARS-2',
        description: null,
        category: 'space',
        status: 'active',
        priority: 'high',
        startDate: '2026-09-01',
        endDate: '2026-10-31',
        budgetCents: 500000,
        currency: 'CNY',
        progressPercent: 40,
        healthStatus: 'healthy',
        settings: null,
        createdBy: 1,
        updatedBy: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 2,
        organizationId: 1,
        name: '深空通信基站',
        code: 'COMM-1',
        description: null,
        category: 'comm',
        status: 'active',
        priority: 'critical',
        startDate: '2026-09-05',
        endDate: '2026-11-15',
        budgetCents: 300000,
        currency: 'CNY',
        progressPercent: 65,
        healthStatus: 'healthy',
        settings: null,
        createdBy: 1,
        updatedBy: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    milestonesMap: {
      1: [
        {
          id: 101,
          projectId: 1,
          name: '着陆器初样验收',
          description: '完成结构件总装',
          status: 'planned',
          storedStatus: 'planned',
          plannedDate: '2026-09-20',
          autoCalculated: false,
          displayOrder: 1,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
      2: [
        {
          id: 201,
          projectId: 2,
          name: '微波阵列合封',
          description: '天线阵列封测',
          status: 'at_risk',
          storedStatus: 'at_risk',
          plannedDate: '2026-09-25',
          autoCalculated: false,
          displayOrder: 1,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
    },
    tasksMap: {
      1: [
        {
          id: 1001,
          projectId: 1,
          name: '高载荷力学仿真',
          description: null,
          status: 'in_progress',
          priority: 'high',
          taskType: 'task',
          startDate: '2026-09-10',
          endDate: '2026-09-18',
          actualStartDate: null,
          actualEndDate: null,
          durationDays: 8,
          estimatedHours: 40,
          actualHours: 20,
          progressPercent: 50,
          assigneeId: 10,
          reviewerId: null,
          parentTaskId: null,
          wbsNodeId: null,
          milestoneId: 101,
          costEstimateCents: null,
          costActualCents: null,
          customFields: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
      2: [],
    },
    today: '2026-09-15',
    scale: 'month',
  })
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('GlobalTimelineBar 首屏渲染与主轴布局', () => {
  beforeEach(() => {
    act(() => useNextTrackStore.setState({ immersionTier: null }))
    document.documentElement.removeAttribute('data-immersion')
  })

  afterEach(() => {
    act(() => useNextTrackStore.setState({ immersionTier: null }))
    document.documentElement.removeAttribute('data-immersion')
  })

  test('多项目泳道首屏正确渲染', () => {
    const mockTree = makeMockSeries()
    const { container } = renderWithClient(
      <GlobalTimelineBar seriesTree={mockTree} today="2026-09-15" />,
    )

    // 容器与标题
    expect(container.querySelector('[data-global-timeline-bar]')).toBeInTheDocument()
    expect(screen.getByText('全域交付时间主轴')).toBeInTheDocument()

    // 泳道信息
    expect(screen.getByText('火星探测二期')).toBeInTheDocument()
    expect(screen.getByText('深空通信基站')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('65%')).toBeInTheDocument()

    // 泳道色彩微标与节点元素
    const dots = container.querySelectorAll('[data-lane-color-dot]')
    expect(dots).toHaveLength(2)

    const milestones = container.querySelectorAll('[data-timeline-node="milestone"]')
    expect(milestones).toHaveLength(2)

    const tasks = container.querySelectorAll('[data-timeline-node="task"]')
    expect(tasks).toHaveLength(1)
  })

  test('今天锚点指示线对齐与三区语义划分', () => {
    const mockTree = makeMockSeries()
    const { container } = renderWithClient(
      <GlobalTimelineBar seriesTree={mockTree} today="2026-09-15" />,
    )

    // 过去分区与未来分区
    const pastZone = container.querySelector('[data-timeline-past]') as HTMLElement
    const futureZone = container.querySelector('[data-timeline-future]') as HTMLElement
    expect(pastZone).toBeInTheDocument()
    expect(futureZone).toBeInTheDocument()

    // 今天指示线与标签
    const todayIndicator = container.querySelector('[data-timeline-today-indicator]') as HTMLElement
    expect(todayIndicator).toBeInTheDocument()
    expect(todayIndicator.style.left).toBe(`${mockTree.todayPercent}%`)

    const todayLine = container.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(todayLine.className).toContain('bg-[var(--nx-space-cyan)]')

    const todayLabel = container.querySelector('[data-timeline-today-label]') as HTMLElement
    expect(todayLabel.textContent).toContain('2026-09-15 今天')
  })

  test('周/月/季刻度档位切换与标尺重排', () => {
    const mockTree = makeMockSeries()
    const { container } = renderWithClient(
      <GlobalTimelineBar seriesTree={mockTree} initialScale="month" today="2026-09-15" />,
    )

    const weekBtn = container.querySelector('[data-scale-button="week"]') as HTMLButtonElement
    const monthBtn = container.querySelector('[data-scale-button="month"]') as HTMLButtonElement
    const quarterBtn = container.querySelector('[data-scale-button="quarter"]') as HTMLButtonElement

    expect(monthBtn.getAttribute('aria-pressed')).toBe('true')

    // 切换至周刻度
    fireEvent.click(weekBtn)
    expect(weekBtn.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-global-timeline-bar]')?.getAttribute('data-scale')).toBe(
      'week',
    )

    // 切换至季刻度
    fireEvent.click(quarterBtn)
    expect(quarterBtn.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-global-timeline-bar]')?.getAttribute('data-scale')).toBe(
      'quarter',
    )
  })

  test('精确档（precise）纯平呈现与 RL-15 视觉红线守护', () => {
    act(() => useNextTrackStore.setState({ immersionTier: 'precise' }))
    const mockTree = makeMockSeries()
    const { container } = renderWithClient(
      <GlobalTimelineBar seriesTree={mockTree} today="2026-09-15" />,
    )

    const bar = container.querySelector('[data-global-timeline-bar]')
    expect(bar?.getAttribute('data-immersion')).toBe('precise')

    // 今天锚点指示线剔除光晕
    const todayLine = container.querySelector('[data-timeline-today-line]') as HTMLElement
    expect(todayLine.className).not.toContain('shadow-[0_0_8px_var(--nx-space-cyan)]')

    // 未来区段退化为实线发丝
    const futureZone = container.querySelector('[data-timeline-future]') as HTMLElement
    expect(futureZone.className).not.toContain('border-dashed')
    expect(futureZone.className).toContain('border-[var(--nx-border-hairline)]')

    // RL-15 视觉红线守护：零 Canvas、零 WebGL
    expect(container.querySelectorAll('canvas')).toHaveLength(0)
    expect(container.innerHTML).not.toContain('webgl')
  })
})
