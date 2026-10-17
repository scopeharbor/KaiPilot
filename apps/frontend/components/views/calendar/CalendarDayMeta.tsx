'use client'

import { createContext, useContext, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { dayWorkingStatus, type WorkingCalendarInfo } from '@/lib/calendar-working'
import { freezeWindowOn, lunarDayInfo, type FreezeWindow } from '@/lib/calendar-lunar'

/**
 * 日历格子的日期元信息：农历 / 节气 / 节日、法定节假日「休」与调休「班」、客户封网窗口。
 *
 * 项目自定义了工作日历（节假日 / 调休）时以项目设置为准；未自定义时显示国务院法定安排。
 * 只做展示，不改写任何任务日期。
 */
export interface CalendarDayContextValue {
  workingCalendar?: WorkingCalendarInfo
  changeFreezeWindows?: FreezeWindow[]
}

const CalendarDayContext = createContext<CalendarDayContextValue>({})

export const CalendarDayMetaProvider = CalendarDayContext.Provider

export interface DayMeta {
  lunarLabel: string
  lunarText: string
  highlight: boolean
  /** 'off' = 放假（休），'work' = 调休上班（班）。 */
  statutory: 'off' | 'work' | null
  statutoryName: string | null
  /** 休 / 班 的来源：项目自定义工作日历，或国务院法定安排。 */
  statutorySource: 'project' | 'statutory' | null
  nonWorking: boolean
  freeze: FreezeWindow | null
}

function hasCustomCalendar(calendar?: WorkingCalendarInfo): boolean {
  return !!calendar && (calendar.holidays.length > 0 || calendar.extraWorkdays.length > 0)
}

export function useDayMeta(dateISO: string): DayMeta {
  const { workingCalendar, changeFreezeWindows } = useContext(CalendarDayContext)
  return useMemo(() => {
    const lunar = lunarDayInfo(dateISO)
    const custom = hasCustomCalendar(workingCalendar)
    const status = dayWorkingStatus(workingCalendar, dateISO)
    let statutory: DayMeta['statutory'] = null
    let statutoryName: string | null = null
    let statutorySource: DayMeta['statutorySource'] = null
    let nonWorking = status.isNonWorking
    if (custom) {
      if (status.isHoliday) statutory = 'off'
      else if (status.isExtraWorkday) statutory = 'work'
      if (statutory) statutorySource = 'project'
    } else if (lunar.statutory) {
      statutory = lunar.statutory.work ? 'work' : 'off'
      statutoryName = lunar.statutory.name
      statutorySource = 'statutory'
      nonWorking = !lunar.statutory.work
    }
    return {
      lunarLabel: lunar.label,
      lunarText: lunar.lunarText,
      highlight: !!(lunar.festival || lunar.jieQi),
      statutory,
      statutoryName,
      statutorySource,
      nonWorking,
      freeze: freezeWindowOn(changeFreezeWindows, dateISO),
    }
  }, [dateISO, workingCalendar, changeFreezeWindows])
}

/** 格子右上角的农历短标签与「休 / 班 / 封网」角标。 */
export function DayMetaBadges({
  meta,
  className,
  omitProjectStatus = false,
}: {
  meta: DayMeta
  className?: string
  /** 视图自身已展示项目工作日历标签时置 true，避免重复显示。 */
  omitProjectStatus?: boolean
}) {
  const showStatutory =
    !!meta.statutory && !(omitProjectStatus && meta.statutorySource === 'project')
  const statutoryTitle =
    meta.statutory === 'off'
      ? `${meta.statutoryName ?? '节假日'}放假`
      : meta.statutory === 'work'
        ? `${meta.statutoryName ?? ''}调休上班`
        : undefined
  return (
    <span className={cn('flex items-center gap-1 min-w-0', className)}>
      <span
        className={cn(
          'text-[10px] leading-none truncate',
          meta.highlight ? 'text-primary' : 'text-muted-foreground',
        )}
        title={meta.lunarText}
      >
        {meta.lunarLabel}
      </span>
      {showStatutory && (
        <span
          className={cn(
            'text-[10px] leading-none px-0.5 rounded-sm font-medium shrink-0',
            meta.statutory === 'off'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-muted text-foreground',
          )}
          title={statutoryTitle}
          aria-label={statutoryTitle}
        >
          {meta.statutory === 'off' ? '休' : '班'}
        </span>
      )}
      {meta.freeze && (
        <span
          className="text-[10px] leading-none px-0.5 rounded-sm font-medium shrink-0 bg-warning/15 text-warning"
          title={`${meta.freeze.label}（${meta.freeze.start} ~ ${meta.freeze.end}），期间不安排生产变更`}
          aria-label={`${meta.freeze.label}，期间不安排生产变更`}
        >
          封网
        </span>
      )}
    </span>
  )
}
