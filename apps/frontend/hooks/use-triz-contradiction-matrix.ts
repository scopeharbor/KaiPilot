'use client'

// @aiproj/frontend — V3 TRIZ 矛盾矩阵审查 UI TanStack Query hooks
// v3-triz-contradiction-matrix-ui / design D6 / tasks §5.2, §5.3
//
// 读取 hooks：使用 enabledProject(projectId)、稳定筛选器序列化、短 staleTime、显式失效。
// 状态管理：服务端数据走 TanStack Query；本地 UI 选择/筛选偏好走组件状态或轻量 Zustand UI store。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  trizContradictionMatrixApi,
  trizContradictionMatrixKeys,
} from '@/lib/api/triz-contradiction-matrix'
import type { MatrixFilters, MatrixHandoffInput } from '@aiproj/types'

/**
 * v3-triz-contradiction-matrix-ui —— TanStack Query hooks。
 *
 * 读取 hooks 不触发 handoff；handoff 用 mutation 并显式失效矩阵缓存。
 */

function enabledProject(projectId: number) {
  return Number.isFinite(projectId) && projectId > 0
}

function invalidateMatrix(client: ReturnType<typeof useQueryClient>, projectId: number) {
  client.invalidateQueries({ queryKey: trizContradictionMatrixKeys.all })
  client.invalidateQueries({ queryKey: ['projects', projectId, 'dashboard'] })
}

/**
 * 读取矛盾矩阵 DTO。
 * - enabledProject(projectId)：projectId 非法时不查询。
 * - 稳定筛选器序列化：保证相同筛选器命中同一缓存。
 * - 短 staleTime：矛盾数据可能随时变化，30 秒后标记为 stale。
 */
export function useTrizContradictionMatrix(projectId: number, filters: MatrixFilters = {}) {
  return useQuery({
    queryKey: trizContradictionMatrixKeys.matrix(projectId, filters),
    queryFn: () => trizContradictionMatrixApi.getMatrix(projectId, filters),
    enabled: enabledProject(projectId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

/**
 * 提交 handoff（选中单元/物理矛盾作为候选输入）。
 * 成功后失效矩阵缓存与项目 dashboard。
 */
export function useTrizContradictionMatrixHandoff(projectId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: MatrixHandoffInput) => trizContradictionMatrixApi.handoff(projectId, input),
    onSuccess: () => invalidateMatrix(client, projectId),
  })
}
