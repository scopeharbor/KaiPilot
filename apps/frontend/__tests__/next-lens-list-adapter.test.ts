/**
 * v3-ui-next-remaining-lenses W2（tasks 2.2）—— 列表数据适配与多维参数纯函数单测。
 *
 * 覆盖（tasks 2.1 契约 + design「列表数据适配纯函数」）：
 * - 6 状态语义发丝令牌 / 中文文案匹配（--nx-* 令牌，零硬编码色值）；
 * - 5 档优先级徽章令牌 / 文案；
 * - 人类负责人（缩写）与 AI Agent 负责人微标分支（isAgentAssignee /
 *   assigneeType === 'agent'）；
 * - 空起止日期兜底、工期推算、进度钳制、编号与层级标签派生；
 * - 排序（正序 / 倒序 / 默认序轮转）、筛选、分页参数拼接与 URL 序列化。
 */
import { describe, expect, test } from 'vitest'
import type { ProjectMember } from '@/lib/api/projects'
import type { Task, TaskListFilters, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import {
  buildMemberAssigneeIndex,
  formatTaskRows,
  LIST_DATE_SPAN_SEPARATOR,
  LIST_EMPTY_PLACEHOLDER,
  LIST_PRIORITY_LABEL,
  LIST_PRIORITY_TOKEN,
  LIST_STATUS_HAIRLINE_TOKEN,
  LIST_STATUS_LABEL,
  nextSortState,
  serializeTaskListFilters,
  toSortParam,
  toTaskListFilters,
  withMemberAssignees,
  type FormattedTaskRow,
  type ListSortState,
} from '@/lib/next/lenses-list-adapter'

const PROJECT_ID = 7

function taskOf(overrides: Partial<Task>): Task {
  return {
    id: 1,
    projectId: PROJECT_ID,
    name: '任务',
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
    assigneeType: 'user',
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const STATUS_EXPECTED_TOKEN: Record<TaskStatus, string> = {
  not_started: '--nx-text-muted',
  in_progress: '--nx-space-cyan',
  completed: '--nx-status-success',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

describe('formatTaskRows：状态 / 优先级 / 负责人徽章派生', () => {
  test('6 状态命中语义发丝线令牌与中文文案（与全平台共享文案一致）', () => {
    const statuses: TaskStatus[] = [
      'not_started',
      'in_progress',
      'completed',
      'blocked',
      'on_hold',
      'cancelled',
    ]
    const rows = formatTaskRows(statuses.map((status, index) => taskOf({ id: index + 1, status })))
    expect(rows).toHaveLength(6)
    rows.forEach((row, index) => {
      const status = statuses[index] as TaskStatus
      expect(row.status).toBe(status)
      expect(row.statusToken).toBe(STATUS_EXPECTED_TOKEN[status])
      expect(row.statusLabel).toBe(LIST_STATUS_LABEL[status])
      expect(row.statusToken).toBe(LIST_STATUS_HAIRLINE_TOKEN[status])
      expect(row.statusToken).toMatch(/^--nx-/)
    })
  })

  test('5 档优先级命中徽章令牌与最低/低/中/高/最高文案', () => {
    const priorities: TaskPriority[] = ['lowest', 'low', 'medium', 'high', 'highest']
    const rows = formatTaskRows(
      priorities.map((priority, index) => taskOf({ id: index + 1, priority })),
    )
    rows.forEach((row, index) => {
      const priority = priorities[index] as TaskPriority
      expect(row.priority).toBe(priority)
      expect(row.priorityToken).toBe(LIST_PRIORITY_TOKEN[priority])
      expect(row.priorityLabel).toBe(LIST_PRIORITY_LABEL[priority])
      expect(LIST_PRIORITY_LABEL[priority]).toMatch(/^[最低高中紧急]+$/)
    })
    // 5 档文案恰为 spec 顺序：最低 / 低 / 中 / 高 / 最高
    expect(priorities.map((p) => LIST_PRIORITY_LABEL[p])).toEqual([
      '最低',
      '低',
      '中',
      '高',
      '最高',
    ])
  })

  test('人类负责人：内嵌 assignee 缩写与姓名直取', () => {
    const row = formatTaskRows([
      taskOf({
        id: 11,
        assigneeId: 9,
        assigneeType: 'user',
        assignee: { id: 9, fullName: '张伟', email: 'zhang@example.com', initials: 'ZW' },
      }),
    ])[0] as FormattedTaskRow
    expect(row.isAgentAssignee).toBe(false)
    expect(row.assigneeName).toBe('张伟')
    expect(row.assigneeInitials).toBe('ZW')
  })

  test('AI Agent 负责人：assigneeType === "agent" 触发专属徽章分支（agentAssignee 缺省回退 AI）', () => {
    const withAgent = formatTaskRows([
      taskOf({
        id: 12,
        assigneeId: 99,
        assigneeType: 'agent',
        agentAssignee: { id: 99, name: 'DeepSeek-R1', initials: 'DS', model: 'deepseek-r1' },
      }),
    ])[0] as FormattedTaskRow
    expect(withAgent.isAgentAssignee).toBe(true)
    expect(withAgent.assigneeName).toBe('DeepSeek-R1')
    expect(withAgent.assigneeInitials).toBe('DS')

    // 接口不内嵌 agentAssignee（后端现状）时确定性回退 'AI'
    const fallback = formatTaskRows([
      taskOf({ id: 13, assigneeId: 99, assigneeType: 'agent' }),
    ])[0] as FormattedTaskRow
    expect(fallback.isAgentAssignee).toBe(true)
    expect(fallback.assigneeName).toBe('AI')
    expect(fallback.assigneeInitials).toBe('AI')
  })

  test('assigneeId 为 null 的真未分配才显示「未分配」；已设负责人但未内嵌用户详情时占位 "—"', () => {
    const [unassigned, unresolved] = formatTaskRows([
      taskOf({ id: 14, assigneeId: null }),
      taskOf({ id: 15, assigneeId: 9 }),
    ]) as [FormattedTaskRow, FormattedTaskRow]
    expect(unassigned.assigneeName).toBe('未分配')
    expect(unassigned.assigneeInitials).toBe(LIST_EMPTY_PLACEHOLDER)
    expect(unresolved.assigneeName).toBe(LIST_EMPTY_PLACEHOLDER)
    expect(unresolved.assigneeInitials).toBe(LIST_EMPTY_PLACEHOLDER)
  })

  test('withMemberAssignees：成员索引补齐人类负责人，agent 与真未分配行原样保留', () => {
    const members: ProjectMember[] = [
      {
        id: 1,
        projectId: PROJECT_ID,
        userId: 9,
        projectRoleId: null,
        isActive: true,
        user: {
          id: 9,
          fullName: '张伟',
          email: 'zhang@example.com',
          initials: 'ZW',
          isActive: true,
        },
      },
    ]
    const rows = formatTaskRows([
      taskOf({ id: 20, assigneeId: 9, name: '待补齐' }),
      taskOf({ id: 21, assigneeId: null, name: '未分配' }),
      taskOf({ id: 22, assigneeType: 'agent', assigneeId: 99, name: 'AI 任务' }),
      taskOf({ id: 23, assigneeId: 404, name: '成员已退出' }),
    ])
    const index = buildMemberAssigneeIndex(members)
    const enriched = withMemberAssignees(rows, index)

    expect(enriched[0]?.assigneeName).toBe('张伟')
    expect(enriched[0]?.assigneeInitials).toBe('ZW')
    expect(enriched[1]?.assigneeName).toBe('未分配')
    expect(enriched[2]?.assigneeName).toBe('AI')
    expect(enriched[3]?.assigneeName).toBe(LIST_EMPTY_PLACEHOLDER)

    // 纯函数：入参不被就地修改
    expect(rows[0]?.assigneeName).toBe(LIST_EMPTY_PLACEHOLDER)
    // 空索引 / null 索引保持原行
    expect(withMemberAssignees(rows, new Map())).toEqual(rows)
    expect(withMemberAssignees(rows, null)).toEqual(rows)
  })

  test('buildMemberAssigneeIndex：按 user.id 建立索引并跳过无 user 关联的成员', () => {
    const members: ProjectMember[] = [
      {
        id: 1,
        projectId: PROJECT_ID,
        userId: 9,
        projectRoleId: null,
        isActive: true,
        user: { id: 9, fullName: '张伟', email: 'a@x.com', initials: 'ZW', isActive: true },
      },
      { id: 2, projectId: PROJECT_ID, userId: 10, projectRoleId: null, isActive: true },
    ]
    const index = buildMemberAssigneeIndex(members)
    expect(index.size).toBe(1)
    expect(index.get(9)?.email).toBe('a@x.com')
    expect(index.has(10)).toBe(false)
  })
})

describe('formatTaskRows：日期 / 工期 / 进度 / 编号 / 层级标签', () => {
  test('起止日期等宽时间戳：双侧 / 单侧 / 全缺省兜底', () => {
    const rows = formatTaskRows([
      taskOf({ id: 1, startDate: '2026-09-01', endDate: '2026-09-30' }),
      taskOf({ id: 2, startDate: '2026-09-01', endDate: null }),
      taskOf({ id: 3, startDate: null, endDate: '2026-09-30' }),
      taskOf({ id: 4, startDate: null, endDate: null }),
    ])
    expect(rows[0]?.dateSpanText).toBe(`2026-09-01${LIST_DATE_SPAN_SEPARATOR}2026-09-30`)
    expect(rows[0]?.dateStart).toBe('2026-09-01')
    expect(rows[0]?.dateEnd).toBe('2026-09-30')
    expect(rows[1]?.dateSpanText).toBe(
      `2026-09-01${LIST_DATE_SPAN_SEPARATOR}${LIST_EMPTY_PLACEHOLDER}`,
    )
    expect(rows[2]?.dateSpanText).toBe(
      `${LIST_EMPTY_PLACEHOLDER}${LIST_DATE_SPAN_SEPARATOR}2026-09-30`,
    )
    expect(rows[3]?.dateSpanText).toBe(LIST_EMPTY_PLACEHOLDER)
    expect(rows[3]?.dateStart).toBeNull()
    expect(rows[3]?.dateEnd).toBeNull()
  })

  test('工期：后端 durationDays 优先，缺失时由起止日期含首尾推算', () => {
    const rows = formatTaskRows([
      taskOf({ id: 1, durationDays: 5, startDate: '2026-09-01', endDate: '2026-09-30' }),
      taskOf({ id: 2, durationDays: null, startDate: '2026-09-01', endDate: '2026-09-30' }),
      taskOf({ id: 3, durationDays: null, startDate: '2026-09-01', endDate: '2026-09-01' }),
      taskOf({ id: 4, durationDays: null, startDate: null, endDate: null }),
    ])
    expect(rows[0]?.durationDays).toBe(5)
    expect(rows[0]?.durationText).toBe('5 天')
    expect(rows[1]?.durationDays).toBe(30)
    expect(rows[1]?.durationText).toBe('30 天')
    expect(rows[2]?.durationDays).toBe(1)
    expect(rows[3]?.durationDays).toBeNull()
    expect(rows[3]?.durationText).toBe(LIST_EMPTY_PLACEHOLDER)
  })

  test('进度百分比钳制在 0~100', () => {
    const rows = formatTaskRows([
      taskOf({ id: 1, progressPercent: 150 }),
      taskOf({ id: 2, progressPercent: -5 }),
      taskOf({ id: 3, progressPercent: 66 }),
    ])
    expect(rows[0]?.progressPercent).toBe(100)
    expect(rows[1]?.progressPercent).toBe(0)
    expect(rows[2]?.progressPercent).toBe(66)
  })

  test('任务编号 `#<id>` 与归属层级标签（父级任务名 / 占位）', () => {
    const rows = formatTaskRows([
      taskOf({
        id: 42,
        name: '核心微服务架构设计',
        parent: { id: 7, name: '架构与设计', status: 'in_progress' },
      }),
      taskOf({ id: 43 }),
    ])
    expect(rows[0]?.code).toBe('#42')
    expect(rows[0]?.wbsLabel).toBe('架构与设计')
    expect(rows[1]?.wbsLabel).toBe(LIST_EMPTY_PLACEHOLDER)
    expect(rows[1]?.raw).toBeInstanceOf(Object)
  })
})

describe('排序 / 筛选 / 分页参数组装', () => {
  test('toSortParam：升序 + / 降序 - / 默认序 undefined', () => {
    expect(toSortParam({ field: 'endDate', direction: 'asc' })).toBe('+endDate')
    expect(toSortParam({ field: 'endDate', direction: 'desc' })).toBe('-endDate')
    expect(toSortParam({ field: 'name', direction: 'asc' })).toBe('+name')
    expect(toSortParam(null)).toBeUndefined()
  })

  test('nextSortState 轮转：默认 → 升序 → 降序 → 默认；点新列回到升序', () => {
    expect(nextSortState(null, 'endDate')).toEqual({ field: 'endDate', direction: 'asc' })
    const asc: ListSortState = { field: 'endDate', direction: 'asc' }
    expect(nextSortState(asc, 'endDate')).toEqual({ field: 'endDate', direction: 'desc' })
    const desc: ListSortState = { field: 'endDate', direction: 'desc' }
    expect(nextSortState(desc, 'endDate')).toBeNull()
    expect(nextSortState(desc, 'priority')).toEqual({ field: 'priority', direction: 'asc' })
  })

  test('toTaskListFilters：全维组装并裁剪空值（搜索 trim、page ≥ 1）', () => {
    const filters = toTaskListFilters({
      status: 'in_progress',
      priority: 'high',
      search: '  索引  ',
      sort: { field: 'endDate', direction: 'asc' },
      page: 2,
      perPage: 50,
    })
    expect(filters).toEqual({
      status: 'in_progress',
      priority: 'high',
      search: '索引',
      sort: '+endDate',
      page: 2,
      perPage: 50,
    } satisfies TaskListFilters)

    // 未手动排序时默认按计划开始日期升序
    const empty = toTaskListFilters({ sort: null, page: 0, perPage: 25 })
    expect(empty).toEqual({ sort: '+startDate', page: 1, perPage: 25 })

    const noSearch = toTaskListFilters({
      search: '   ',
      sort: null,
      page: 1,
      perPage: 25,
    })
    expect(noSearch.search).toBeUndefined()
  })

  test('serializeTaskListFilters：与服务端同序拼接；sort 前缀 + 经 URLSearchParams 编码', () => {
    expect(
      serializeTaskListFilters({
        status: 'in_progress',
        priority: 'high',
        sort: '+endDate',
        page: 1,
        perPage: 25,
      }),
    ).toBe('?status=in_progress&priority=high&sort=%2BendDate&page=1&perPage=25')

    expect(serializeTaskListFilters({ page: 2, perPage: 50 })).toBe('?page=2&perPage=50')

    expect(
      serializeTaskListFilters({
        search: '接口联调',
        sort: '-name',
        page: 3,
        perPage: 25,
      }),
    ).toBe('?search=%E6%8E%A5%E5%8F%A3%E8%81%94%E8%B0%83&sort=-name&page=3&perPage=25')

    expect(serializeTaskListFilters({})).toBe('')
  })
})
