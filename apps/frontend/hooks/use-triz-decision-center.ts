'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { trizDecisionCenterApi, trizDecisionCenterKeys } from '@/lib/api/triz-decision-center'
import { trizDecisionLogKeys } from '@/lib/api/triz-decision-log'

/**
 * v3-triz-decision-center —— TRIZ 决策中心 React Hooks（tasks 6.2）。
 *
 * 所有读取均无副作用，写入复用既有决策日志 hooks。
 */

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 获取决策中心摘要。 */
export function useTrizDecisionCenterSummary(projectId: number) {
  return useQuery({
    queryKey: trizDecisionCenterKeys.summary(projectId),
    queryFn: () => trizDecisionCenterApi.summary(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/** 获取决策中心队列列表。 */
export function useTrizDecisionCenterItems(projectId: number, filters?: Record<string, unknown>) {
  return useQuery({
    queryKey: trizDecisionCenterKeys.items(projectId, filters),
    queryFn: () => trizDecisionCenterApi.items(projectId, filters),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

/** 获取决策中心项详情。 */
export function useTrizDecisionCenterDetail(projectId: number, itemId: string | null) {
  return useQuery({
    queryKey: trizDecisionCenterKeys.detail(projectId, itemId!),
    queryFn: () => trizDecisionCenterApi.detail(projectId, itemId!),
    enabled: Number.isFinite(projectId) && projectId > 0 && !!itemId && itemId.length > 0,
  })
}

/** 获取 Draft readiness。 */
export function useTrizDecisionCenterReadiness(projectId: number) {
  return useQuery({
    queryKey: trizDecisionCenterKeys.readiness(projectId),
    queryFn: () => trizDecisionCenterApi.readiness(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

/**
 * 在决策日志写操作后失效决策中心缓存。
 * 应在 useCreateTrizDecisionLog / useSupersedeTrizDecisionLog 的 onSuccess 中调用。
 */
export function useInvalidateDecisionCenter(projectId: number) {
  // projectId 保留为 API 契约参数（未来可按项目粒度失效），当前按全局 key 失效。
  void projectId
  const qc = useQueryClient()

  return {
    invalidateAll: () => {
      qc.invalidateQueries({ queryKey: trizDecisionCenterKeys.all })
    },
    invalidateAfterDecisionWrite: () => {
      // 决策日志写入后，同时失效决策中心和决策日志缓存
      qc.invalidateQueries({ queryKey: trizDecisionCenterKeys.all })
      qc.invalidateQueries({ queryKey: trizDecisionLogKeys.all })
    },
  }
}
