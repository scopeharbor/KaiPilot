'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { trizRationaleApi, trizRationaleKeys } from '@/lib/api/triz-rationale'
import type { RationaleFeedbackRequest, RationaleHandoffRequest } from '@aiproj/types'

/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由 React Hooks。
 *
 * 读取 hooks 使用 useQuery，确保启用的项目ID有效。
 * 反馈和 handoff 使用 useMutation 以支持乐观 UI。
 *
 * 红线：
 * - 读取 hook 绝不触发 hidden mutations
 * - feedback 不修改正式业务数据
 * - handoff 只创建待审上下文，不自动落库
 */

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/** 获取 TRIZ 推荐理由详情（只读）。 */
export function useTrizRationaleDetail(
  projectId: number,
  targetType: string | null,
  targetId: string | null,
) {
  return useQuery({
    queryKey: trizRationaleKeys.detail(projectId, targetType!, targetId!),
    queryFn: () => trizRationaleApi.detail(projectId, targetType!, targetId!),
    enabled: Number.isFinite(projectId) && projectId > 0 && !!targetType && !!targetId,
    staleTime: 30_000, // 30s 内不重新请求
    refetchOnWindowFocus: false, // 避免 Dashboard/通知挂载时触发 hidden 调用
  })
}

/** 获取 Dashboard TRIZ 推荐理由摘要（只读，不触发生成）。 */
export function useTrizRationaleDashboardSummary(projectId: number) {
  return useQuery({
    queryKey: trizRationaleKeys.dashboardSummary(projectId),
    queryFn: () => trizRationaleApi.dashboardSummary(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/** 提交推荐理由反馈（非业务操作）。 */
export function useTrizRationaleFeedback(projectId: number) {
  return useMutation({
    mutationFn: ({
      targetType,
      targetId,
      payload,
    }: {
      targetType: string
      targetId: string
      payload: RationaleFeedbackRequest
    }) => trizRationaleApi.feedback(projectId, targetType, targetId, payload),
  })
}

/** 从推荐理由面板进入 Draft Layer 审查。 */
export function useTrizRationaleHandoff(projectId: number) {
  return useMutation({
    mutationFn: ({
      targetType,
      targetId,
      payload,
    }: {
      targetType: string
      targetId: string
      payload?: RationaleHandoffRequest
    }) => trizRationaleApi.handoff(projectId, targetType, targetId, payload),
  })
}

export default {
  useTrizRationaleDetail,
  useTrizRationaleDashboardSummary,
  useTrizRationaleFeedback,
  useTrizRationaleHandoff,
}
