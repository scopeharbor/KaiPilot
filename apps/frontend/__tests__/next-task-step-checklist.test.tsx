/**
 * 执行步骤清单（2026-09-29）：逐项打勾、进度按比例、首勾转进行中、全勾完询问标记完成。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Task } from '@/lib/api/tasks'
import { readTaskSteps, stepToggleUpdate } from '@/lib/next/task-steps'

const api = vi.hoisted(() => ({ update: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...actual, tasksApi: { ...actual.tasksApi, update: api.update } }
})
vi.mock('@/lib/task-query-invalidation', () => ({ invalidateTaskQueries: api.invalidate }))

import { TaskStepChecklist } from '@/components/next/project-space/TaskStepChecklist'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 9,
    status: 'not_started',
    progressPercent: 0,
    description: '做导出。\n\n**执行步骤**：\n- [ ] 确认字段\n- [ ] 写接口\n- [ ] 自测',
    customFields: {
      execution: {
        steps: ['确认字段', '写接口', '自测'],
        doneCriteria: ['1000 条 < 3 秒'],
        purpose: '管理员要按月导出',
      },
      source: 'kanban-ai-draft',
    },
    ...overrides,
  } as Task
}

describe('步骤清单的计算', () => {
  test('读取结构化步骤；老任务从说明里的 - [x] 读勾选状态', () => {
    expect(readTaskSteps(task()).steps).toEqual(['确认字段', '写接口', '自测'])
    const legacy = readTaskSteps({
      customFields: null,
      description: '- [x] 第一步\n- [ ] 第二步',
    })
    expect(legacy).toMatchObject({ steps: ['第一步', '第二步'], done: [true, false] })
  })

  test('第一次打勾：进度 33%、转进行中、说明里同步成 [x]、保留其它自定义字段', () => {
    const { input, allDone } = stepToggleUpdate(task(), 0)
    expect(input.progressPercent).toBe(33)
    expect(input.status).toBe('in_progress')
    expect(input.description).toContain('- [x] 确认字段')
    expect(input.description).toContain('- [ ] 写接口')
    expect(input.customFields).toMatchObject({
      source: 'kanban-ai-draft',
      execution: { stepsDone: [true, false, false] },
    })
    expect(allDone).toBe(false)
  })

  test('进行中勾完最后一步：到 100% 并转已完成；已完成取消一步退回进行中', () => {
    const current = task({
      status: 'in_progress',
      customFields: {
        execution: { steps: ['确认字段', '写接口', '自测'], stepsDone: [true, true, false] },
      },
    })
    const { input, allDone } = stepToggleUpdate(current, 2)
    expect(input.status).toBe('completed')
    expect(input.progressPercent).toBe(100)
    expect(allDone).toBe(true)
    // 中间步骤：不改状态
    expect(stepToggleUpdate(current, 1).input.status).toBeUndefined()
    const finished = task({
      status: 'completed',
      customFields: {
        execution: { steps: ['确认字段', '写接口', '自测'], stepsDone: [true, true, true] },
      },
    })
    expect(stepToggleUpdate(finished, 0).input).toMatchObject({
      status: 'in_progress',
      progressPercent: 67,
    })
  })
})

describe('任务详情里的步骤清单', () => {
  beforeEach(() => {
    api.update.mockReset().mockResolvedValue({})
    api.invalidate.mockReset()
  })

  function renderList(value: Task, canEdit = true) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskStepChecklist projectId={6} task={value} canEdit={canEdit} />
      </QueryClientProvider>,
    )
  }

  test('打勾立即生效并按顺序保存；勾完最后一步自动转已完成（待处理先开工再完成）', async () => {
    renderList(task())
    for (const name of ['第 1 步：确认字段', '第 2 步：写接口', '第 3 步：自测']) {
      fireEvent.click(screen.getByLabelText(name))
    }
    expect(screen.getByText('执行步骤 · 3/3')).toBeInTheDocument()
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(3))
    expect(api.update.mock.calls[0]![2]).toMatchObject({ status: 'in_progress' })
    expect(api.update.mock.calls[2]![2]).toMatchObject({
      progressPercent: 100,
      status: 'completed',
    })
    expect(screen.getByText(/任务已移到「已完成」/)).toBeInTheDocument()
  })

  test('待处理的任务一次勾完（只有一步）：先开工再完成两次保存', async () => {
    renderList(task({ customFields: { execution: { steps: ['只有一步'] } }, description: null }))
    fireEvent.click(screen.getByLabelText('第 1 步：只有一步'))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2))
    expect(api.update.mock.calls[0]![2]).toMatchObject({ status: 'in_progress' })
    expect(api.update.mock.calls[1]![2]).toEqual({ status: 'completed' })
  })

  test('没有编辑权限：只读，不能打勾', () => {
    renderList(task(), false)
    expect(screen.getByLabelText('第 1 步：确认字段')).toBeDisabled()
  })

  test('没有步骤的任务不显示清单', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskStepChecklist
          projectId={6}
          task={task({ customFields: null, description: '无' })}
          canEdit
        />
      </QueryClientProvider>,
    )
    expect(container.querySelector('[data-task-step-checklist]')).toBeNull()
  })
})
