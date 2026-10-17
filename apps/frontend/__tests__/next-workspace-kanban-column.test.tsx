/**
 * v3-ui-next-project-space tasks 2.4 —— 工作面看板单列（WorkspaceKanbanColumn）单元测试。
 *
 * 覆盖：
 * - 四列定义投影：待处理/进行中/已完成/其他列头与列身份属性；
 * - 列头计数徽章（服务端 meta.total 优先、本地行数兜底）；
 * - 任务卡片渲染与空列占位「可将任务拖到这里」；
 * - 列内原位放置任务插槽渲染（placementSlot 契约）；
 * - loading 发丝骨架与「本列加载失败」中性错误态；
 * - 多页数据时分页控制器（上一页/下一页与页号指示，边界禁用）。
 */
import { DndContext } from '@dnd-kit/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { WorkspaceKanbanColumn } from '@/components/next/project-space/WorkspaceKanbanColumn'
import { KANBAN_COLUMNS, type KanbanColumn } from '@/lib/api/kanban'
import type { PaginatedTasks, Task } from '@/lib/api/tasks'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 101,
    projectId: 7,
    name: '数据库索引优化',
    description: null,
    status: 'not_started',
    priority: 'high',
    taskType: 'task',
    startDate: '2026-09-01',
    endDate: '2026-09-08',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 2,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 45,
    kanbanRank: 1024,
    assigneeId: 1,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    assignee: { id: 1, fullName: '项目经理', email: 'pm@example.com', initials: 'PM' },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const COLUMN_DEFS = new Map(KANBAN_COLUMNS.map((column) => [column.id, column] as const))

function columnDef(id: KanbanColumn) {
  return COLUMN_DEFS.get(id)!
}

function queryOf(total: number, page = 1, totalPages = 1): PaginatedTasks {
  return { data: [], meta: { total, page, perPage: 25, totalPages } }
}

function renderColumn(props: Partial<Parameters<typeof WorkspaceKanbanColumn>[0]> = {}) {
  return render(
    <DndContext>
      <WorkspaceKanbanColumn column={columnDef('pending')} rows={[]} {...props} />
    </DndContext>,
  )
}

describe('components/next/project-space/WorkspaceKanbanColumn', () => {
  test('四列状态投影：列头文案与列身份属性正确', () => {
    const { unmount } = renderColumn({ column: columnDef('pending') })
    expect(screen.getByRole('heading', { name: '待处理' })).toBeInTheDocument()
    expect(screen.getByText('待处理').closest('section')).toHaveAttribute(
      'data-kanban-column',
      'pending',
    )
    unmount()

    renderColumn({ column: columnDef('other') })
    expect(screen.getByRole('heading', { name: '其他' })).toBeInTheDocument()
    expect(screen.getByText('其他').closest('section')).toHaveAttribute(
      'data-kanban-column',
      'other',
    )
  })

  test('列头计数徽章：服务端 meta.total 优先、本地行数兜底', () => {
    const { unmount } = renderColumn({
      column: columnDef('in_progress'),
      rows: [makeTask({ id: 1, name: 'A' }), makeTask({ id: 2, name: 'B' })],
      query: queryOf(7),
    })
    expect(screen.getByText('7')).toBeInTheDocument()
    unmount()

    // 无服务端查询结果时以本地行数兜底
    renderColumn({ column: columnDef('completed'), rows: [makeTask({ id: 3, name: 'C' })] })
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  test('渲染任务卡片并支持点击打开详情', () => {
    const onOpen = vi.fn()
    renderColumn({
      rows: [makeTask({ id: 11, name: '梳理 RBAC 权限测试用例' })],
      onOpen,
      canMove: () => true,
    })
    fireEvent.click(screen.getByRole('button', { name: '任务：梳理 RBAC 权限测试用例' }))
    expect(onOpen).toHaveBeenCalledWith(11)
  })

  test('空列呈现中性占位「可将任务拖到这里」', () => {
    renderColumn({ column: columnDef('pending'), rows: [], query: queryOf(0) })
    expect(screen.getByText('可将任务拖到这里')).toBeInTheDocument()
    expect(screen.getByText('可将任务拖到这里').closest('div')).toHaveAttribute('data-kanban-empty')
  })

  test('列内原位放置任务插槽按契约渲染', () => {
    renderColumn({
      placementSlot: <button type="button">+ 放置任务到此列</button>,
    })
    expect(screen.getByRole('button', { name: '+ 放置任务到此列' })).toBeInTheDocument()
  })

  test('loading 呈现发丝骨架，error 呈现中性失败文案', () => {
    const { unmount } = renderColumn({ loading: true })
    expect(document.querySelectorAll('[data-kanban-skeleton]')).toHaveLength(3)
    unmount()

    renderColumn({ error: true })
    expect(screen.getByText('本列加载失败')).toBeInTheDocument()
  })

  test('多页数据时分页控制器：页号指示、边界禁用与翻页回调', () => {
    const onPage = vi.fn()
    renderColumn({
      column: columnDef('pending'),
      rows: [makeTask({ name: '分页任务' })],
      query: queryOf(30, 2, 2),
      page: 2,
      onPage,
    })

    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    const prev = screen.getByRole('button', { name: '待处理上一页' })
    const next = screen.getByRole('button', { name: '待处理下一页' })
    expect(prev).toBeEnabled()
    expect(next).toBeDisabled()

    fireEvent.click(prev)
    expect(onPage).toHaveBeenCalledWith(1)
  })
})
