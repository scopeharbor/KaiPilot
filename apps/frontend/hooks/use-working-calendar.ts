'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { calendarKeys } from '@/lib/api/calendar'
import { dependencyKeys } from '@/lib/api/dependencies'
import { kanbanKeys } from '@/lib/api/kanban'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { taskKeys } from '@/lib/api/tasks'
import { wbsKeys } from '@/lib/api/wbs'
import { ganttScheduleKeys } from '@/lib/api/gantt-scheduling'
import type { ApiError } from '@/lib/api-client'
import type { WorkingCalendarSettings } from '@aiproj/types'

export function useWorkingCalendar(projectId: number) {
  return useQuery({
    queryKey: projectKeys.workingCalendar(projectId),
    queryFn: () => projectsApi.getWorkingCalendar(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useUpdateWorkingCalendar(projectId: number) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (input: WorkingCalendarSettings) =>
      projectsApi.updateWorkingCalendar(projectId, input),
    onSuccess: async (calendar) => {
      queryClient.setQueryData(projectKeys.workingCalendar(projectId), calendar)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.views(projectId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) }),
        queryClient.invalidateQueries({ queryKey: calendarKeys.lists(projectId) }),
        queryClient.invalidateQueries({ queryKey: dependencyKeys.project(projectId) }),
        queryClient.invalidateQueries({ queryKey: kanbanKeys.columns(projectId) }),
        queryClient.invalidateQueries({ queryKey: wbsKeys.tree(projectId) }),
        queryClient.invalidateQueries({ queryKey: ganttScheduleKeys.project(projectId) }),
      ])
      toast({
        variant: 'success',
        title: '工作日历已保存',
        description: '相关视图会按新日历刷新，任务日期未自动改写。',
      })
    },
    onError: (error) => {
      const apiError = error as unknown as ApiError
      toast({
        variant: apiError.code === 'SCHEDULE_STALE' ? 'warning' : 'error',
        title: apiError.status === 409 ? '日历状态已变化' : '保存失败',
        description: apiError.message ?? '请检查工作日、节假日和调休日设置。',
      })
    },
  })
}
