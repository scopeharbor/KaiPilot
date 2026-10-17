/**
 * v3-ui-next-remaining-lenses tasks 3.2 —— 日历月矩阵与任务/里程碑跨日落位纯函数单测
 * （`lib/next/lenses-calendar-adapter.ts`，spec「日历时间切面镜头月历网格与任务落位」）。
 *
 * 覆盖：
 * - 28 / 30 / 31 天自然月与跨年月份网格推导（周一为一周起始，4~6 × 7 矩阵）；
 * - 单日任务、多日条带、跨网格（含补齐周）落位与 isStart/isEnd/isMiddle 边界标记；
 * - 缺日期 / 双端缺失 / start>end 反转容错；
 * - 今天判定、周末判定与单日溢出折叠计数；
 * - 月份平移（shiftAnchorMonth）跨年推进。
 *
 * 网格基准（UTC 事实，预先以 Date.UTC 核验）：
 * - 2026-02-01 周日 → 2 月网格 = 2026-01-26（周一）~ 2026-03-01，共 35 格；
 * - 2026-08-01 周六 → 8 月网格 = 2026-07-27（周一）~ 2026-09-06，共 42 格；
 * - 2026-09-01 周二 → 9 月网格 = 2026-08-31（周一）~ 2026-10-04，共 35 格；
 * - 2026-12-01 周二 → 12 月网格 = 2026-11-30（周一）~ 2027-01-03，共 35 格。
 */
import { describe, expect, test } from 'vitest'
import type { CalendarItem } from '@/lib/calendar-types'
import {
  MAX_VISIBLE_ITEMS_PER_CELL,
  computeMonthGrid,
  isoWeekday,
  monthGridDays,
  shiftAnchorMonth,
  toDateString,
  type CalendarDayCellData,
} from '@/lib/next/lenses-calendar-adapter'

type ItemOverrides = Partial<
  Pick<CalendarItem, 'name' | 'status' | 'priority' | 'isOverdue' | 'dateRange'>
>

function itemOf(
  name: string,
  start: string,
  end = start,
  kind: 'task' | 'milestone' = 'task',
): CalendarItem {
  return {
    id: `${kind}-${name}`,
    kind,
    sourceId: 1,
    projectId: 1,
    name,
    status: kind === 'milestone' ? 'planned' : 'in_progress',
    priority: kind === 'task' ? 'high' : undefined,
    assignee: null,
    dateRange: {
      start,
      end,
      isSpan: start !== end,
      missingStart: false,
      missingEnd: false,
    },
    isMultiDay: start !== end,
    isOverdue: false,
    detailUrl: `/projects/1/${kind === 'milestone' ? 'milestones' : 'tasks'}/1`,
  }
}

/** 完整可定制的 CalendarItem（跨日落位测试专用）。 */
function itemOfWith(
  name: string,
  dateRange: { start: string | null; end: string | null },
  overrides: ItemOverrides = {},
): CalendarItem {
  const start = dateRange.start
  const end = dateRange.end
  const resolvedStart = start ?? end
  const resolvedEnd = end ?? start
  return {
    id: `task-${name}`,
    kind: 'task',
    sourceId: 1,
    projectId: 1,
    name,
    status: overrides.status ?? 'in_progress',
    priority: overrides.priority ?? 'high',
    assignee: null,
    dateRange: {
      start: start ?? null,
      end: end ?? null,
      isSpan: start !== null && end !== null && start !== end,
      missingStart: start === null,
      missingEnd: end === null,
    },
    isMultiDay: resolvedStart !== resolvedEnd && resolvedStart !== null && resolvedEnd !== null,
    isOverdue: overrides.isOverdue ?? false,
    detailUrl: `/projects/1/tasks/1`,
  }
}

function findCell(grid: { weeks: CalendarDayCellData[][] }, date: string): CalendarDayCellData {
  const cell = grid.weeks.flat().find((c) => c.dateString === date)
  expect(cell, `网格中应存在日期 ${date}`).toBeDefined()
  return cell!
}

/** 断言网格日期序列连续无重复、逐日 +1。 */
function expectContiguous(grid: { weeks: CalendarDayCellData[][] }) {
  const cells = grid.weeks.flat()
  for (let i = 1; i < cells.length; i += 1) {
    const prev = new Date(`${cells[i - 1]!.dateString}T00:00:00Z`).getTime()
    const curr = new Date(`${cells[i]!.dateString}T00:00:00Z`).getTime()
    expect(curr - prev).toBe(86_400_000)
  }
}

function expectPlacement(
  cell: CalendarDayCellData,
  name: string,
  flags: { isStart?: boolean; isEnd?: boolean; isMiddle?: boolean },
) {
  const p = cell.placements.find((placement) => placement.item.name === name)
  expect(p, `日期 ${cell.dateString} 应包含 ${name}`).toBeDefined()
  if (flags.isStart !== undefined) expect(p!.isStart).toBe(flags.isStart)
  if (flags.isEnd !== undefined) expect(p!.isEnd).toBe(flags.isEnd)
  if (flags.isMiddle !== undefined) expect(p!.isMiddle).toBe(flags.isMiddle)
  return p!
}

describe('monthGridDays / computeMonthGrid 网格推导', () => {
  test('平年二月（28 天）网格：周一 2026-01-26 起、2026-03-01 止，共 35 格', () => {
    const grid = computeMonthGrid('2026-02-10', [])
    expect(grid.monthTitle).toBe('2026 年 2 月')
    expect(grid.weeks).toHaveLength(5)
    grid.weeks.forEach((week) => expect(week).toHaveLength(7))
    expect(grid.weeks[0]![0]!.dateString).toBe('2026-01-26')
    expect(grid.weeks[4]![6]!.dateString).toBe('2026-03-01')
    expectContiguous(grid)
    const monthCells = grid.weeks.flat().filter((c) => c.isCurrentMonth)
    expect(monthCells).toHaveLength(28)
    // 补齐周标记
    expect(findCell(grid, '2026-01-31').isCurrentMonth).toBe(false)
    expect(findCell(grid, '2026-02-01').isCurrentMonth).toBe(true)
    expect(findCell(grid, '2026-03-01').isCurrentMonth).toBe(false)
  })

  test('31 天月份（2026-08）六行网格：42 格，首尾补齐跨双月', () => {
    const grid = computeMonthGrid('2026-08-08', [])
    expect(grid.monthTitle).toBe('2026 年 8 月')
    expect(grid.weeks).toHaveLength(6)
    expect(grid.weeks[0]![0]!.dateString).toBe('2026-07-27')
    expect(grid.weeks[5]![6]!.dateString).toBe('2026-09-06')
    expectContiguous(grid)
    expect(grid.weeks.flat().filter((c) => c.isCurrentMonth)).toHaveLength(31)
  })

  test('跨年 12 月网格收进次年 1 月初', () => {
    const grid = computeMonthGrid('2026-12-10', [])
    expect(grid.monthTitle).toBe('2026 年 12 月')
    expect(grid.weeks[0]![0]!.dateString).toBe('2026-11-30')
    const janCell = findCell(grid, '2027-01-01')
    expect(janCell.dayNumber).toBe(1)
    expect(janCell.isCurrentMonth).toBe(false)
    expect(grid.weeks[4]![6]!.dateString).toBe('2027-01-03')
    expect(grid.weeks.flat().filter((c) => c.isCurrentMonth)).toHaveLength(31)
  })

  test('anchor 为月中日期与当月 1 号推导同一网格', () => {
    const a = computeMonthGrid('2026-09-01', [])
    const b = computeMonthGrid('2026-09-15', [])
    expect(a.weeks[0]![0]!.dateString).toBe(b.weeks[0]![0]!.dateString)
    expect(a.weeks[4]![6]!.dateString).toBe(b.weeks[4]![6]!.dateString)
    // 9 月 1 日（周二）落在首行第 2 列 → 周一列宽对齐验证
    expect(b.weeks[0]![0]!.dateString).toBe('2026-08-31')
    expect(b.weeks[0]![1]!.dateString).toBe('2026-09-01')
  })

  test('dayNumber / isCurrentMonth / 首尾补齐区间语义正确', () => {
    const grid = computeMonthGrid('2026-09-15', [])
    expect(findCell(grid, '2026-09-30').dayNumber).toBe(30)
    expect(findCell(grid, '2026-10-01').dayNumber).toBe(1)
    expect(findCell(grid, '2026-08-31').dayNumber).toBe(31)
    expect(findCell(grid, '2026-10-04').isCurrentMonth).toBe(false)
  })

  test('非法 anchorDate 抛错（格式 / 越界日历日）', () => {
    expect(() => computeMonthGrid('2026-9-1', [])).toThrow(/YYYY-MM-DD/)
    expect(() => computeMonthGrid('2026-02-30', [])).toThrow(/非法日历日期/)
    expect(() => computeMonthGrid('2026-13-01', [])).toThrow(/非法日历日期/)
    expect(() => computeMonthGrid('not-a-date', [])).toThrow(/YYYY-MM-DD/)
  })
})

describe('今天 / 周末 / 星期判定', () => {
  test('今天仅标记唯一匹配日期（含补齐周日期）', () => {
    const grid = computeMonthGrid('2026-09-15', [], '2026-09-17')
    expect(findCell(grid, '2026-09-17').isToday).toBe(true)
    expect(findCell(grid, '2026-09-16').isToday).toBe(false)
    expect(grid.weeks.flat().filter((c) => c.isToday)).toHaveLength(1)

    // 今天落在下月补齐周格时同样标记（此时不在本月）
    const boundary = computeMonthGrid('2026-09-15', [], '2026-10-02')
    expect(findCell(boundary, '2026-10-02').isToday).toBe(true)
    expect(findCell(boundary, '2026-10-02').isCurrentMonth).toBe(false)

    // 缺省 todayStr → 无任何格是今天
    const none = computeMonthGrid('2026-09-15', [])
    expect(none.weeks.flat().filter((c) => c.isToday)).toHaveLength(0)
  })

  test('周末判定：周六/周日为 weekend，周一至周五不是', () => {
    const grid = computeMonthGrid('2026-09-15', [])
    expect(findCell(grid, '2026-09-05').isWeekend).toBe(true)
    expect(findCell(grid, '2026-09-06').isWeekend).toBe(true)
    expect(findCell(grid, '2026-09-07').isWeekend).toBe(false)
    expect(findCell(grid, '2026-09-04').isWeekend).toBe(false)
  })

  test('isoWeekday：周一=1 … 周日=7', () => {
    expect(isoWeekday('2026-08-31')).toBe(1)
    expect(isoWeekday('2026-09-01')).toBe(2)
    expect(isoWeekday('2026-09-06')).toBe(7)
    expect(isoWeekday('2026-02-01')).toBe(7)
  })
})

describe('任务与里程碑落位', () => {
  const SEP_ITEMS: CalendarItem[] = [
    itemOf('单日任务', '2026-09-10'),
    itemOf('需求冻结里程碑', '2026-09-11', '2026-09-11', 'milestone'),
    itemOf('联调窗口', '2026-09-14', '2026-09-16'),
    itemOf('区间外的任务', '2026-05-01'),
  ]

  test('单日任务与里程碑落入对应单格，双端标记为 start+end', () => {
    const grid = computeMonthGrid('2026-09-15', SEP_ITEMS)
    const taskCell = findCell(grid, '2026-09-10')
    expect(taskCell.placements).toHaveLength(1)
    expectPlacement(taskCell, '单日任务', { isStart: true, isEnd: true, isMiddle: false })

    const milestoneCell = findCell(grid, '2026-09-11')
    expectPlacement(milestoneCell, '需求冻结里程碑', {
      isStart: true,
      isEnd: true,
      isMiddle: false,
    })
    expect(milestoneCell.items[0]!.kind).toBe('milestone')
  })

  test('跨日任务在覆盖的每个自然日各落一段并标记首/中/尾', () => {
    const grid = computeMonthGrid('2026-09-15', SEP_ITEMS)
    expectPlacement(findCell(grid, '2026-09-14'), '联调窗口', {
      isStart: true,
      isEnd: false,
      isMiddle: false,
    })
    expectPlacement(findCell(grid, '2026-09-15'), '联调窗口', {
      isStart: false,
      isEnd: false,
      isMiddle: true,
    })
    expectPlacement(findCell(grid, '2026-09-16'), '联调窗口', {
      isStart: false,
      isEnd: true,
      isMiddle: false,
    })
    // 区间外天数零落位
    expect(findCell(grid, '2026-09-13').placements).toHaveLength(0)
    expect(findCell(grid, '2026-09-17').placements).toHaveLength(0)
  })

  test('区间外项不产生任何落位；items 与 placements 严格同步', () => {
    const grid = computeMonthGrid('2026-09-15', SEP_ITEMS)
    const totalPlacements = grid.weeks.flat().reduce((n, c) => n + c.placements.length, 0)
    expect(totalPlacements).toBe(5) // 单日任务 1 + 里程碑 1 + 3 段条带
    grid.weeks.flat().forEach((cell) => {
      expect(cell.items.map((i) => i.name)).toEqual(cell.placements.map((p) => p.item.name))
    })
  })

  test('单元格排序：多日条带恒先于单日微卡，行位稳定连续', () => {
    const items = [
      itemOf('单日甲', '2026-09-15'),
      itemOf('条带任务', '2026-09-13', '2026-09-17'),
      itemOf('单日乙', '2026-09-15'),
    ]
    const grid = computeMonthGrid('2026-09-15', items)
    const cell = findCell(grid, '2026-09-15')
    expect(cell.placements).toHaveLength(3)
    expect(cell.placements[0]!.item.name).toBe('条带任务')
    expect(cell.placements[0]!.isMiddle).toBe(true)
    expect(cell.placements[1]!.item.name).toBe('单日甲')
    expect(cell.placements[2]!.item.name).toBe('单日乙')
    // 相邻日的条带段行位一致（均为第 0 行）
    expect(findCell(grid, '2026-09-14').placements[0]!.item.name).toBe('条带任务')
    expect(findCell(grid, '2026-09-16').placements[0]!.item.name).toBe('条带任务')
  })

  test('跨网格边界的条带：跨入补齐周的上/下月日期格', () => {
    const crossStart = itemOfWith('跨月末条带', { start: '2026-08-30', end: '2026-09-03' })
    const crossEnd = itemOfWith('跨下月条带', { start: '2026-10-01', end: '2026-10-05' })
    const grid = computeMonthGrid('2026-09-15', [crossStart, crossEnd])

    // 08-30 起点不在本网格：08-31 起均为中段/终点段
    expect(findCell(grid, '2026-08-31').placements).toHaveLength(1)
    expectPlacement(findCell(grid, '2026-08-31'), '跨月末条带', { isMiddle: true })
    expectPlacement(findCell(grid, '2026-09-03'), '跨月末条带', { isEnd: true })

    // 10-05 终点超出网格：仅铺到网格内 10-01 ~ 10-04
    expectPlacement(findCell(grid, '2026-10-01'), '跨下月条带', { isStart: true })
    expectPlacement(findCell(grid, '2026-10-04'), '跨下月条带', { isMiddle: true })
    expect(findCell(grid, '2026-10-04').placements).toHaveLength(1)
  })

  test('日期缺失容错：单端缺失按单点落位，双端缺失跳过', () => {
    const missingEnd = itemOfWith('缺截止', { start: '2026-09-20', end: null })
    const missingStart = itemOfWith('缺起点', { start: null, end: '2026-09-21' })
    const bothMissing = itemOfWith('完全无日期', { start: null, end: null })
    const grid = computeMonthGrid('2026-09-15', [missingEnd, missingStart, bothMissing])
    expectPlacement(findCell(grid, '2026-09-20'), '缺截止', { isStart: true, isEnd: true })
    expectPlacement(findCell(grid, '2026-09-21'), '缺起点', { isStart: true, isEnd: true })
    expect(grid.weeks.flat().reduce((n, c) => n + c.placements.length, 0)).toBe(2)
  })

  test('start > end 数据反转：按起点单点容错不抛错', () => {
    const inverted = itemOfWith('反转任务', { start: '2026-09-22', end: '2026-09-10' })
    const grid = computeMonthGrid('2026-09-15', [inverted])
    expectPlacement(findCell(grid, '2026-09-22'), '反转任务', { isStart: true, isEnd: true })
    expect(grid.weeks.flat().reduce((n, c) => n + c.placements.length, 0)).toBe(1)
  })
})

describe('溢出折叠计数', () => {
  function manyItems(count: number, prefix: string, date: string): CalendarItem[] {
    return Array.from({ length: count }, (_, i) => itemOf(`${prefix}${i + 1}`, date))
  }

  test(`单日超过 ${MAX_VISIBLE_ITEMS_PER_CELL} 项才产生 overflowCount`, () => {
    const three = computeMonthGrid('2026-09-15', manyItems(3, '三', '2026-09-18'))
    expect(findCell(three, '2026-09-18').overflowCount).toBe(0)

    const four = computeMonthGrid('2026-09-15', manyItems(4, '四', '2026-09-18'))
    expect(findCell(four, '2026-09-18').overflowCount).toBe(1)

    const five = computeMonthGrid('2026-09-15', manyItems(5, '五', '2026-09-18'))
    expect(findCell(five, '2026-09-18').overflowCount).toBe(2)
  })

  test('条带与单日混排时按当日总落位数折叠计数', () => {
    const items = [
      ...manyItems(3, '微卡', '2026-09-18'),
      itemOf('过路条带', '2026-09-17', '2026-09-19'),
    ]
    const grid = computeMonthGrid('2026-09-15', items)
    const cell = findCell(grid, '2026-09-18')
    expect(cell.placements).toHaveLength(4)
    expect(cell.overflowCount).toBe(1)
    // 折叠不影响 items 全量（浮层数据源）
    expect(cell.items).toHaveLength(4)
  })
})

describe('月份平移与日期工具', () => {
  test('shiftAnchorMonth 归一 1 号并支持跨年', () => {
    expect(shiftAnchorMonth('2026-09-15', 1)).toBe('2026-10-01')
    expect(shiftAnchorMonth('2026-09-15', -1)).toBe('2026-08-01')
    expect(shiftAnchorMonth('2026-09-15', 0)).toBe('2026-09-01')
    expect(shiftAnchorMonth('2026-12-10', 1)).toBe('2027-01-01')
    expect(shiftAnchorMonth('2026-01-05', -1)).toBe('2025-12-01')
    expect(shiftAnchorMonth('2026-11-20', 3)).toBe('2027-02-01')
  })

  test('toDateString 输出本地 YYYY-MM-DD（补零）', () => {
    expect(toDateString(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05')
    expect(toDateString(new Date(2026, 8, 15, 12, 0, 0))).toBe('2026-09-15')
  })

  test('monthGridDays 推导 4~6 行网格且窗口连续', () => {
    const feb = monthGridDays('2026-02-10')
    expect(feb.days).toHaveLength(35)
    const aug = monthGridDays('2026-08-08')
    expect(aug.days).toHaveLength(42)
    const nov = monthGridDays('2026-11-15')
    expect(nov.days).toHaveLength(42)
    expect(nov.gridStart).toBe('2026-10-26')
    expect(nov.gridEnd).toBe('2026-12-06')
  })
})
