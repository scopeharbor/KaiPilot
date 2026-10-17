import { DndContext } from '@dnd-kit/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskCard } from '@/components/views/tasks/TaskCard'
import { TaskListTable } from '@/components/views/list/TaskListTable'
import { GanttBarsLayer } from '@/components/views/gantt/core/GanttBarsLayer'
import { GanttLeftColumn } from '@/components/views/gantt/core/GanttLeftColumn'
import { isAgentAssignee, assigneeDisplayName, AGENT_ACTION_LABEL } from '@/types/agent-assignee'
import {
  filterTasksForHumanLoad,
  countHumanParticipants,
  sumHumanEstimatedHours,
  filterMembersForApproverPicker,
} from '@/lib/agent-assignee-utils'
import type { Task } from '@/lib/api/tasks'
import type { GanttRenderTask } from '@/lib/gantt/types'
import { createScale, type GanttScale } from '@/lib/gantt/geometry'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  usePathname: () => '/projects/7/tasks',
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['task:view', 'task:create', 'task:update'],
    can: () => true,
    canAny: () => true,
    canAll: () => true,
  }),
}))

vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => 1,
}))

vi.mock('@/stores/ui-store', () => ({
  useUiStore: (selector: (s: { density: string }) => unknown) =>
    selector({ density: 'comfortable' }),
}))

// ── Fixtures ──────────────────────────────────────────────

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    projectId: 7,
    name: '示例任务',
    description: '描述',
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: '2026-07-08',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: 8,
    actualHours: null,
    progressPercent: 0,
    kanbanRank: 1024,
    assigneeId: 1,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    assignee: { id: 1, fullName: '张三', email: 'zhang@example.com', initials: 'ZS' },
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const agentTask = baseTask({
  id: 2,
  name: 'AI 出方案任务',
  assigneeId: null,
  assignee: undefined,
  assigneeType: 'agent',
  agentAssignee: { id: 100, name: 'CodeGen', initials: 'CG', model: 'gpt-4' },
})

const humanTask = baseTask({
  id: 1,
  assigneeType: 'user',
  assignee: { id: 10, fullName: '李四', email: 'li@example.com', initials: 'LS' },
})

const defaultScale: GanttScale = createScale('day', {
  rowHeight: 32,
  pxPerDay: 40,
})

function makeGanttTask(overrides: Partial<GanttRenderTask> = {}): GanttRenderTask {
  return {
    id: 1,
    name: '示例任务',
    wbsCode: '1',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay: 0,
    durationDays: 5,
    progress: 0.3,
    status: 'in_progress',
    ...overrides,
  }
}

// ── §6.2 结构性区分 ──────────────────────────────────────

describe('§6.2 结构性区分（不仅仅是颜色）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.getState().clear()
  })

  test('TaskCard：agent 负责人显示 Bot 图标 + "AI 出方案" 标签 + 虚线边框', () => {
    render(
      <DndContext>
        <TaskCard task={agentTask} />
      </DndContext>,
    )

    // Bot 图标（lucide-react 渲染为 svg）
    const card = screen.getByRole('button', { name: /AI 负责人/ })
    expect(card).toBeInTheDocument()

    // "AI 出方案" badge 文字
    expect(screen.getByText(AGENT_ACTION_LABEL)).toBeInTheDocument()

    // 虚线边框 class（border-dashed）
    expect(card.className).toContain('border-dashed')

    // aria-label 包含 "AI 负责人"
    expect(card.getAttribute('aria-label')).toContain('AI 负责人')
  })

  test('TaskCard：人类负责人显示 CircleUserRound + 无 AI 标签 + 无虚线边框', () => {
    render(
      <DndContext>
        <TaskCard task={humanTask} />
      </DndContext>,
    )

    const card = screen.getByRole('button', { name: /任务：示例任务/ })
    expect(card).toBeInTheDocument()

    // 无 "AI 出方案" 标签
    expect(screen.queryByText(AGENT_ACTION_LABEL)).not.toBeInTheDocument()

    // 无虚线边框
    expect(card.className).not.toContain('border-dashed')

    // aria-label 不含 "AI 负责人"
    expect(card.getAttribute('aria-label')).not.toContain('AI 负责人')

    // 人类名字显示
    expect(screen.getByText('李四')).toBeInTheDocument()
  })

  test('TaskListTable：agent 负责人列显示 Bot 图标 + agent 名称', () => {
    const onOpen = vi.fn()
    render(
      <TaskListTable
        rows={[agentTask]}
        sort={[]}
        selectedIds={new Set()}
        onSortChange={vi.fn()}
        onToggle={vi.fn()}
        onTogglePage={vi.fn()}
        onOpen={onOpen}
      />,
    )

    // Agent 名称显示
    expect(screen.getByText('CodeGen')).toBeInTheDocument()

    // aria-label 包含 "AI 负责人"
    const cell = screen.getByText('CodeGen').closest('[aria-label]')
    expect(cell?.getAttribute('aria-label')).toContain('AI 负责人')
  })

  test('TaskListTable：人类负责人列正常显示名称', () => {
    render(
      <TaskListTable
        rows={[humanTask]}
        sort={[]}
        selectedIds={new Set()}
        onSortChange={vi.fn()}
        onToggle={vi.fn()}
        onTogglePage={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('李四')).toBeInTheDocument()
  })
})

// ── §6.4 无障碍 ──────────────────────────────────────────

describe('§6.4 无障碍', () => {
  test('TaskCard：agent 负责人具有正确的 aria-label', () => {
    render(
      <DndContext>
        <TaskCard task={agentTask} />
      </DndContext>,
    )
    const card = screen.getByRole('button', { name: /AI 负责人/ })
    expect(card.getAttribute('aria-label')).toContain('AI 负责人')
    expect(card.getAttribute('aria-label')).toContain('AI 出方案任务')
  })

  test('TaskCard：人类负责人 aria-label 不含 AI 标识', () => {
    render(
      <DndContext>
        <TaskCard task={humanTask} />
      </DndContext>,
    )
    const card = screen.getByRole('button', { name: /任务：示例任务/ })
    expect(card.getAttribute('aria-label')).not.toContain('AI')
  })

  test('GanttBarsLayer：agent 任务条具有 "AI 负责人：待确认方案" aria-label', () => {
    const ganttTask = makeGanttTask({
      id: 10,
      name: 'AI 分析任务',
      assignee: { id: 10, name: 'CodeGen', initials: 'CG', assigneeType: 'agent' },
    })

    const visibleRows = [{ index: 0, start: 0 }]

    render(
      <GanttBarsLayer
        scale={defaultScale}
        tasks={[ganttTask]}
        visibleRows={visibleRows}
        visibleDayRange={{ startDay: -5, endDay: 35 }}
        width={1200}
        height={100}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    // SVG listitem 的 aria-label
    const item = screen.getByRole('listitem')
    expect(item.getAttribute('aria-label')).toContain('AI 负责人：待确认方案')
    expect(item.getAttribute('aria-label')).toContain('AI 分析任务')
  })

  test('GanttBarsLayer：人类任务条不含 "AI 负责人" aria-label', () => {
    const ganttTask = makeGanttTask({
      id: 20,
      name: '普通任务',
      assignee: { id: 20, name: '李四', initials: 'LS', assigneeType: 'user' },
    })

    render(
      <GanttBarsLayer
        scale={defaultScale}
        tasks={[ganttTask]}
        visibleRows={[{ index: 0, start: 0 }]}
        visibleDayRange={{ startDay: -5, endDay: 35 }}
        width={1200}
        height={100}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const item = screen.getByRole('listitem')
    expect(item.getAttribute('aria-label')).not.toContain('AI 负责人')
  })

  test('GanttLeftColumn：agent 行具有 Bot 图标和 "AI 负责人" aria-label', () => {
    const ganttTask = makeGanttTask({
      id: 30,
      name: 'AI 设计任务',
      assignee: { id: 30, name: 'CodeGen', initials: 'CG', assigneeType: 'agent' },
    })

    render(
      <GanttLeftColumn
        tasks={[ganttTask]}
        visibleRows={[{ index: 0, start: 0 }]}
        rowHeight={32}
        totalHeight={32}
        showWbsCode={false}
        showAssigneeAvatar={true}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const treeItem = screen.getByRole('treeitem')
    expect(treeItem.getAttribute('aria-label')).toContain('AI 负责人：待确认方案')
  })

  test('GanttLeftColumn：人类行显示首字母头像，不含 AI 标签', () => {
    const ganttTask = makeGanttTask({
      id: 40,
      name: '普通任务',
      assignee: { id: 40, name: '李四', initials: 'LS', assigneeType: 'user' },
    })

    render(
      <GanttLeftColumn
        tasks={[ganttTask]}
        visibleRows={[{ index: 0, start: 0 }]}
        rowHeight={32}
        totalHeight={32}
        showWbsCode={false}
        showAssigneeAvatar={true}
        hoveredTaskId={null}
        selectedTaskId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const treeItem = screen.getByRole('treeitem')
    expect(treeItem.getAttribute('aria-label')).not.toContain('AI 负责人')
    // 人类首字母头像
    expect(screen.getByText('LS')).toBeInTheDocument()
  })
})

// ── 工具函数测试 ──────────────────────────────────────────

describe('agent-assignee-utils', () => {
  const tasks: Task[] = [
    baseTask({ id: 1, assigneeType: 'user', assigneeId: 10, estimatedHours: 8 }),
    baseTask({ id: 2, assigneeType: 'agent', assigneeId: null, estimatedHours: null }),
    baseTask({ id: 3, assigneeType: undefined, assigneeId: 10, estimatedHours: 4 }),
    baseTask({ id: 4, assigneeType: 'user', assigneeId: 20, estimatedHours: 6 }),
  ]

  test('filterTasksForHumanLoad：排除 agent 任务', () => {
    const result = filterTasksForHumanLoad(tasks)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.id)).toEqual([1, 3, 4])
  })

  test('filterTasksForHumanLoad：空数组返回空', () => {
    expect(filterTasksForHumanLoad([])).toHaveLength(0)
  })

  test('countHumanParticipants：统计唯一人类负责人', () => {
    expect(countHumanParticipants(tasks)).toBe(2) // id=10 和 id=20
  })

  test('countHumanParticipants：无任务返回 0', () => {
    expect(countHumanParticipants([])).toBe(0)
  })

  test('sumHumanEstimatedHours：排除 agent 任务的工时', () => {
    const result = sumHumanEstimatedHours(tasks)
    expect(result).toBe(18) // 8 + 4 + 6
  })

  test('sumHumanEstimatedHours：全部 agent 返回 0', () => {
    const allAgent = tasks.filter((t) => t.assigneeType === 'agent')
    expect(sumHumanEstimatedHours(allAgent)).toBe(0)
  })

  test('filterMembersForApproverPicker：排除 agent 成员', () => {
    const members = [
      { id: 1, name: 'Alice', assigneeType: 'user' as const },
      { id: 2, name: 'Bot', assigneeType: 'agent' as const },
      { id: 3, name: 'Bob', assigneeType: undefined },
    ]
    const result = filterMembersForApproverPicker(members)
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.name)).toEqual(['Alice', 'Bob'])
  })
})

// ── 类型守卫与显示名测试 ──────────────────────────────────

describe('类型守卫与显示名', () => {
  test('isAgentAssignee：仅对 agent 返回 true', () => {
    expect(isAgentAssignee('agent')).toBe(true)
    expect(isAgentAssignee('user')).toBe(false)
    expect(isAgentAssignee(undefined)).toBe(false)
    expect(isAgentAssignee(null)).toBe(false)
  })

  test('assigneeDisplayName：agent 与人类返回不同文本', () => {
    const agent = { fullName: null, email: 'bot@ai.com' }
    const human = { fullName: '张三', email: 'zhang@example.com' }

    expect(assigneeDisplayName(human, 'user')).toBe('张三')
    expect(assigneeDisplayName(agent, 'agent')).toBe('bot@ai.com')
    expect(assigneeDisplayName(undefined, undefined)).toBe('未分配')
  })

  test('assigneeDisplayName：agent 带模型后缀', () => {
    const agent = { fullName: 'CodeGen', email: 'bot@ai.com' }
    expect(assigneeDisplayName(agent, 'agent', 'gpt-4')).toBe('CodeGen（gpt-4）')
  })

  test('assigneeDisplayName：agent 无 fullName 时回退 email', () => {
    const agent = { fullName: null, email: 'ai@model.com' }
    expect(assigneeDisplayName(agent, 'agent')).toBe('ai@model.com')
  })

  test('assigneeDisplayName：agent 无 fullName 和 email 时回退 "AI"', () => {
    const agent = { fullName: null, email: undefined }
    expect(assigneeDisplayName(agent, 'agent')).toBe('AI')
  })
})
