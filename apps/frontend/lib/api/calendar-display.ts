import type {
  CalendarDisplayLayer,
  CalendarDisplayResolution,
  CalendarSystemId,
} from '@aiproj/types'
import { apiFetch } from '@/lib/api-client'

/** 日历曆法显示设定（个人 > 项目 > 组织 > 系统默认）。 */
export const calendarDisplayApi = {
  get: (projectId?: number | null) =>
    apiFetch<CalendarDisplayResolution>(
      `/settings/calendar-display${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  /** 改某一层；systems=null 表示清除、改为继承上层。 */
  update: (input: {
    layer: CalendarDisplayLayer
    systems: CalendarSystemId[] | null
    projectId?: number | null
  }) =>
    apiFetch<CalendarDisplayResolution>('/settings/calendar-display', {
      method: 'PUT',
      body: JSON.stringify({
        layer: input.layer,
        systems: input.systems,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      }),
    }),
}

export const calendarDisplayKeys = {
  all: ['calendar-display'] as const,
  detail: (projectId?: number | null) =>
    [...calendarDisplayKeys.all, projectId ?? 'global'] as const,
}
