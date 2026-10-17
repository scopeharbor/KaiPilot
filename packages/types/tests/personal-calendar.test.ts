import { describe, expect, it } from 'vitest'
import {
  isPersonallyOff,
  normalizePersonalCalendar,
  personalLeaveOn,
  personalOffDays,
} from '../src/personal-calendar.js'

describe('个人工作日历', () => {
  it('清洗：丢掉非法日期、起止颠倒自动对调、按开始日排序、重复 id 重新编号', () => {
    const calendar = normalizePersonalCalendar({
      workdays: [1, 2, 3, 3, 9, 'x'],
      leaves: [
        { id: 'a', startDate: '2026-10-20', endDate: '2026-10-18', note: ' 回老家 ' },
        { id: 'a', startDate: '2026-10-01', endDate: '2026-10-02' },
        { startDate: '2026-02-30', endDate: '2026-03-01' },
        'oops',
      ],
    })
    expect(calendar.workdays).toEqual([1, 2, 3])
    expect(calendar.leaves).toEqual([
      { id: '2026-10-01_2026-10-02_1', startDate: '2026-10-01', endDate: '2026-10-02', note: null },
      { id: 'a', startDate: '2026-10-18', endDate: '2026-10-20', note: '回老家' },
    ])
    expect(normalizePersonalCalendar(null)).toEqual({ workdays: null, leaves: [] })
  })

  it('某天是否不上班：休假区间含首尾；设了个人工作日时其余日子不上班', () => {
    const calendar = normalizePersonalCalendar({
      workdays: [1, 2, 3],
      leaves: [{ id: 'x', startDate: '2026-10-13', endDate: '2026-10-14', note: '体检' }],
    })
    expect(personalLeaveOn(calendar, '2026-10-14')?.note).toBe('体检')
    expect(isPersonallyOff(calendar, '2026-10-12')).toBe(false) // 周一
    expect(isPersonallyOff(calendar, '2026-10-13')).toBe(true) // 周二请假
    expect(isPersonallyOff(calendar, '2026-10-15')).toBe(true) // 周四不是个人工作日
    expect(personalOffDays(calendar, '2026-10-12', '2026-10-16')).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
    ])
    expect(personalOffDays({ workdays: null, leaves: [] }, '2026-10-12', '2026-10-16')).toEqual([])
  })
})
