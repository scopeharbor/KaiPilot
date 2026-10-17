'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import type { CalendarFilters } from '@/lib/api/calendar'
import { myCalendarApi, myCalendarKeys } from '@/lib/api/my-calendar'

/**
 * 「我的日历」排程查询：与 `useProjectCalendarSchedule` 同签名，日历镜头可直接换用
 * （第一个参数不用——跨项目，只看指派给当前用户的任务）。
 */
export function useMyCalendarSchedule(_projectId: number | null, filters: CalendarFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const dateFrom = filters.dateFrom ?? filters.anchorDate
  const dateTo = filters.dateTo ?? filters.anchorDate
  return useQuery({
    queryKey: myCalendarKeys.window(dateFrom, dateTo),
    queryFn: () => myCalendarApi.list(dateFrom, dateTo),
    enabled: isAuthenticated,
    placeholderData: (prev) => prev,
  })
}
