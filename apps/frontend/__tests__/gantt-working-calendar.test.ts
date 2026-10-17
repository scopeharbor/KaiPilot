import { describe, expect, it } from 'vitest'
import {
  createWorkingCalendar,
  endFromStart,
  formatIsoDate,
  parseIsoDate,
  shiftIsoByWorkingDays,
  shiftWorkingDays,
  snapIsoToWorkingDay,
  snapToWorkingDay,
  startFromEnd,
  workingDayDuration,
} from '@/lib/gantt/working-calendar'
import { normalizeWorkingCalendarSettings } from '@aiproj/types'

describe('甘特前端工作日吸附', () => {
  it('周六向后吸附周一，向前吸附周五', () => {
    expect(snapIsoToWorkingDay('2026-07-04')).toBe('2026-07-06')
    expect(snapIsoToWorkingDay('2026-07-04', null, -1)).toBe('2026-07-03')
  })

  it('Shift 五工作日跨过周末与节假日', () => {
    expect(
      shiftIsoByWorkingDays('2026-07-03', 5, {
        workdays: [1, 2, 3, 4, 5],
        holidays: ['2026-07-06'],
      }),
    ).toBe('2026-07-13')
  })

  it('负偏移按工作日向前', () => {
    expect(shiftIsoByWorkingDays('2026-07-06', -1)).toBe('2026-07-03')
  })
})

/**
 * 前后端工作日算术对齐单测（task 1.2）。
 * 同一组日期（含跨周末、跨节假日、lag 正负）在两端须算出同工期/同顺延；
 * 断言前端镜像值与后端 `gantt_working_calendar.spec.ts` 已知输出一致。
 */
describe('前后端工作日算术对齐（镜像后端 gantt_working_calendar）', () => {
  it('默认周一至周五，周末与节假日不计工期（对齐后端用例 1）', () => {
    const defaultCalendar = createWorkingCalendar()
    expect(formatIsoDate(endFromStart(defaultCalendar, parseIsoDate('2026-07-03'), 2))).toBe(
      '2026-07-06',
    )
    const holidayCalendar = createWorkingCalendar({ holidays: ['2026-07-06'] })
    expect(formatIsoDate(endFromStart(holidayCalendar, parseIsoDate('2026-07-03'), 2))).toBe(
      '2026-07-07',
    )
  })

  it('正负工作日偏移、吸附、反推开始与闰年稳定（对齐后端用例 2）', () => {
    const calendar = createWorkingCalendar()
    expect(formatIsoDate(shiftWorkingDays(calendar, parseIsoDate('2026-07-08'), -2))).toBe(
      '2026-07-06',
    )
    expect(formatIsoDate(snapToWorkingDay(calendar, parseIsoDate('2026-07-04'), 1))).toBe(
      '2026-07-06',
    )
    expect(formatIsoDate(startFromEnd(calendar, parseIsoDate('2026-07-08'), 3))).toBe('2026-07-06')
    expect(
      workingDayDuration(calendar, parseIsoDate('2024-02-28'), parseIsoDate('2024-03-01')),
    ).toBe(3)
  })

  it('拒绝非法日期与无工作日日历（对齐后端用例 3）', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow('无效日期')
    expect(() => createWorkingCalendar({ workdays: [] })).toThrow('项目至少需要一个工作日')
    expect(() => createWorkingCalendar({ holidays: ['2026/07/06'] })).toThrow('无效日期')
  })

  it('规范化默认值、星期编号、日期排序和调休日（对齐后端用例 4）', () => {
    const normalized = normalizeWorkingCalendarSettings({
      workdays: [6, 1, 0, 6],
      holidays: ['2026-10-03', '2026-10-01', '2026-10-01'],
      extraWorkdays: ['2026-09-26', '2026-09-20'],
    })
    expect(normalized).toEqual({
      version: 1,
      workdays: [0, 1, 6],
      holidays: ['2026-10-01', '2026-10-03'],
      extraWorkdays: ['2026-09-20', '2026-09-26'],
    })

    const calendar = createWorkingCalendar(normalized)
    expect(formatIsoDate(endFromStart(calendar, parseIsoDate('2026-09-25'), 2))).toBe('2026-09-27')
  })

  it('lag 正负顺延在跨周末场景与后端语义一致', () => {
    const calendar = createWorkingCalendar({ workdays: [1, 2, 3, 4, 5] })
    // 周五 +1 工作日 → 下周一（lag=0 的 FS 后继开始日）
    expect(formatIsoDate(shiftWorkingDays(calendar, parseIsoDate('2026-07-03'), 1))).toBe(
      '2026-07-06',
    )
    // 周一 -1 工作日 → 上周五（负 lag/lead 回退）
    expect(formatIsoDate(shiftWorkingDays(calendar, parseIsoDate('2026-07-06'), -1))).toBe(
      '2026-07-03',
    )
    // 跨节假日：2026-07-06 节假，从 07-03 起 +2 工作日 → 07-08（跳过周末+节假日）
    const holidayCal = createWorkingCalendar({
      workdays: [1, 2, 3, 4, 5],
      holidays: ['2026-07-06'],
    })
    expect(formatIsoDate(shiftWorkingDays(holidayCal, parseIsoDate('2026-07-03'), 2))).toBe(
      '2026-07-08',
    )
  })
})
