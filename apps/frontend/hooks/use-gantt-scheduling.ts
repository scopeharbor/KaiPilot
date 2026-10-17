'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { ganttSchedulingApi, type GanttScheduleRequest } from '@/lib/api/gantt-scheduling'
import { dependencyKeys } from '@/lib/api/dependencies'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

export function useGanttSchedule(projectId: number) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (input: GanttScheduleRequest) => ganttSchedulingApi.execute(projectId, input),
    onSuccess: async (result) => {
      if (!result.committed) return
      await Promise.all([
        invalidateTaskQueries(queryClient, projectId),
        queryClient.invalidateQueries({ queryKey: dependencyKeys.project(projectId) }),
      ])
      toast({
        variant: 'success',
        title: '排程已更新',
        description: `已同步 ${result.changes.length} 个任务。`,
      })
    },
    onError: (error) => {
      const apiError = error as { code?: string; message?: string }
      toast({
        variant: apiError.code === 'SCHEDULE_STALE' ? 'warning' : 'error',
        title: apiError.code === 'SCHEDULE_STALE' ? '预览已过期' : '排程处理失败',
        description: apiError.message ?? '请稍后重试。',
      })
    },
  })
}
