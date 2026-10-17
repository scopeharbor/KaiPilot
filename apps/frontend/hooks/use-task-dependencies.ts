'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { dependenciesApi, dependencyKeys, type CreateDependencyInput } from '@/lib/api/dependencies'
import { taskKeys } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

function invalidateTaskDependencyData(
  client: ReturnType<typeof useQueryClient>,
  projectId: number,
  taskId: number,
) {
  void client.invalidateQueries({ queryKey: dependencyKeys.task(projectId, taskId) })
  void client.invalidateQueries({ queryKey: dependencyKeys.project(projectId) })
  void client.invalidateQueries({ queryKey: taskKeys.detail(projectId, taskId) })
  // 加/删依赖会顺延后续任务日期：所有视图（甘特 / 日历 / 看板 / WBS / 时间线）一起刷新
  void invalidateTaskQueries(client, projectId)
}

export function useCreateProjectDependency(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ successorId, input }: { successorId: number; input: CreateDependencyInput }) =>
      dependenciesApi.create(projectId, successorId, input),
    onSuccess: (_dependency, variables) => {
      invalidateTaskDependencyData(client, projectId, variables.successorId)
      toast({ variant: 'success', title: '依赖关系已添加' })
    },
    onError: (error) => {
      const message = (error as { message?: string }).message ?? '请检查任务与权限后重试。'
      toast({
        variant: 'error',
        title: message.includes('循环') ? '无法添加：将形成循环依赖' : '添加依赖失败',
        description: message,
      })
    },
  })
}

export function useTaskDependencies(projectId: number, taskId: number) {
  return useQuery({
    queryKey: dependencyKeys.task(projectId, taskId),
    queryFn: () => dependenciesApi.list(projectId, taskId),
    enabled: projectId > 0 && taskId > 0,
  })
}

export function useCreateDependency(projectId: number, taskId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (input: CreateDependencyInput) => dependenciesApi.create(projectId, taskId, input),
    onSuccess: () => {
      invalidateTaskDependencyData(client, projectId, taskId)
      toast({ variant: 'success', title: '依赖关系已添加' })
    },
    onError: (error) => {
      const message = (error as { message?: string }).message ?? '请检查任务与权限后重试。'
      toast({
        variant: 'error',
        title: message.includes('循环') ? '无法添加：将形成循环依赖' : '添加依赖失败',
        description: message,
      })
    },
  })
}

export function useDeleteDependency(projectId: number, taskId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: dependenciesApi.delete,
    onSuccess: () => {
      invalidateTaskDependencyData(client, projectId, taskId)
      toast({ variant: 'success', title: '依赖关系已解除' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '解除依赖失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}
