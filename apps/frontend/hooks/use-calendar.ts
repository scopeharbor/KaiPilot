'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { calendarApi, calendarKeys, type CalendarFilters } from '@/lib/api/calendar'

export function useProjectCalendar(projectId: number, filters: CalendarFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: calendarKeys.list(projectId, filters),
    queryFn: () => calendarApi.list(projectId, filters),
    enabled: isAuthenticated,
    placeholderData: (prev) => prev,
  })
}

/**
 * Calendar 完整（schedule）模式查询。
 * 返回派生日历项（任务区间 + 里程碑）、meta（含 unscheduledCount / truncated）与工作日历上下文。
 * query key 已含 filters（含 mode=schedule），与截止日模式缓存天然隔离。
 */
export function useProjectCalendarSchedule(projectId: number, filters: CalendarFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const scheduleFilters = { ...filters, mode: 'schedule' as const }

  return useQuery({
    queryKey: calendarKeys.list(projectId, scheduleFilters),
    queryFn: () => calendarApi.listSchedule(projectId, scheduleFilters),
    enabled: isAuthenticated,
    placeholderData: (prev) => prev,
  })
}
