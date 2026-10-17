'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import {
  customViewsApi,
  customViewsKeys,
  type CreateCustomViewRequest,
  type UpdateCustomViewRequest,
  type ReorderCustomViewsRequest,
  type CloneCustomViewRequest,
} from '@/lib/api/custom-views'

/**
 * 自定义视图列表查询（v2-custom-views-view-config）。
 */
export function useCustomViewsList(projectId: number) {
  return useQuery({
    queryKey: customViewsKeys.list(projectId),
    queryFn: () => customViewsApi.list(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/**
 * 自定义视图详情查询。
 */
export function useCustomView(projectId: number, viewId: number) {
  return useQuery({
    queryKey: customViewsKeys.detail(projectId, viewId),
    queryFn: () => customViewsApi.show(projectId, viewId),
    enabled: Number.isFinite(projectId) && projectId > 0 && Number.isFinite(viewId) && viewId > 0,
  })
}

/** 写操作后失效该项目全部视图列表 */
function invalidateLists(client: ReturnType<typeof useQueryClient>, projectId: number) {
  void client.invalidateQueries({ queryKey: customViewsKeys.list(projectId) })
}

/**
 * 创建自定义视图。
 */
export function useCreateCustomView(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (data: CreateCustomViewRequest) => customViewsApi.create(projectId, data),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '视图已保存' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '保存视图失败',
        description: (error as { message?: string }).message ?? '请检查输入与权限后重试。',
      }),
  })
}

/**
 * 更新自定义视图。
 */
export function useUpdateCustomView(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ viewId, data }: { viewId: number; data: UpdateCustomViewRequest }) =>
      customViewsApi.update(projectId, viewId, data),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '视图已更新' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '更新视图失败',
        description: (error as { message?: string }).message ?? '请检查输入与权限后重试。',
      }),
  })
}

/**
 * 删除自定义视图。
 */
export function useDeleteCustomView(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (viewId: number) => customViewsApi.destroy(projectId, viewId),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '视图已删除' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '删除视图失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}

/**
 * 克隆共享视图为个人视图。
 */
export function useCloneCustomView(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: ({ viewId, data }: { viewId: number; data?: CloneCustomViewRequest }) =>
      customViewsApi.clone(projectId, viewId, data),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '视图已克隆' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '克隆视图失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}

/**
 * 重新排列自定义视图顺序。
 */
export function useReorderCustomViews(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (data: ReorderCustomViewsRequest) => customViewsApi.reorder(projectId, data),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '视图顺序已更新' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '重排视图失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}

/**
 * 设置默认视图。
 */
export function useSetDefaultCustomView(projectId: number) {
  const client = useQueryClient()
  const { toast } = useToast()
  return useMutation({
    mutationFn: (viewId: number) => customViewsApi.setDefault(projectId, viewId),
    onSuccess: () => {
      invalidateLists(client, projectId)
      toast({ variant: 'success', title: '已设为默认视图' })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '设置默认视图失败',
        description: (error as { message?: string }).message ?? '请稍后重试。',
      }),
  })
}

/**
 * 获取当前用户在项目中的默认自定义视图 ID（v2-custom-views-view-config）。
 *
 * 从自定义视图列表中筛选 `isDefault === true` 的个人视图，返回其 ID。
 * 若无默认视图返回 `null`。
 * 继承 `useCustomViewsList` 的 loading / error / isSuccess 状态。
 */
export function useDefaultCustomViewId(projectId: number) {
  const listQuery = useCustomViewsList(projectId)

  const defaultViewId: number | null =
    listQuery.data?.personal?.find((v) => v.isDefault)?.id ?? null

  return {
    ...listQuery,
    data: defaultViewId,
  }
}
