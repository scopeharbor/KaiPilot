/**
 * v3-ui-next-batch3-global-convergence W3 · 任务 3.6
 * 全域时间主轴节点悬停明细卡与深链穿透测试。
 *
 * 覆盖：
 * 1. 鼠标悬停 (mouseEnter / mouseLeave) 激活与关闭暗黑明细卡；
 * 2. 键盘焦点 (focus / blur) 无障碍呼出明细卡；
 * 3. 点击任务项触发路由直达 `/next/projects/:id?focusTask=:taskId`；
 * 4. 键盘 Enter/Space 键触发深链下钻；
 * 5. 点击里程碑直达目标项目时间线镜头 `/next/projects/:id?lens=timeline`；
 * 6. 明细卡完整内容校验：项目微标、项目名、标题、排程日期、状态微标、责任人与工期。
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GlobalTimelineHoverCard } from '@/components/next/project-space/GlobalTimelineHoverCard'
import type { GlobalTimelineNode } from '@/lib/next/global-timeline-composer'

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

const sampleTaskNode: GlobalTimelineNode = {
  id: 't-88',
  type: 'task',
  projectId: 42,
  projectName: '火星采样核心舱',
  projectColorToken: 'var(--nx-chart-3)',
  name: '热控回路压力测试',
  date: '2026-09-22',
  startDate: '2026-09-18',
  endDate: '2026-09-22',
  status: 'in_progress',
  statusLabel: '进行中',
  statusTone: '--nx-space-cyan',
  isOverdue: false,
  isAchievedOrCompleted: false,
  progressPercent: 75,
  durationDays: 5,
  assigneeName: '张遥测',
  rawTask: {
    id: 88,
    projectId: 42,
    name: '热控回路压力测试',
    description: null,
    status: 'in_progress',
    priority: 'high',
    taskType: 'task',
    startDate: '2026-09-18',
    endDate: '2026-09-22',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 5,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 75,
    assigneeId: 1,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
  },
}

const sampleMilestoneNode: GlobalTimelineNode = {
  id: 'm-205',
  type: 'milestone',
  projectId: 42,
  projectName: '火星采样核心舱',
  projectColorToken: 'var(--nx-chart-3)',
  name: '总装集成封顶',
  date: '2026-09-30',
  status: 'at_risk',
  statusLabel: '有风险',
  statusTone: '--nx-status-warning',
  isOverdue: false,
  isAchievedOrCompleted: false,
  description: '全舱线缆气密性测试通过',
  rawMilestone: {
    id: 205,
    projectId: 42,
    name: '总装集成封顶',
    description: '全舱线缆气密性测试通过',
    status: 'at_risk',
    storedStatus: 'at_risk',
    plannedDate: '2026-09-30',
    autoCalculated: false,
    displayOrder: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
  },
}

describe('GlobalTimelineHoverCard 悬停交互与明细渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('鼠标悬停激活与移出关闭明细卡（浮层渲染在 body，移出稍后关闭以便移到卡片上）', () => {
    vi.useFakeTimers()
    const { container } = render(
      <GlobalTimelineHoverCard node={sampleTaskNode}>
        <div data-testid="trigger-task">任务触发器</div>
      </GlobalTimelineHoverCard>,
    )

    // 初始状态不展示悬停卡
    expect(document.querySelector('[data-global-timeline-hover-card]')).toBeNull()

    // 鼠标移入
    const wrapper = container.firstChild as HTMLElement
    fireEvent.mouseEnter(wrapper)

    const card = document.querySelector('[data-global-timeline-hover-card]')
    expect(card).toBeInTheDocument()
    expect(card?.getAttribute('data-node-type')).toBe('task')

    // 明细卡字段内容
    expect(screen.getByText('火星采样核心舱')).toBeInTheDocument()
    expect(screen.getByText('热控回路压力测试')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText(/2026-09-18 ~ 2026-09-22/)).toBeInTheDocument()
    expect(screen.getByText('工期 5 天')).toBeInTheDocument()
    expect(screen.getByText('张遥测')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()

    // 鼠标移出
    fireEvent.mouseLeave(wrapper)
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(document.querySelector('[data-global-timeline-hover-card]')).toBeNull()
    vi.useRealTimers()
  })

  test('键盘焦点聚焦激活与失焦关闭（无障碍）', () => {
    render(
      <GlobalTimelineHoverCard node={sampleMilestoneNode}>
        <div data-testid="trigger-milestone">里程碑触发器</div>
      </GlobalTimelineHoverCard>,
    )

    const trigger = screen.getByRole('button')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    // 键盘 Focus
    fireEvent.focus(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-global-timeline-hover-card]')).toBeInTheDocument()
    expect(screen.getByText('总装集成封顶')).toBeInTheDocument()
    expect(screen.getByText('有风险')).toBeInTheDocument()

    // 键盘 Blur
    fireEvent.blur(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-global-timeline-hover-card]')).toBeNull()
  })

  test('点击任务项触发路由直达目标项目并携带 ?focusTask=:taskId', () => {
    render(
      <GlobalTimelineHoverCard node={sampleTaskNode} isOpen>
        <div data-testid="trigger-task">任务触发器</div>
      </GlobalTimelineHoverCard>,
    )

    // 点击触发器
    const trigger = screen.getByRole('button', { name: /热控回路压力测试/ })
    fireEvent.click(trigger)

    expect(routerMock.push).toHaveBeenCalledWith('/next/projects/42?focusTask=88')

    // 点击浮卡内的直达按钮
    routerMock.push.mockClear()
    const drillDownBtn = screen.getByRole('button', { name: /穿透任务详情抽屉/ })
    fireEvent.click(drillDownBtn)
    expect(routerMock.push).toHaveBeenCalledWith('/next/projects/42?focusTask=88')
  })

  test('键盘 Enter 键触发任务直达穿透', () => {
    render(
      <GlobalTimelineHoverCard node={sampleTaskNode}>
        <div data-testid="trigger-task">任务触发器</div>
      </GlobalTimelineHoverCard>,
    )

    const trigger = screen.getByRole('button')
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(routerMock.push).toHaveBeenCalledWith('/next/projects/42?focusTask=88')
  })

  test('点击里程碑直达项目时间线镜头 /next/projects/:id?lens=timeline', () => {
    render(
      <GlobalTimelineHoverCard node={sampleMilestoneNode} isOpen>
        <div data-testid="trigger-milestone">里程碑触发器</div>
      </GlobalTimelineHoverCard>,
    )

    const trigger = screen.getByRole('button', { name: /总装集成封顶/ })
    fireEvent.click(trigger)

    expect(routerMock.push).toHaveBeenCalledWith('/next/projects/42?lens=timeline')

    // 点击浮卡内下钻按钮
    routerMock.push.mockClear()
    const drillDownBtn = screen.getByRole('button', { name: /聚焦项目时间线/ })
    fireEvent.click(drillDownBtn)
    expect(routerMock.push).toHaveBeenCalledWith('/next/projects/42?lens=timeline')
  })

  test('支持外部自定义 onNavigate 回调重载', () => {
    const customNavigate = vi.fn()
    render(
      <GlobalTimelineHoverCard node={sampleTaskNode} onNavigate={customNavigate} isOpen>
        <div>自定义触发器</div>
      </GlobalTimelineHoverCard>,
    )

    const trigger = screen.getByRole('button', { name: /热控回路压力测试/ })
    fireEvent.click(trigger)

    expect(customNavigate).toHaveBeenCalledWith('/next/projects/42?focusTask=88')
    expect(routerMock.push).not.toHaveBeenCalled()
  })
})
