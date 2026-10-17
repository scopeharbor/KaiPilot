import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Task } from '@/lib/api/tasks'
import type { Project } from '@/lib/api/projects'
import { CrossProjectTasksHudLens } from '@/components/next/tasks/CrossProjectTasksHudLens'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CrossProjectTasksHudLens（v3-ui-next-batch3-global-convergence W4 · tasks 4.3/4.4）', () => {
  const mockProjects: Project[] = [
    {
      id: 101,
      organizationId: 1,
      name: '北极星重构项目',
      code: 'NS-01',
      description: null,
      category: null,
      status: 'active',
      priority: 'high',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      budgetCents: 10000000,
      currency: 'CNY',
      progressPercent: 45,
      healthStatus: 'healthy',
      settings: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 102,
      organizationId: 1,
      name: '深空核心引擎',
      code: 'DEEP-02',
      description: null,
      category: null,
      status: 'active',
      priority: 'critical',
      startDate: '2026-02-01',
      endDate: '2026-11-30',
      budgetCents: 20000000,
      currency: 'CNY',
      progressPercent: 60,
      healthStatus: 'warning',
      settings: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  ]

  const mockTasks: Task[] = [
    {
      id: 11,
      projectId: 101,
      name: 'Alpha 任务 A：数据库索引优化',
      description: '优化查询性能',
      status: 'not_started',
      priority: 'low',
      taskType: 'task',
      startDate: null,
      endDate: '2026-10-15',
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 3,
      estimatedHours: 24,
      actualHours: null,
      progressPercent: 0,
      assigneeId: 1,
      assignee: { id: 1, fullName: '张工', email: 'zhang@example.com', initials: 'ZG' },
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
      id: 12,
      projectId: 101,
      name: 'Beta 任务 B：构建 HUD 镜头前端组件',
      description: '32px/36px 发丝线紧凑表格',
      status: 'in_progress',
      priority: 'highest',
      taskType: 'task',
      startDate: null,
      endDate: '2026-09-20',
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 2,
      estimatedHours: 16,
      actualHours: null,
      progressPercent: 60,
      assigneeId: 2,
      assigneeType: 'agent',
      agentAssignee: {
        id: 999,
        name: '智能排程助手',
        initials: 'AI',
        model: 'gemini-3.8-flash',
      },
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
      id: 13,
      projectId: 102,
      name: 'Gamma 任务 C：解决并发锁死问题',
      description: '排查死锁',
      status: 'blocked',
      priority: 'high',
      taskType: 'task',
      startDate: null,
      endDate: '2026-08-01', // 已逾期
      actualStartDate: null,
      actualEndDate: null,
      durationDays: 4,
      estimatedHours: 32,
      actualHours: null,
      progressPercent: 20,
      assigneeId: 3,
      assignee: { id: 3, fullName: '李工', email: 'li@example.com', initials: 'LG' },
      reviewerId: null,
      parentTaskId: null,
      wbsNodeId: null,
      milestoneId: null,
      costEstimateCents: null,
      costActualCents: null,
      customFields: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    },
  ]

  beforeEach(() => {
    pushMock.mockClear()
    queryClient.clear()
  })

  test('1. 高密度表格首屏加载：正常呈现标题、项目代码、状态徽标与 Agent 标识', () => {
    renderWithQuery(
      <CrossProjectTasksHudLens isOpen={true} tasks={mockTasks} projects={mockProjects} />,
    )

    expect(screen.getByRole('heading', { name: '跨项目任务 HUD 镜头' })).toBeInTheDocument()
    expect(screen.getByText('3 项聚焦')).toBeInTheDocument()

    // 任务条目
    expect(screen.getByText('Alpha 任务 A：数据库索引优化')).toBeInTheDocument()
    expect(screen.getByText('Beta 任务 B：构建 HUD 镜头前端组件')).toBeInTheDocument()
    expect(screen.getByText('Gamma 任务 C：解决并发锁死问题')).toBeInTheDocument()

    // 项目与代码
    expect(screen.getAllByText('NS-01').length).toBe(2)
    expect(screen.getByText('DEEP-02')).toBeInTheDocument()

    // AI Agent 标识
    expect(screen.getByText('智能排程助手')).toBeInTheDocument()
  })

  test('2. 按项目过滤：选择特定项目后只呈现所属任务', () => {
    renderWithQuery(
      <CrossProjectTasksHudLens isOpen={true} tasks={mockTasks} projects={mockProjects} />,
    )

    const projectSelect = screen.getByLabelText('按项目过滤')
    fireEvent.change(projectSelect, { target: { value: '102' } })

    // 仅项目 102 的 Gamma 任务应该展示
    expect(screen.getByText('Gamma 任务 C：解决并发锁死问题')).toBeInTheDocument()
    expect(screen.queryByText('Alpha 任务 A：数据库索引优化')).not.toBeInTheDocument()
    expect(screen.queryByText('Beta 任务 B：构建 HUD 镜头前端组件')).not.toBeInTheDocument()
    expect(screen.getByText('1 项聚焦')).toBeInTheDocument()
  })

  test('3. 按状态过滤：选择进行中状态过滤任务', () => {
    renderWithQuery(
      <CrossProjectTasksHudLens isOpen={true} tasks={mockTasks} projects={mockProjects} />,
    )

    const statusSelect = screen.getByLabelText('按状态过滤')
    fireEvent.change(statusSelect, { target: { value: 'in_progress' } })

    // 仅 Beta 任务（in_progress）
    expect(screen.getByText('Beta 任务 B：构建 HUD 镜头前端组件')).toBeInTheDocument()
    expect(screen.queryByText('Alpha 任务 A：数据库索引优化')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma 任务 C：解决并发锁死问题')).not.toBeInTheDocument()
    expect(screen.getByText('1 项聚焦')).toBeInTheDocument()
  })

  test('4. 表头排序：点击优先级表头可切换排序方向', () => {
    renderWithQuery(
      <CrossProjectTasksHudLens isOpen={true} tasks={mockTasks} projects={mockProjects} />,
    )

    const priorityHeader = screen.getByText('优先级')
    // 第一次点击升序（lowest -> highest）
    fireEvent.click(priorityHeader)

    const rows = screen.getAllByRole('row')
    // 表头包含 1 行，数据包含 3 行
    expect(rows.length).toBe(4)

    // 第二次点击降序（highest -> lowest）
    fireEvent.click(priorityHeader)
    const taskRows = document.querySelectorAll('[data-task-row]')
    expect(taskRows.length).toBe(3)
    // 降序时最高优的 Beta 任务应在首行
    expect(taskRows[0]?.textContent).toContain('Beta 任务 B')
  })

  test('5. 深链穿透：点击任务行调用 router.push 并携带 ?focusTask=，同时关闭镜头', () => {
    const handleClose = vi.fn()
    renderWithQuery(
      <CrossProjectTasksHudLens
        isOpen={true}
        tasks={mockTasks}
        projects={mockProjects}
        onClose={handleClose}
      />,
    )

    const row = screen.getByText('Alpha 任务 A：数据库索引优化').closest('tr')
    expect(row).toBeInTheDocument()

    fireEvent.click(row!)
    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/101?focusTask=11')
  })

  test('6. 键盘 Esc 键按下时平滑关闭镜头', () => {
    const handleClose = vi.fn()
    renderWithQuery(
      <CrossProjectTasksHudLens
        isOpen={true}
        tasks={mockTasks}
        projects={mockProjects}
        onClose={handleClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
