'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import {
  wbsApi,
  wbsKeys,
  type CreateWbsNodeInput,
  type MoveWbsNodeInput,
  type UpdateWbsNodeInput,
  type WbsNode,
} from '@/lib/api/wbs'
import { moveWbsOptimistically } from '@/lib/wbs-tree'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

export function useWbsTree(projectId: number) {
  return useQuery({
    queryKey: wbsKeys.tree(projectId),
    queryFn: () => wbsApi.tree(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

export function useCreateWbsNode(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateWbsNodeInput) => wbsApi.create(projectId, input),
    // WBS 编码 / 结构变化会反映在甘特、列表等任务视图里，一起刷新（含 WBS 树本身）
    onSuccess: () => invalidateTaskQueries(client, projectId),
  })
}

export function useUpdateWbsNode(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId, input }: { nodeId: number; input: UpdateWbsNodeInput }) =>
      wbsApi.update(projectId, nodeId, input),
    onMutate: async ({ nodeId, input }) => {
      await client.cancelQueries({ queryKey: wbsKeys.tree(projectId) })
      const previous = client.getQueryData<WbsNode[]>(wbsKeys.tree(projectId))
      client.setQueryData<WbsNode[]>(wbsKeys.tree(projectId), (nodes = []) =>
        nodes.map((node) => (node.id === nodeId ? { ...node, ...input } : node)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(wbsKeys.tree(projectId), context.previous)
    },
    onSettled: () => invalidateTaskQueries(client, projectId),
  })
}

export function useMoveWbsNode(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ nodeId, input }: { nodeId: number; input: MoveWbsNodeInput }) =>
      wbsApi.move(projectId, nodeId, input),
    onMutate: async ({ nodeId, input }) => {
      await client.cancelQueries({ queryKey: wbsKeys.tree(projectId) })
      const previous = client.getQueryData<WbsNode[]>(wbsKeys.tree(projectId))
      client.setQueryData<WbsNode[]>(wbsKeys.tree(projectId), (nodes = []) =>
        moveWbsOptimistically(nodes, nodeId, input),
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(wbsKeys.tree(projectId), context.previous)
      toast({
        variant: 'error',
        title: '移动失败，已恢复原位置',
        description: (error as { message?: string }).message ?? '请检查层级或权限后重试。',
      })
    },
    onSettled: () => invalidateTaskQueries(client, projectId),
  })
}

export function useDeleteWbsNode(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (nodeId: number) => wbsApi.delete(projectId, nodeId),
    // WBS 编码 / 结构变化会反映在甘特、列表等任务视图里，一起刷新（含 WBS 树本身）
    onSuccess: () => invalidateTaskQueries(client, projectId),
  })
}
