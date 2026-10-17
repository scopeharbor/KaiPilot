'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import {
  milestonesApi,
  milestoneKeys,
  type CreateMilestoneInput,
  type MilestoneListFilters,
  type UpdateMilestoneInput,
} from '@/lib/api/milestones'

/**
 * 里程碑列表查询（管理 Drawer + 甘特共用同一份缓存，写操作后统一失效）。
 * `milestoneKeys.list(projectId, {})` 亦是甘特 model 的里程碑数据源键（use-project-gantt 6.1）。
 */
export function useMilestones(projectId: number, filters: MilestoneListFilters = {}) {
  return useQuery({
    queryKey: milestoneKeys.list(projectId, filters),
    queryFn: () => milestonesApi.list(projectId, filters),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/** 写操作后失效该项目全部里程碑列表（含甘特 model 用的空 filters 列表）。 */
function invalidateMilestones(client: ReturnType<typeof useQueryClient>, projectId: number) {
  void client.invalidateQueries({ queryKey: milestoneKeys.lists(projectId) })
}

export function useCreateMilestone(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => milestonesApi.create(projectId, input),
    onSuccess: () => {
      invalidateMilestones(client, projectId)
      toast({ variant: 'success', title: '里程碑已创建' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '创建里程碑失败',
        description: (error as { message?: string }).message ?? '请检查输入与权限后重试。',
      }),
  })
}

export function useUpdateMilestone(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ milestoneId, input }: { milestoneId: number; input: UpdateMilestoneInput }) =>
      milestonesApi.update(milestoneId, input),
    onSuccess: (_milestone, variables) => {
      invalidateMilestones(client, projectId)
      void client.invalidateQueries({ queryKey: milestoneKeys.detail(variables.milestoneId) })
      toast({ variant: 'success', title: '里程碑已更新' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '更新里程碑失败',
        description: (error as { message?: string }).message ?? '请检查输入与权限后重试。',
      }),
  })
}

export function useDeleteMilestone(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (milestoneId: number) => milestonesApi.delete(milestoneId),
    onSuccess: () => {
      invalidateMilestones(client, projectId)
      toast({ variant: 'success', title: '里程碑已删除' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '删除里程碑失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}
