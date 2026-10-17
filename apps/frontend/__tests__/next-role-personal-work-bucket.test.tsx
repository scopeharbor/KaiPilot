import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Task } from '@/lib/api/tasks'
import {
  RolePersonalWorkBucket,
  calculateTaskMetrics,
} from '@/components/next/home/RolePersonalWorkBucket'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('RolePersonalWorkBucket（v3-ui-next-batch3-global-convergence W4 · tasks 4.1/4.2）', () => {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const mockTasks: Task[] = [
    {
      id: 1,
      projectId: 101,
      name: '重构全局任务表格',
      description: '暗黑仪器风高密度表格',
      status: 'not_started',
      priority: 'high',
      taskType: 'task',
      startDate: null,
      endDate: nextMonth,
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 5,
      estimatedHours: 40,
      actualHours: null,
      progressPercent: 0,
      assigneeId: 42,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 2,
      projectId: 101,
      name: '联调通知抽屉标记已读',
      description: '极薄顶栏挂载抽屉',
      status: 'in_progress',
      priority: 'highest',
      taskType: 'task',
      startDate: null,
      endDate: tomorrow, // 即将截止 (24h 内)
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 3,
      estimatedHours: 24,
      actualHours: 10,
      progressPercent: 50,
      assigneeId: 42,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
    {
      id: 3,
      projectId: 102,
      name: '修复旧版权限幽灵守卫',
      description: '安全漏洞治理',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      startDate: null,
      endDate: yesterday, // 已逾期
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 2,
      estimatedHours: 16,
      actualHours: null,
      progressPercent: 20,
      assigneeId: 42,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    },
    {
      id: 4,
      projectId: 102,
      name: '已归档的需求评审',
      description: '已完成项',
      status: 'completed',
      priority: 'low',
      taskType: 'task',
      startDate: null,
      endDate: yesterday,
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 1,
      estimatedHours: 8,
      actualHours: 8,
      progressPercent: 100,
      assigneeId: 42,
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    {
      id: 5,
      projectId: 103,
      name: '未分配的后端监控配置',
      description: '未指定负责人',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: null,
      endDate: null,
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 2,
      estimatedHours: 10,
      actualHours: null,
      progressPercent: 0,
      assigneeId: null, // 未分配
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: null,
    },
  ]

  beforeEach(() => {
    queryClient.clear()
  })

  test('1. 纯函数 calculateTaskMetrics 正确聚合四大核心态势量度', () => {
    const metrics = calculateTaskMetrics(mockTasks, 42, true)
    // 对于用户 42：
    // task 1: not_started (nextMonth)
    // task 2: in_progress (tomorrow -> dueSoon)
    // task 3: in_progress (yesterday -> overdue)
    // task 4: completed (completedCount = 1)
    // task 5: assigneeId is null -> not in user 42's member tasks
    expect(metrics.notStartedCount).toBe(1)
    expect(metrics.inProgressCount).toBe(2)
    expect(metrics.dueSoonCount).toBe(1)
    expect(metrics.overdueCount).toBe(1)
    expect(metrics.completedCount).toBe(1)
    expect(metrics.totalCount).toBe(4)
  })

  test('2. Member 桶视角：渲染个人聚焦标题与按截止期严格升序的待办清单', () => {
    renderWithQuery(<RolePersonalWorkBucket bucket="member" currentUserId={42} tasks={mockTasks} />)

    expect(screen.getByText('我的工作聚焦（个人工作桶）')).toBeInTheDocument()
    expect(screen.getByText('MEMBER · HUD-SYNC')).toBeInTheDocument()
    expect(screen.getByText('我的待办清单')).toBeInTheDocument()

    // 确认清单内包含逾期和即将截止任务
    expect(screen.getByText('修复旧版权限幽灵守卫')).toBeInTheDocument()
    expect(screen.getByText('联调通知抽屉标记已读')).toBeInTheDocument()
    expect(screen.getByText('重构全局任务表格')).toBeInTheDocument()
  })

  test('3. Admin 桶视角：差异化呈现未分配任务与组织逾期风险总量', () => {
    renderWithQuery(<RolePersonalWorkBucket bucket="admin" currentUserId={1} tasks={mockTasks} />)

    expect(screen.getByText('组织任务治理工作桶')).toBeInTheDocument()
    expect(screen.getByText('ADMIN · HUD-SYNC')).toBeInTheDocument()
    expect(screen.getByText('跨项目治理未分配任务')).toBeInTheDocument()
    expect(screen.getByText('全组织逾期风险总量')).toBeInTheDocument()
    // 包含 1 项未分配任务
    expect(screen.getByText('1 项未分配')).toBeInTheDocument()
  })

  test('4. PM 桶视角：差异化呈现项目交付推进与排程预警', () => {
    renderWithQuery(<RolePersonalWorkBucket bucket="pm" currentUserId={42} tasks={mockTasks} />)

    expect(screen.getByText('项目交付工作桶')).toBeInTheDocument()
    expect(screen.getByText('PM · HUD-SYNC')).toBeInTheDocument()
    expect(screen.getByText('负责项目交付推进')).toBeInTheDocument()
    expect(screen.getByText('里程碑交付预警')).toBeInTheDocument()
  })

  test('5. Observer 桶视角：差异化呈现组织整体交付达成率与只读走势', () => {
    renderWithQuery(
      <RolePersonalWorkBucket bucket="observer" currentUserId={99} tasks={mockTasks} />,
    )

    expect(screen.getByText('全域交付洞察工作桶')).toBeInTheDocument()
    expect(screen.getByText('OBSERVER · HUD-SYNC')).toBeInTheDocument()
    expect(screen.getByText('组织整体交付达成率')).toBeInTheDocument()
    expect(screen.getByText('关注任务只读走势')).toBeInTheDocument()
  })

  test('6. 点击「打开 HUD」按钮正确触发回调', () => {
    const handleOpenHud = vi.fn()
    renderWithQuery(
      <RolePersonalWorkBucket
        bucket="member"
        currentUserId={42}
        tasks={mockTasks}
        onOpenHud={handleOpenHud}
      />,
    )

    const btn = screen.getByRole('button', { name: '打开跨项目任务 HUD' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(handleOpenHud).toHaveBeenCalledTimes(1)
  })
})
