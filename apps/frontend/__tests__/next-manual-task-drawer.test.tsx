/**
 * v3-ui-next-project-space tasks 3.6 —— 手动新建任务抽屉测试（D7 第二入口）。
 *
 * 覆盖 design D6 / tasks 3.5：
 * - 全量字段渲染（名称/描述/6 状态/5 优先级/4 任务类型/起止日/工期/工时/负责人/审核人/WBS 节点）；
 * - 客户端必填校验：名称缺失提示「请输入任务名称」，零网络请求；
 * - 成功提交：tasksApi.create 携带全量字段 + invalidateTaskQueries + 抽屉收起重置；
 * - 无 task:create 权限：触发按钮置灰禁用、点击零展开、悬停提示「你没有在该项目中创建任务的权限」（RL-06）。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ManualTaskCreateDrawer } from '@/components/next/project-space/ManualTaskCreateDrawer'
import type { ProjectMember } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
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
    id: 88,
    projectId: 101,
    name: '跨系统联调验收',
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

const MEMBERS: ProjectMember[] = [
  {
    id: 1,
    projectId: 101,
    userId: 11,
    projectRoleId: null,
    isActive: true,
    user: {
      id: 11,
      fullName: '王启明',
      email: 'wang@example.com',
      initials: 'WQM',
      isActive: true,
    },
  },
  {
    id: 2,
    projectId: 101,
    userId: 12,
    projectRoleId: null,
    isActive: true,
    user: { id: 12, fullName: null, email: 'li@example.com', initials: 'L', isActive: true },
  },
]

/** 按组件的 data-manual-task-* 数据属性取表单控件。 */
function byData<T extends HTMLElement>(name: string): T {
  const el = document.querySelector(`[data-manual-task-${name}]`)
  if (el === null) throw new Error(`missing [data-manual-task-${name}] in DOM`)
  return el as T
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

function renderDrawer(
  props: {
    permissions?: string[]
    members?: ProjectMember[]
    useResponse?: { onCreated?: (task: Task) => void }
  } = {},
) {
  const { permissions = ['task:create'], members = MEMBERS, useResponse = {} } = props
  setAuth(permissions)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ManualTaskCreateDrawer projectId={101} members={members} {...useResponse} />
    </QueryClientProvider>,
  )
  return { queryClient, ...utils }
}

beforeEach(() => {
  createMock.create.mockReset()
  invalidateMock.invalidate.mockReset()
  createMock.create.mockResolvedValue(makeTask())
})

describe('components/next/project-space/ManualTaskCreateDrawer（手动新建 / 任务 3.5）', () => {
  test('具备 task:create：触发按钮可用，点击展开全量字段表格单', () => {
    renderDrawer()
    const trigger = screen.getByRole('button', { name: '手动新建任务' })
    expect(trigger).toHaveAttribute('data-manual-task-create-trigger')
    expect(trigger).toBeEnabled()

    fireEvent.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('手动新建任务')).toBeInTheDocument()
    // 默认是「AI 帮我建」（一句话补全），切到「手动填写」看全量字段表单
    expect(screen.getByRole('tab', { name: 'AI 帮我建' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '手动填写' }))

    // 全量字段对齐 CreateTaskInput
    expect(byData('name')).toBeInTheDocument()
    expect(byData('description')).toBeInTheDocument()
    expect(byData('status')).toBeInTheDocument()
    expect(byData('priority')).toBeInTheDocument()
    expect(byData('type')).toBeInTheDocument()
    expect(byData('start-date')).toBeInTheDocument()
    expect(byData('end-date')).toBeInTheDocument()
    expect(byData('duration')).toBeInTheDocument()
    expect(byData('hours')).toBeInTheDocument()
    expect(byData('assignee')).toBeInTheDocument()
    expect(byData('reviewer')).toBeInTheDocument()
    expect(byData('wbs-node')).toBeInTheDocument()

    // 成员数据源渲染负责人/审核人选项
    const assignee = byData<HTMLSelectElement>('assignee')
    expect(assignee).toHaveDisplayValue('未分配')
    expect(within(assignee).getByRole('option', { name: '王启明' })).toBeInTheDocument()
    expect(within(assignee).getByRole('option', { name: 'li@example.com' })).toBeInTheDocument()

    // 默认值与全字段类型选项
    expect(byData<HTMLSelectElement>('status').value).toBe('not_started')
    expect(byData<HTMLSelectElement>('priority').value).toBe('medium')
    expect(byData<HTMLSelectElement>('type').value).toBe('task')
    expect(within(byData('type')).getByRole('option', { name: '里程碑' })).toBeInTheDocument()
    expect(within(byData('status')).getByRole('option', { name: '进行中' })).toBeInTheDocument()
    expect(within(byData('priority')).getByRole('option', { name: '最高' })).toBeInTheDocument()
  })

  test('名称缺失：客户端校验阻断提交并提示「请输入任务名称」，零网络请求', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: '手动新建任务' }))
    // 抽屉默认「AI 帮我建」，这里测完整表单：切到「手动填写」
    fireEvent.click(screen.getByRole('tab', { name: '手动填写' }))

    fireEvent.change(byData('status'), { target: { value: 'in_progress' } })
    fireEvent.click(screen.getByRole('button', { name: /保存创建/ }))

    expect(screen.getByText('请输入任务名称')).toBeInTheDocument()
    expect(createMock.create).not.toHaveBeenCalled()
    expect(invalidateMock.invalidate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('仅空白名称同样被拦截', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: '手动新建任务' }))
    // 抽屉默认「AI 帮我建」，这里测完整表单：切到「手动填写」
    fireEvent.click(screen.getByRole('tab', { name: '手动填写' }))

    fireEvent.change(byData('name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /保存创建/ }))

    expect(screen.getByText('请输入任务名称')).toBeInTheDocument()
    expect(createMock.create).not.toHaveBeenCalled()
  })

  test('完整录入：提交携带全量字段，成功后抽屉收起并刷新看板缓存', async () => {
    const onCreated = vi.fn()
    renderDrawer({ useResponse: { onCreated } })
    fireEvent.click(screen.getByRole('button', { name: '手动新建任务' }))
    // 抽屉默认「AI 帮我建」，这里测完整表单：切到「手动填写」
    fireEvent.click(screen.getByRole('tab', { name: '手动填写' }))

    fireEvent.change(byData('name'), { target: { value: '  跨系统联调验收  ' } })
    fireEvent.change(byData('description'), {
      target: { value: '与 ERP 系统做端到端联调并验收' },
    })
    fireEvent.change(byData('status'), { target: { value: 'in_progress' } })
    fireEvent.change(byData('priority'), { target: { value: 'high' } })
    fireEvent.change(byData('type'), { target: { value: 'deliverable' } })
    fireEvent.change(byData('start-date'), { target: { value: '2026-09-10' } })
    fireEvent.change(byData('end-date'), { target: { value: '2026-09-12' } })
    fireEvent.change(byData('duration'), { target: { value: '3' } })
    fireEvent.change(byData('hours'), { target: { value: '24' } })
    fireEvent.change(byData('assignee'), { target: { value: '11' } })
    fireEvent.change(byData('reviewer'), { target: { value: '12' } })
    fireEvent.change(byData('wbs-node'), { target: { value: '7' } })

    fireEvent.click(screen.getByRole('button', { name: /保存创建/ }))

    await waitFor(() => {
      expect(createMock.create).toHaveBeenCalledTimes(1)
    })
    expect(createMock.create).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        name: '跨系统联调验收',
        description: '与 ERP 系统做端到端联调并验收',
        status: 'in_progress',
        priority: 'high',
        taskType: 'deliverable',
        startDate: '2026-09-10',
        endDate: '2026-09-12',
        durationDays: 3,
        estimatedHours: 24,
        assigneeId: 11,
        reviewerId: 12,
        wbsNodeId: 7,
      }),
    )
    await waitFor(() => {
      expect(invalidateMock.invalidate).toHaveBeenCalledTimes(1)
    })
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 88 }))
    // 成功：抽屉收起
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('无 task:create 权限：按钮置灰禁用、悬停提示无权限文案、点击零展开零请求（RL-06）', () => {
    renderDrawer({ permissions: ['project:view', 'task:view'] })

    const trigger = screen.getByRole('button', { name: '手动新建任务' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    expect(trigger).toHaveAttribute('title', '你没有在该项目中创建任务的权限')

    fireEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createMock.create).not.toHaveBeenCalled()
  })
})
