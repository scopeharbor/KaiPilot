'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { ganttBaselineApi, ganttBaselineKeys } from '@/lib/api/gantt-baseline'

export function useGanttBaseline(projectId: number) {
  return useQuery({
    queryKey: ganttBaselineKeys.detail(projectId),
    queryFn: () => ganttBaselineApi.get(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useSaveGanttBaseline(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: () => ganttBaselineApi.save(projectId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ganttBaselineKeys.detail(projectId) })
      toast({ variant: 'success', title: '基线已保存' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '保存基线失败',
        description: (error as { message?: string }).message ?? '请检查权限后重试。',
      }),
  })
}
