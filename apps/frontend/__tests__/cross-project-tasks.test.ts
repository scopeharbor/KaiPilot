import { describe, expect, it } from 'vitest'
import type { Task } from '@/lib/api/tasks'
import { ISSUE_STATUS_TRANSITIONS } from '@/lib/api/issues'
import {
  buildMonthGrid,
  groupTasksByDue,
  sortTasksByDue,
  toIsoDate,
} from '@/lib/cross-project-tasks'

function task(id: number, endDate: string | null, projectId = 1): Task {
  return { id, projectId, endDate, name: `任务${id}` } as Task
}

describe('cross-project-tasks 聚合纯函数', () => {
  it('sortTasksByDue：截止日升序，无截止日排最后', () => {
    const sorted = sortTasksByDue([task(1, null), task(2, '2026-09-20'), task(3, '2026-09-01')])
    expect(sorted.map((t) => t.id)).toEqual([3, 2, 1])
  })

  it('buildMonthGrid：周一开头 42 格，窗口为当月首尾', () => {
    // 2026-09-01 是周二 → 网格首格为 8 月 31 日（周一）
    const grid = buildMonthGrid(2026, 8)
    expect(grid.dateFrom).toBe('2026-09-01')
    expect(grid.dateTo).toBe('2026-09-30')
    expect(grid.days).toHaveLength(42)
    expect(grid.days[0]).toEqual({ iso: '2026-08-31', day: 31, inMonth: false })
    expect(grid.days[1]).toEqual({ iso: '2026-09-01', day: 1, inMonth: true })
  })

  it('groupTasksByDue：按日期部分跨项目分组，忽略无截止日任务', () => {
    const map = groupTasksByDue([
      task(1, '2026-09-14T10:00:00.000Z', 1),
      task(2, '2026-09-14', 2),
      task(3, null),
    ])
    expect(map.get('2026-09-14')?.map((t) => t.id)).toEqual([1, 2])
    expect(map.size).toBe(1)
  })

  it('toIsoDate 使用本地日期', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('问题状态流转与后端状态机一致：open 不能直接 resolved', () => {
    expect(ISSUE_STATUS_TRANSITIONS.open).not.toContain('resolved')
    expect(ISSUE_STATUS_TRANSITIONS.in_progress).toContain('resolved')
    expect(ISSUE_STATUS_TRANSITIONS.resolved).toEqual(['closed', 'open'])
  })
})
