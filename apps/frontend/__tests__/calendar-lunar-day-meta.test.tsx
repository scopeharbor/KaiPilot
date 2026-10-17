import { render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { describe, expect, test, vi } from 'vitest'
import { freezeWindowOn, lunarDayInfo } from '@/lib/calendar-lunar'
import { MonthView } from '@/components/views/calendar/MonthView'
import { DayView } from '@/components/views/calendar/DayView'
import { CalendarDayMetaProvider } from '@/components/views/calendar/CalendarDayMeta'

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

const FREEZE = [{ start: '2026-12-11', end: '2027-01-10', label: '封网：12月中旬至1月上旬' }]

function renderMonth(
  anchorDate: string,
  value: Parameters<typeof CalendarDayMetaProvider>[0]['value'],
) {
  return render(
    <CalendarDayMetaProvider value={value}>
      <DndContext>
        <MonthView
          tasksByDate={new Map()}
          anchorDate={anchorDate}
          canUpdate={false}
          onDateClick={vi.fn()}
          onTaskClick={vi.fn()}
        />
      </DndContext>
    </CalendarDayMetaProvider>,
  )
}

function cellOf(date: string): HTMLElement {
  return screen.getByRole('button', { name: `${date} 的任务` }).closest('[data-non-working], div')!
    .parentElement as HTMLElement
}

describe('lunarDayInfo', () => {
  test('国庆放假、调休上班、春节、节气', () => {
    expect(lunarDayInfo('2026-10-01').statutory).toEqual({ name: '国庆节', work: false })
    expect(lunarDayInfo('2026-10-01').label).toBe('国庆节')
    expect(lunarDayInfo('2026-10-10').statutory).toEqual({ name: '国庆节', work: true })
    expect(lunarDayInfo('2026-02-17').label).toBe('春节')
    expect(lunarDayInfo('2026-10-23').jieQi).toBe('霜降')
    expect(lunarDayInfo('2026-10-12').lunarText).toMatch(/^农历/)
  })

  test('封网窗口按日期命中（含首尾）', () => {
    expect(freezeWindowOn(FREEZE, '2026-12-11')?.label).toContain('封网')
    expect(freezeWindowOn(FREEZE, '2027-01-10')).not.toBeNull()
    expect(freezeWindowOn(FREEZE, '2027-01-11')).toBeNull()
  })
})

describe('日历格子的农历 / 休班 / 封网标记', () => {
  test('默认工作日历：显示法定「休」「班」与农历标签', () => {
    renderMonth('2026-10-15', {})
    const holiday = cellOf('2026-10-01')
    expect(within(holiday).getByLabelText('国庆节放假')).toHaveTextContent('休')
    expect(within(cellOf('2026-10-10')).getByLabelText('国庆节调休上班')).toHaveTextContent('班')
    expect(within(cellOf('2026-10-23')).getByText('霜降')).toBeInTheDocument()
  })

  test('封网期间的格子带「封网」角标', () => {
    renderMonth('2026-12-15', { changeFreezeWindows: FREEZE })
    expect(within(cellOf('2026-12-15')).getByText('封网')).toBeInTheDocument()
    expect(within(cellOf('2026-12-08')).queryByText('封网')).toBeNull()
  })

  test('项目自定义了工作日历时以项目设置为准，不再叠加法定安排', () => {
    renderMonth('2026-10-15', {
      workingCalendar: { workdays: [1, 2, 3, 4, 5], holidays: ['2026-10-20'], extraWorkdays: [] },
    })
    expect(within(cellOf('2026-10-01')).queryByText('休')).toBeNull()
    expect(within(cellOf('2026-10-20')).getByText('休')).toBeInTheDocument()
  })

  test('日视图顶部显示农历与封网说明', () => {
    render(
      <CalendarDayMetaProvider value={{ changeFreezeWindows: FREEZE }}>
        <DayView tasks={[]} date="2026-12-20" canUpdate={false} onTaskClick={vi.fn()} />
      </CalendarDayMetaProvider>,
    )
    expect(screen.getByText(/^农历/)).toBeInTheDocument()
    expect(screen.getByText(/期间不安排生产变更/)).toBeInTheDocument()
  })
})
