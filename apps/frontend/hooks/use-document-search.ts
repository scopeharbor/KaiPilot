/**
 * 文档搜索索引状态 TanStack Query hook（v3-document-full-text-search §10.5）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { documentSearchApi, documentSearchKeys } from '@/lib/api/document-search'
import { searchKeys } from '@/lib/api/search'

/**
 * 获取项目文档搜索索引状态。
 */
export function useDocumentSearchStatus(projectId: number) {
  return useQuery({
    queryKey: documentSearchKeys.status(projectId),
    queryFn: () => documentSearchApi.status(projectId),
    enabled: projectId > 0,
  })
}

/**
 * 触发文档搜索索引重建。
 */
export function useReindexDocumentSearch(projectId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (full: boolean) => documentSearchApi.reindex(projectId, full),
    onSuccess: () => {
      // 重建后刷新索引状态
      qc.invalidateQueries({ queryKey: documentSearchKeys.status(projectId) })
      // 搜索结果也可能因重建而变化
      qc.invalidateQueries({ queryKey: searchKeys.all })
    },
  })
}
