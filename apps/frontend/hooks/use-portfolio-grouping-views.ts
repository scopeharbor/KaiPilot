import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  portfolioGroupingViewKeys,
  fetchGroupingViewList,
  fetchGroupingViewDetail,
  previewGroupingView,
  createGroupingView,
  updateGroupingView,
  deleteGroupingView,
  duplicateGroupingView,
  setDefaultGroupingView,
} from '@/lib/api/portfolio-grouping-views'
import type {
  PmoGroupingViewListQuery,
  PmoGroupingViewPreviewRequest,
  PmoGroupingViewCreateRequest,
  PmoGroupingViewUpdateRequest,
  PmoGroupingViewSetDefaultRequest,
} from '@aiproj/types'

/** 获取分组视图列表 */
export function useGroupingViewList(query?: PmoGroupingViewListQuery) {
  return useQuery({
    queryKey: portfolioGroupingViewKeys.list(query),
    queryFn: () => fetchGroupingViewList(query),
    staleTime: 60_000,
  })
}

/** 获取分组视图详情 */
export function useGroupingViewDetail(id: string | undefined) {
  return useQuery({
    queryKey: portfolioGroupingViewKeys.detail(id!),
    queryFn: () => fetchGroupingViewDetail(id!),
    staleTime: 120_000,
    enabled: !!id,
  })
}

/** 预览分组视图 */
export function useGroupingViewPreview() {
  return useMutation({
    mutationFn: (body: PmoGroupingViewPreviewRequest) => previewGroupingView(body),
  })
}

/** 创建分组视图 */
export function useGroupingViewCreate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PmoGroupingViewCreateRequest) => createGroupingView(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioGroupingViewKeys.all })
    },
  })
}

/** 更新分组视图 */
export function useGroupingViewUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PmoGroupingViewUpdateRequest }) =>
      updateGroupingView(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioGroupingViewKeys.all })
    },
  })
}

/** 删除分组视图 */
export function useGroupingViewDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteGroupingView(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioGroupingViewKeys.all })
    },
  })
}

/** 复制分组视图 */
export function useGroupingViewDuplicate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      duplicateGroupingView(id, name ? { name } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioGroupingViewKeys.all })
    },
  })
}

/** 设置默认视图 */
export function useGroupingViewSetDefault() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PmoGroupingViewSetDefaultRequest }) =>
      setDefaultGroupingView(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioGroupingViewKeys.all })
    },
  })
}
