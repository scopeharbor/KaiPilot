import { test } from '@japa/runner'
import {
  buildDateRange,
  taskToCalendarItem,
  milestoneToCalendarItem,
  sortCalendarItems,
  buildWorkingCalendarContext,
  isWindowTooLarge,
} from '#services/calendar/calendar_item_mapper'
import type { CalendarItem } from '#types/calendar_item'

test.group('buildDateRange', () => {
  test('全区间日期返回 isSpan=true', ({ assert }) => {
    const result = buildDateRange('2026-07-10', '2026-07-15')
    assert.isTrue(result.isSpan)
    assert.isFalse(result.missingStart)
    assert.isFalse(result.missingEnd)
    assert.equal(result.start, '2026-07-10')
    assert.equal(result.end, '2026-07-15')
  })

  test('单日区间（起止相同）返回 isSpan=false', ({ assert }) => {
    const result = buildDateRange('2026-07-10', '2026-07-10')
    assert.isFalse(result.isSpan)
  })

  test('仅有 end_date 标记 missingStart', ({ assert }) => {
    const result = buildDateRange(null, '2026-07-15')
    assert.isTrue(result.missingStart)
    assert.isFalse(result.missingEnd)
    assert.isFalse(result.isSpan)
  })

  test('仅有 start_date 标记 missingEnd', ({ assert }) => {
    const result = buildDateRange('2026-07-10', null)
    assert.isFalse(result.missingStart)
    assert.isTrue(result.missingEnd)
    assert.isFalse(result.isSpan)
  })

  test('无日期返回全缺', ({ assert }) => {
    const result = buildDateRange(null, null)
    assert.isFalse(result.isSpan)
    assert.isFalse(result.missingStart)
    assert.isFalse(result.missingEnd)
    assert.isNull(result.start)
    assert.isNull(result.end)
  })
})

test.group('taskToCalendarItem', () => {
  const today = '2026-07-13'

  function mockTask(overrides: Record<string, unknown> = {}) {
    // 先取出日期字段，避免 `...rest` 覆盖掉 Luxon-like 的 { toISODate } 包装。
    const { startDate, endDate, ...rest } = overrides
    return {
      id: 1,
      projectId: 1,
      name: '测试任务',
      status: 'in_progress',
      priority: 'high',
      taskType: 'task',
      assignee: { id: 1, fullName: '张三', email: 'zhang@test.com', avatarUrl: null },
      ...rest,
      startDate: startDate ? { toISODate: () => startDate as string } : null,
      endDate: endDate ? { toISODate: () => endDate as string } : null,
    } as Record<string, unknown>
  }

  test('全区间任务返回正确 CalendarItem', ({ assert }) => {
    const task = mockTask({
      startDate: '2026-07-10',
      endDate: '2026-07-15',
    })
    const item = taskToCalendarItem(task as never, today)
    assert.equal(item.kind, 'task')
    assert.equal(item.name, '测试任务')
    assert.isTrue(item.isMultiDay)
    assert.isFalse(item.isOverdue)
    assert.equal(item.assignee?.fullName, '张三')
  })

  test('逾期任务标记 isOverdue', ({ assert }) => {
    const task = mockTask({
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      status: 'not_started',
    })
    const item = taskToCalendarItem(task as never, today)
    assert.isTrue(item.isOverdue)
  })

  test('已完成任务不标记逾期', ({ assert }) => {
    const task = mockTask({
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      status: 'completed',
    })
    const item = taskToCalendarItem(task as never, today)
    assert.isFalse(item.isOverdue)
  })

  test('无负责人任务 assignee 为 null', ({ assert }) => {
    const task = mockTask({
      startDate: '2026-07-10',
      endDate: '2026-07-15',
      assignee: null,
    })
    const item = taskToCalendarItem(task as never, today)
    assert.isNull(item.assignee)
  })

  test('仅截止日任务标记 missingStart', ({ assert }) => {
    const task = mockTask({
      startDate: null,
      endDate: '2026-07-15',
    })
    const item = taskToCalendarItem(task as never, today)
    assert.isTrue(item.dateRange.missingStart)
    assert.isFalse(item.isMultiDay)
  })
})

test.group('milestoneToCalendarItem', () => {
  const today = '2026-07-13'

  function mockMilestoneView(overrides: Record<string, unknown> = {}) {
    return {
      milestone: {
        id: 1,
        projectId: 1,
        name: '里程碑1',
        status: overrides.status ?? 'not_started',
        plannedDate: overrides.plannedDate
          ? { toISODate: () => overrides.plannedDate as string }
          : null,
      },
      displayStatus: overrides.displayStatus ?? 'not_started',
      storedStatus: overrides.status ?? 'not_started',
    }
  }

  test('里程碑返回正确 CalendarItem', ({ assert }) => {
    const mv = mockMilestoneView({
      plannedDate: '2026-07-20',
    })
    const item = milestoneToCalendarItem(mv as never, today)
    assert.equal(item.kind, 'milestone')
    assert.equal(item.name, '里程碑1')
    assert.equal(item.sourceId, 1)
    assert.isNull(item.assignee)
    assert.isFalse(item.isMultiDay)
  })

  test('逾期里程碑标记 isOverdue', ({ assert }) => {
    const mv = mockMilestoneView({
      plannedDate: '2026-07-05',
      status: 'not_started',
    })
    const item = milestoneToCalendarItem(mv as never, today)
    assert.isTrue(item.isOverdue)
  })

  test('已达成里程碑不标记逾期', ({ assert }) => {
    const mv = mockMilestoneView({
      plannedDate: '2026-07-05',
      status: 'achieved',
    })
    const item = milestoneToCalendarItem(mv as never, today)
    assert.isFalse(item.isOverdue)
  })
})

test.group('sortCalendarItems', () => {
  test('按日期、类型、ID 稳定排序', ({ assert }) => {
    const items: CalendarItem[] = [
      {
        id: 'milestone-2',
        kind: 'milestone',
        sourceId: 2,
        projectId: 1,
        name: 'M2',
        status: 'not_started',
        dateRange: {
          start: '2026-07-10',
          end: '2026-07-10',
          isSpan: false,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: false,
        isOverdue: false,
        detailUrl: '/projects/1/milestones/2',
      },
      {
        id: 'task-1',
        kind: 'task',
        sourceId: 1,
        projectId: 1,
        name: 'T1',
        status: 'in_progress',
        priority: 'high',
        dateRange: {
          start: '2026-07-10',
          end: '2026-07-12',
          isSpan: true,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: true,
        isOverdue: false,
        detailUrl: '/projects/1/tasks/1',
        assignee: null,
      },
      {
        id: 'task-3',
        kind: 'task',
        sourceId: 3,
        projectId: 1,
        name: 'T3',
        status: 'not_started',
        priority: 'medium',
        dateRange: {
          start: '2026-07-08',
          end: '2026-07-08',
          isSpan: false,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: false,
        isOverdue: false,
        detailUrl: '/projects/1/tasks/3',
        assignee: null,
      },
    ]
    const sorted = sortCalendarItems(items)
    // T3 (07-08) → task-1 (07-10) → milestone-2 (07-10, 后于 task)
    assert.equal(sorted[0].id, 'task-3')
    assert.equal(sorted[1].id, 'task-1')
    assert.equal(sorted[2].id, 'milestone-2')
  })

  test('同一日期同类型按 ID 排序', ({ assert }) => {
    const items: CalendarItem[] = [
      {
        id: 'task-5',
        kind: 'task',
        sourceId: 5,
        projectId: 1,
        name: 'T5',
        status: 'in_progress',
        priority: 'high',
        dateRange: {
          start: '2026-07-10',
          end: '2026-07-10',
          isSpan: false,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: false,
        isOverdue: false,
        detailUrl: '/projects/1/tasks/5',
        assignee: null,
      },
      {
        id: 'task-3',
        kind: 'task',
        sourceId: 3,
        projectId: 1,
        name: 'T3',
        status: 'in_progress',
        priority: 'high',
        dateRange: {
          start: '2026-07-10',
          end: '2026-07-10',
          isSpan: false,
          missingStart: false,
          missingEnd: false,
        },
        isMultiDay: false,
        isOverdue: false,
        detailUrl: '/projects/1/tasks/3',
        assignee: null,
      },
    ]
    const sorted = sortCalendarItems(items)
    assert.equal(sorted[0].id, 'task-3')
    assert.equal(sorted[1].id, 'task-5')
  })
})

test.group('buildWorkingCalendarContext', () => {
  test('默认工作日内返回 isNonWorkingDay=true 对应周末', ({ assert }) => {
    const ctx = buildWorkingCalendarContext(null)
    // 2026-07-11 是周六
    assert.isTrue(ctx.isNonWorkingDay('2026-07-11'))
    // 2026-07-13 是周一
    assert.isFalse(ctx.isNonWorkingDay('2026-07-13'))
  })

  test('节假日标记正确', ({ assert }) => {
    const ctx = buildWorkingCalendarContext({
      workingCalendar: {
        workdays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-01'],
        extraWorkdays: [],
      },
    })
    assert.isTrue(ctx.isHoliday('2026-10-01'))
    assert.isTrue(ctx.isNonWorkingDay('2026-10-01'))
  })

  test('调休日标记正确', ({ assert }) => {
    const ctx = buildWorkingCalendarContext({
      workingCalendar: {
        workdays: [1, 2, 3, 4, 5],
        holidays: [],
        extraWorkdays: ['2026-09-26'],
      },
    })
    assert.isTrue(ctx.isExtraWorkday('2026-09-26'))
    // 周六应该是非工作日，但调休日后变为工作日
    assert.isFalse(ctx.isNonWorkingDay('2026-09-26'))
  })
})

test.group('isWindowTooLarge', () => {
  test('一个月窗口正常', ({ assert }) => {
    assert.isFalse(isWindowTooLarge('2026-07-01', '2026-07-31'))
  })

  test('18 个月窗口正常', ({ assert }) => {
    assert.isFalse(isWindowTooLarge('2026-01-01', '2027-06-30'))
  })

  test('超过 18 个月窗口标记过大', ({ assert }) => {
    assert.isTrue(isWindowTooLarge('2026-01-01', '2027-12-31'))
  })
})

test.group('buildWorkingCalendarContext · 封网窗口', () => {
  test('读取项目设置中的封网窗口，丢弃形态不合法的条目', ({ assert }) => {
    const ctx = buildWorkingCalendarContext({
      changeFreezeWindows: [
        { start: '2026-12-11', end: '2027-01-10', label: '封网：年底结算' },
        { start: '2027-02-03', end: '2027-02-14' },
        { start: '明年', end: '2027-02-14', label: '坏数据' },
        'not-an-object',
      ],
    })
    assert.deepEqual(ctx.changeFreezeWindows, [
      { start: '2026-12-11', end: '2027-01-10', label: '封网：年底结算' },
      { start: '2027-02-03', end: '2027-02-14', label: '封网' },
    ])
  })

  test('未配置时为空数组', ({ assert }) => {
    assert.deepEqual(buildWorkingCalendarContext(null).changeFreezeWindows, [])
  })
})
