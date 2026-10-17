'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { tasksApi } from '@/lib/api/tasks'
import { milestonesApi } from '@/lib/api/milestones'
import { ganttBaselineKeys } from '@/lib/api/gantt-baseline'
import { invalidateTaskQueries, invalidateMilestoneQueries } from '@/lib/task-query-invalidation'

/**
 * 里程碑目标日期确认写入（task 2.5）。只改 `plannedDate`，成功后刷新
 * 甘特 / 里程碑 / Calendar / 基线 / 项目摘要相关 query（复用 `invalidateMilestoneQueries` + 基线）。
 * 单独成 hook 便于组件测试隔离 mock（与 `useGanttSchedule` / 依赖 mutation 同一模式）。
 */
export function useAdjustMilestoneDate(projectId: number) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ milestoneId, plannedDate }: { milestoneId: number; plannedDate: string }) =>
      milestonesApi.update(milestoneId, { plannedDate }),
    onSuccess: async () => {
      await invalidateMilestoneQueries(queryClient, projectId)
      await queryClient.invalidateQueries({ queryKey: ganttBaselineKeys.detail(projectId) })
      toast({ variant: 'success', title: '里程碑日期已更新' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '更新里程碑日期失败',
        description: (error as { message?: string }).message ?? '请检查权限后重试。',
      }),
  })
}

/**
 * 任务进度确认写入（task 2.6）。只改 `progressPercent`（0..100），复用任务查询失效规则；
 * **禁止**隐式改动任务起止日期、依赖、里程碑或基线快照。progress 入参为 0..1。
 */
export function useAdjustTaskProgress(projectId: number) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ taskId, progress }: { taskId: number; progress: number }) =>
      tasksApi.update(projectId, taskId, {
        progressPercent: Math.round(Math.max(0, Math.min(1, progress)) * 100),
      }),
    onSuccess: async () => {
      await invalidateTaskQueries(queryClient, projectId)
      toast({ variant: 'success', title: '任务进度已更新' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '更新任务进度失败',
        description: (error as { message?: string }).message ?? '请检查权限后重试。',
      }),
  })
}
