/**
 * v3-ui-next-project-space tasks 2.2 —— 工作面任务卡片（D18 方案 A 仪器感卡片）单元测试。
 *
 * 覆盖：
 * - 卡片全字段渲染：任务名 / 优先级双通道微标（色 + 中文文案）/ 负责人缩写圆点与姓名 /
 *   起止日期徽章 / 工期天数 / 底部发丝进度条；
 * - 优先级色板映射（high → 琥珀 --nx-status-warning，highest → 冷红 --nx-status-danger，
 *   lowest/low/medium 中性色）；
 * - 「其他」列任务状态双通道徽章（如 blocked → 阻塞）；
 * - 只读锁定态：拖拽属性剥离、锁定光标、原生 Tooltip「你没有编辑此任务的权限」；
 * - 可拖拽属性绑定：整卡即拖动手柄（role=button + tabindex + data-task-id）；
 * - WorkspaceTaskCardContent（DragOverlay 悬浮副本）纯展示且不注册拖拽。
 */
import { DndContext } from '@dnd-kit/core'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  TASK_PRIORITY_LABELS,
  WorkspaceTaskCard,
  WorkspaceTaskCardContent,
} from '@/components/next/project-space/WorkspaceTaskCard'
import type { Task, TaskPriority } from '@/lib/api/tasks'

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

function renderSortableCard(
  task: Task,
  props: { disabled?: boolean; onOpen?: (id: number) => void } = {},
) {
  return render(
    <DndContext>
      <WorkspaceTaskCard task={task} {...props} />
    </DndContext>,
  )
}

describe('components/next/project-space/WorkspaceTaskCard', () => {
  test('渲染仪器感卡片全字段：任务名/优先级微标/负责人/日期/工期/进度条', () => {
    renderSortableCard(makeTask())

    expect(screen.getByText('数据库索引优化')).toBeInTheDocument()

    // 优先级双通道：中文文案 + 琥珀警告令牌色
    const priority = screen.getByText('高')
    expect(priority).toHaveAttribute('data-card-priority')
    expect(priority.className).toContain('--nx-status-warning')

    // 负责人：缩写圆点 + 姓名
    const initials = screen.getByText('PM')
    expect(initials).toHaveAttribute('data-card-initials')
    expect(screen.getByText('项目经理')).toBeInTheDocument()

    // 日期徽章（MM-DD 确定性格式）与工期天数
    expect(screen.getByText('09-01 – 09-08')).toBeInTheDocument()
    expect(screen.getByText('2 天')).toBeInTheDocument()

    // 底部发丝进度条（role=progressbar 双通道：aria 值 + 填充宽度）
    const progress = screen.getByRole('progressbar', { name: '任务进度 45%' })
    expect(progress).toHaveAttribute('aria-valuenow', '45')
    const fill = progress.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('45%')
  })

  test('优先级色板双通道映射：high/highest 警示色、低档中性色且文案齐全', () => {
    const expectations: Array<[TaskPriority, string, string | null]> = [
      ['lowest', '最低', null],
      ['low', '低', null],
      ['medium', '中', null],
      ['high', '高', '--nx-status-warning'],
      ['highest', '最高', '--nx-status-danger'],
    ]
    for (const [priority, label, tone] of expectations) {
      const { unmount } = renderSortableCard(makeTask({ priority }))
      const badge = screen.getByText(label)
      expect(badge).toHaveAttribute('data-card-priority')
      expect(TASK_PRIORITY_LABELS[priority]).toBe(label)
      if (tone) {
        expect(badge.className).toContain(tone)
      } else {
        expect(badge.className).not.toContain('--nx-status-warning')
        expect(badge.className).not.toContain('--nx-status-danger')
      }
      unmount()
    }
  })

  test('「其他」列任务附带状态双通道徽章（blocked → 阻塞）', () => {
    renderSortableCard(makeTask({ status: 'blocked' }))
    const statusBadge = screen.getByText('阻塞')
    expect(statusBadge).toHaveAttribute('data-card-status')
  })

  test('只读锁定态：拖拽属性剥离、锁定光标与「没有编辑权限」Tooltip（RL-06）', () => {
    renderSortableCard(makeTask(), { disabled: true })

    // 禁用时整卡不再注册为 button 拖拽手柄
    expect(screen.queryByRole('button', { name: '任务：数据库索引优化' })).not.toBeInTheDocument()
    const card = document.querySelector('[data-workspace-task-card]') as HTMLElement
    expect(card).toHaveAttribute('aria-disabled', 'true')
    expect(card.className).toContain('cursor-not-allowed')
    expect(card).toHaveAttribute('title', '你没有编辑此任务的权限')

    const lock = document.querySelector('[data-card-lock]') as HTMLElement
    expect(lock).toBeInTheDocument()
  })

  test('可拖拽属性绑定：整卡即拖动手柄（role=button + tabindex + 任务标识）', () => {
    renderSortableCard(makeTask())

    const handle = screen.getByRole('button', { name: '任务：数据库索引优化' })
    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).toHaveAttribute('data-task-id', '101')
    expect(handle).toHaveAttribute('data-workspace-task-card')
    expect(handle).not.toHaveAttribute('aria-disabled')
  })
})

describe('components/next/project-space/WorkspaceTaskCardContent（DragOverlay 悬浮副本）', () => {
  test('纯展示不注册拖拽，字段与主卡片一致', () => {
    render(<WorkspaceTaskCardContent task={makeTask()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('数据库索引优化')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '任务进度 45%' })).toBeInTheDocument()
  })
})
describe('拖拽保存中的状态（2026-09-29 改为排队保存）', () => {
  test('其它卡照常可拖；正在保存的卡显示「保存中…」，也仍可拖', () => {
    render(
      <DndContext>
        <WorkspaceTaskCard task={makeTask({ id: 1 })} />
        <WorkspaceTaskCard task={makeTask({ id: 2, name: '正在保存的任务' })} saving />
      </DndContext>,
    )
    const cards = [1, 2].map(
      (id) => document.querySelector(`[aria-label^="任务："][data-task-id="${id}"]`) as HTMLElement,
    )
    expect(cards[0]).toHaveAttribute('title', '按住拖动，点击查看详情')
    expect(cards[0]).not.toHaveAttribute('aria-disabled')
    expect(cards[1]).toHaveAttribute('title', '正在保存这次移动…')
    expect(cards[1]).not.toHaveAttribute('aria-disabled')
    expect(screen.getByText('保存中…')).toBeInTheDocument()
  })
})
