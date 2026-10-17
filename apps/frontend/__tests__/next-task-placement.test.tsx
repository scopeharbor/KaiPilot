/**
 * v3-ui-next-project-space tasks 3.4 —— 放置建任务组件测试（D7 第一方入口）。
 *
 * 覆盖 design D5 / tasks 3.3：
 * - 列内原位插槽展开（点击即展开单行输入，autoFocus）；
 * - 一句话输入回车触发规则式补全 → 待确认预览 + AIMarker「待确认推断 (0.85)」微标；
 * - 就地微调工期（步进）与优先级；
 * - 点击「确认创建」/ Cmd+Ctrl+Enter 显式落库（tasksApi.create + invalidateTaskQueries）；
 * - `Esc` 取消 / 离开未确认 → 零网络请求（RL-01 红线）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Task } from '@/lib/api/tasks'
import { TaskPlacementCard } from '@/components/next/project-space/TaskPlacementCard'
import {
  PLACEMENT_SLOT_BLOCKED_TIP,
  TaskPlacementSlot,
} from '@/components/next/project-space/TaskPlacementSlot'
import { formatDateKey } from '@/lib/next/task-placement-rule'
import { useAuthStore } from '@/stores/auth-store'

const createMock = vi.hoisted(() => ({ create: vi.fn() }))
const invalidateMock = vi.hoisted(() => ({ invalidate: vi.fn() }))

vi.mock('@/lib/api/tasks', () => ({
  tasksApi: { create: createMock.create },
}))

vi.mock('@/lib/task-query-invalidation', () => ({
  invalidateTaskQueries: invalidateMock.invalidate,
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 42,
    projectId: 101,
    name: '梳理 RBAC 权限测试用例',
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: formatDateKey(new Date()),
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 1,
    estimatedHours: 8,
    actualHours: null,
    progressPercent: 0,
    kanbanRank: null,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-09T08:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

beforeEach(() => {
  setAuth(['task:create', 'task:view'])
  createMock.create.mockReset()
  invalidateMock.invalidate.mockReset()
  createMock.create.mockResolvedValue(makeTask())
})

describe('components/next/project-space/TaskPlacementSlot（列内原位插槽 / 任务 3.3）', () => {
  test('非受控：渲染发丝线卡槽，点击展开单行输入并自动聚焦', () => {
    renderWithQuery(<TaskPlacementSlot projectId={101} columnId="pending" />)

    const slot = screen.getByRole('button', { name: '在「待处理」列新建任务' })
    expect(slot).toHaveAttribute('data-placement-slot')
    expect(screen.getByText('在此列新建任务')).toBeInTheDocument()

    fireEvent.click(slot)

    // 列内插槽现在展开 AI 补全卡（一句话 → AI 补成任务卡）
    const input = screen.getByPlaceholderText(/Enter 交给 AI 补全/) as HTMLTextAreaElement
    expect(input).toBeInTheDocument()
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: '在「待处理」列新建任务' })).toBeNull()
  })

  test('受控（W4 全局快捷键 P）：open 属性驱动展开，取消时上报 onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    renderWithQuery(
      <TaskPlacementSlot
        projectId={101}
        columnId="in_progress"
        open={true}
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.getByPlaceholderText(/Enter 交给 AI 补全/)).toBeInTheDocument()

    fireEvent.keyDown(screen.getByPlaceholderText(/Enter 交给 AI 补全/), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('无 task:create 权限：卡槽原位禁用锁定光标，点击零展开零请求（RL-06）', () => {
    setAuth(['project:view', 'task:view'])
    renderWithQuery(<TaskPlacementSlot projectId={101} columnId="pending" />)

    const slot = screen.getByRole('button', { name: '在「待处理」列新建任务' })
    expect(slot).toBeDisabled()
    expect(slot).toHaveAttribute('aria-disabled', 'true')
    expect(slot).toHaveAttribute('title', PLACEMENT_SLOT_BLOCKED_TIP)

    fireEvent.click(slot)
    expect(screen.queryByPlaceholderText(/输入一句话任务/)).toBeNull()
    expect(createMock.create).not.toHaveBeenCalled()
  })
})

describe('components/next/project-space/TaskPlacementCard（放置建任务 / 任务 3.3）', () => {
  test('输入回车触发规则式补全：预览展示名称、继承列状态、工期 1 天与 AIMarker 微标', () => {
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="in_progress" onClose={vi.fn()} />)
    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '梳理 RBAC 权限测试用例' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('梳理 RBAC 权限测试用例')).toBeInTheDocument()
    expect(screen.getByText('进行中 · in_progress')).toBeInTheDocument()
    expect(screen.getByText(`起 ${formatDateKey(new Date())}`)).toBeInTheDocument()
    expect(screen.getByText('1 天')).toBeInTheDocument()

    const marker = screen.getByText('待确认推断 (0.85)')
    expect(marker).toHaveAttribute('data-confidence', '0.85')

    const priority = screen.getByTestId('placement-priority-select') as HTMLSelectElement
    expect(priority.value).toBe('medium')
    // RL-01：仅补全预览，零网络写请求
    expect(createMock.create).not.toHaveBeenCalled()
    // 列状态继承 in_progress
    expect(screen.getByTestId('placement-phase')).toHaveAttribute('data-placement-phase', 'preview')
  })

  test('就地微调：工期步进 +3 天、优先级切换为高', () => {
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="pending" onClose={vi.fn()} />)
    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '回归测试脚本' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('1 天')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('增加工期'))
    fireEvent.click(screen.getByLabelText('增加工期'))
    fireEvent.click(screen.getByLabelText('增加工期'))
    expect(screen.getByText('4 天')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('placement-priority-select'), {
      target: { value: 'high' },
    })
    expect((screen.getByTestId('placement-priority-select') as HTMLSelectElement).value).toBe(
      'high',
    )
    expect(createMock.create).not.toHaveBeenCalled()
  })

  test('点击「确认创建」：tasksApi.create 携带微调字段 + 缓存刷新 + 卡片销毁', async () => {
    const onCreated = vi.fn()
    const onClose = vi.fn()
    // 规则补全卡（列内插槽已换成 AI 补全卡，这里直接测规则卡本身）
    renderWithQuery(
      <TaskPlacementCard
        projectId={101}
        columnId="in_progress"
        onCreated={onCreated}
        onClose={onClose}
      />,
    )

    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '梳理 RBAC 权限测试用例' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.click(screen.getByLabelText('增加工期'))
    fireEvent.change(screen.getByTestId('placement-priority-select'), {
      target: { value: 'high' },
    })

    fireEvent.click(screen.getByRole('button', { name: /确认创建/ }))

    await waitFor(() => {
      expect(createMock.create).toHaveBeenCalledTimes(1)
    })
    expect(createMock.create).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        name: '梳理 RBAC 权限测试用例',
        status: 'in_progress',
        priority: 'high',
        durationDays: 2,
        estimatedHours: 8,
        taskType: 'task',
        startDate: formatDateKey(new Date()),
      }),
    )
    await waitFor(() => {
      expect(invalidateMock.invalidate).toHaveBeenCalledTimes(1)
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }))
    // 创建成功后通知外层收起卡片
    expect(onClose).toHaveBeenCalled()
  })

  test('Cmd/Ctrl+Enter 快捷键显式确认落库（RL-01 唯一写路径）', async () => {
    const onClose = vi.fn()
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="pending" onClose={onClose} />)

    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '验收清单整理' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.keyDown(screen.getByText('验收清单整理'), { key: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(createMock.create).toHaveBeenCalledTimes(1)
    })
    expect(createMock.create).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ name: '验收清单整理', status: 'not_started' }),
    )
  })

  test('Esc 输入态取消：卡片销毁、插槽恢复、零网络请求（RL-01）', () => {
    const onClose = vi.fn()
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="pending" onClose={onClose} />)

    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '临时想法' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createMock.create).not.toHaveBeenCalled()
    expect(invalidateMock.invalidate).not.toHaveBeenCalled()
  })

  test('Esc 预览态取消：待确认草稿即刻销毁，零网络写请求', () => {
    const onClose = vi.fn()
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="pending" onClose={onClose} />)

    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '未完成的草稿' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('待确认推断 (0.85)')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByText('待确认推断 (0.85)'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(createMock.create).not.toHaveBeenCalled()
  })

  test('离开未确认（卸载画布）：绝对零网络写请求（RL-01），草稿不落库', () => {
    const view = renderWithQuery(
      <TaskPlacementCard projectId={101} columnId="in_progress" onClose={vi.fn()} />,
    )
    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '仅输入未确认的任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('待确认推断 (0.85)')).toBeInTheDocument()

    act(() => {
      view.unmount()
    })
    expect(createMock.create).not.toHaveBeenCalled()
    expect(invalidateMock.invalidate).not.toHaveBeenCalled()
  })

  test('创建失败：卡片保持编辑态并高亮错误，不销毁草稿', async () => {
    createMock.create.mockRejectedValue(new Error('服务端校验失败：名称冲突'))
    const onClose = vi.fn()
    renderWithQuery(<TaskPlacementCard projectId={101} columnId="pending" onClose={onClose} />)

    const input = screen.getByPlaceholderText(/输入一句话任务/)
    fireEvent.change(input, { target: { value: '冲突任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /确认创建/ }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('服务端校验失败：名称冲突')
    })
    expect(screen.getByText('待确认推断 (0.85)')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  act(() => {
    createMock.create.mockClear()
  })
})
