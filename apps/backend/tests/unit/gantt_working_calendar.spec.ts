import {
  createWorkingCalendar,
  endFromStart,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
  shiftWorkingDays,
  snapToWorkingDay,
  startFromEnd,
  workingDayDuration,
} from '#services/gantt_working_calendar'
import { normalizeWorkingCalendarSettings } from '@aiproj/types'
import { test } from '@japa/runner'

test.group('Gantt working calendar', () => {
  test('默认周一至周五，周末与节假日不计工期', ({ assert }) => {
    const defaultCalendar = createWorkingCalendar()
    assert.equal(
      formatIsoDate(endFromStart(defaultCalendar, parseIsoDate('2026-07-03'), 2)),
      '2026-07-06',
    )

    const holidayCalendar = createWorkingCalendar({ holidays: ['2026-07-06'] })
    assert.equal(
      formatIsoDate(endFromStart(holidayCalendar, parseIsoDate('2026-07-03'), 2)),
      '2026-07-07',
    )
  })

  test('正负工作日偏移、吸附、反推开始与闰年稳定', ({ assert }) => {
    const calendar = createWorkingCalendar()
    assert.equal(
      formatIsoDate(shiftWorkingDays(calendar, parseIsoDate('2026-07-08'), -2)),
      '2026-07-06',
    )
    assert.equal(
      formatIsoDate(snapToWorkingDay(calendar, parseIsoDate('2026-07-04'), 1)),
      '2026-07-06',
    )
    assert.equal(formatIsoDate(startFromEnd(calendar, parseIsoDate('2026-07-08'), 3)), '2026-07-06')
    assert.equal(
      workingDayDuration(calendar, parseIsoDate('2024-02-28'), parseIsoDate('2024-03-01')),
      3,
    )
  })

  test('拒绝非法日期与无工作日日历', ({ assert }) => {
    assert.throws(() => parseIsoDate('2026-02-30'), '无效日期')
    assert.throws(() => createWorkingCalendar({ workdays: [] }), '项目至少需要一个工作日')
    assert.throws(() => createWorkingCalendar({ holidays: ['2026/07/06'] }), '无效日期')
  })

  test('规范化工作日历默认值、星期编号、日期排序与调休日', ({ assert }) => {
    const normalized = normalizeWorkingCalendarSettings({
      workdays: [6, 1, 0, 6],
      holidays: ['2026-10-03', '2026-10-01', '2026-10-01'],
      extraWorkdays: ['2026-09-26', '2026-09-20'],
    })
    assert.deepEqual(normalized, {
      version: 1,
      workdays: [0, 1, 6],
      holidays: ['2026-10-01', '2026-10-03'],
      extraWorkdays: ['2026-09-20', '2026-09-26'],
    })

    const calendar = createWorkingCalendar(normalized)
    assert.isFalse(isWorkingDay(calendar, parseIsoDate('2026-10-01')))
    assert.isTrue(isWorkingDay(calendar, parseIsoDate('2026-09-26')))
    assert.isTrue(isWorkingDay(calendar, parseIsoDate('2026-09-20')))
  })
})
