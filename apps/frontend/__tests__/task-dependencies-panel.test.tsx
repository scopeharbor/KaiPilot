import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskDependencyGroups } from '@/lib/api/dependencies'
import { tasksApi } from '@/lib/api/tasks'

const create = vi.fn()
const remove = vi.fn()
const refetch = vi.fn()
let groups: TaskDependencyGroups
let loading = false
let failed = false

vi.mock('@/hooks/use-task-dependencies', () => ({
  useTaskDependencies: () => ({
    data: groups,
    isLoading: loading,
    isError: failed,
    refetch,
  }),
  useCreateDependency: () => ({
    mutate: create,
    isPending: false,
  }),
  useDeleteDependency: () => ({
    mutate: remove,
    isPending: false,
    variables: undefined,
  }),
}))

function renderPanel(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return import('@/components/tasks/TaskDependenciesPanel').then(({ TaskDependenciesPanel }) =>
    render(
      <QueryClientProvider client={client}>
        <TaskDependenciesPanel projectId={7} taskId={2} canEdit={canEdit} />
      </QueryClientProvider>,
    ),
  )
}

describe('TaskDependenciesPanel', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    loading = false
    failed = false
    create.mockReset()
    remove.mockReset()
    refetch.mockReset()
    groups = {
      predecessors: [
        {
          id: 10,
          predecessorId: 1,
          successorId: 2,
          type: 'fs',
          lagDays: -2,
          predecessor: {
            id: 1,
            name: '需求确认',
            status: 'completed',
            startDate: null,
            endDate: null,
          },
          successor: {
            id: 2,
            name: '开发',
            status: 'not_started',
            startDate: null,
            endDate: null,
          },
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: null,
        },
      ],
      successors: [],
    }
    vi.spyOn(tasksApi, 'list').mockResolvedValue({
      data: [
        {
          id: 3,
          projectId: 7,
          name: '测试',
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
          createdAt: '2026-07-05T00:00:00.000Z',
          updatedAt: null,
        },
      ],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    })
  })

  it('显示前置/后续分组、类型与负提前量', async () => {
    await renderPanel()
    expect(screen.getByText('依赖关系')).toBeInTheDocument()
    expect(screen.getByText('需求确认')).toBeInTheDocument()
    expect(screen.getByText('完成 → 开始 · -2 天')).toBeInTheDocument()
    expect(screen.getByText('暂无后续任务')).toBeInTheDocument()
  })

  it('删除依赖需二次确认，确认后调用 remove（携 onSuccess 回调）', async () => {
    await renderPanel()
    fireEvent.click(screen.getByLabelText('删除与需求确认的依赖'))
    // 第一步只展示确认，尚未删除。
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByText('删除后日期不变')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('确认删除与需求确认的依赖'))
    expect(remove).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('取消删除不触发 remove', async () => {
    await renderPanel()
    fireEvent.click(screen.getByLabelText('删除与需求确认的依赖'))
    fireEvent.click(screen.getByLabelText('取消删除依赖'))
    expect(remove).not.toHaveBeenCalled()
    // 回到初始删除按钮。
    expect(screen.getByLabelText('删除与需求确认的依赖')).toBeInTheDocument()
  })

  it('选择候选任务后可添加依赖', async () => {
    await renderPanel()
    await waitFor(() => expect(tasksApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox', { name: '选择前置任务' }))
    fireEvent.click(await screen.findByRole('option', { name: '测试' }))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(create).toHaveBeenCalledWith(
      { predecessorId: 3, type: 'fs', lagDays: 0 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('只读模式隐藏添加与删除控件但保留分组', async () => {
    await renderPanel(false)
    expect(screen.getByText('只读')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('删除与需求确认的依赖')).not.toBeInTheDocument()
    expect(screen.getByText('需求确认')).toBeInTheDocument()
  })
})
