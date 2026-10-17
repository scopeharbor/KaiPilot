import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { PersonalWorkingCalendar } from '@aiproj/types'
import type { CalendarFullResponse } from '@/lib/calendar-types'

/**
 * 日历第 3 批：「我的日历」（跨项目，只看指派给我的）与个人工作日历（休假 / 个人工作日）。
 */
export const myCalendarApi = {
  list: async (dateFrom: string, dateTo: string): Promise<CalendarFullResponse> => {
    const params = new URLSearchParams({ dateFrom, dateTo })
    const body = await apiFetchEnvelope<
      Omit<CalendarFullResponse, 'meta'> & {
        meta: { total: number; truncated: boolean; unscheduledCount: number } & Pick<
          CalendarFullResponse['meta'],
          'nearestScheduled'
        >
      }
    >(`/me/calendar?${params.toString()}`)
    return {
      ...body,
      meta: { ...body.meta, page: 1, perPage: body.meta.total, totalPages: 1 },
    }
  },
  getWorkingCalendar: () => apiFetch<PersonalWorkingCalendar>('/me/working-calendar'),
  updateWorkingCalendar: (input: PersonalWorkingCalendar) =>
    apiFetch<PersonalWorkingCalendar>('/me/working-calendar', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
}

export const myCalendarKeys = {
  all: ['my-calendar'] as const,
  window: (dateFrom: string, dateTo: string) => [...myCalendarKeys.all, dateFrom, dateTo] as const,
  workingCalendar: () => [...myCalendarKeys.all, 'working-calendar'] as const,
}
