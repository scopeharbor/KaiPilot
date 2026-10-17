'use client'

/**
 * v3-copilot-productized-operating-entry —— readiness 服务端态 hook（任务 4.1）。
 *
 * readiness、最近会话摘要与 quick starts 都是**服务端派生态**，走 TanStack Query
 * 管理缓存/失效/重试；面板开合、草稿与显式演示选择继续归 Copilot store（design D5）。
 *
 * 红线：
 * - query key 绑定 organization + project scope，scope 变化即换 key——
 *   旧 scope 的响应**不可能**落到新 scope 的缓存槽；
 * - 不持久化 readiness（授权/安装/兼容性状态会过期，本地持久化会把 stale 当 ready）；
 * - 权限/校验类错误不重试（重试只会重复失败并放大审计噪声）。
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { classifyCopilotEntryFailure } from '@aiproj/types'
import type { CopilotEntryReadinessSnapshot } from '@aiproj/types'
import { copilotApi, copilotKeys, type CopilotReadinessScope } from '@/lib/api/copilot'
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'

/** readiness 重试上限（仅对可重试类别生效）。 */
export const COPILOT_READINESS_MAX_RETRIES = 2
/** 快照新鲜期：超过后重新获取（授权与安装态会变）。 */
export const COPILOT_READINESS_STALE_TIME_MS = 30_000

/**
 * 决定一次失败是否值得重试。
 *
 * 复用共享错误分类：权限/校验/冲突/stale 一律不重试；auth/限流/服务/未知按上限重试。
 */
export function shouldRetryCopilotReadiness(failureCount: number, error: unknown): boolean {
  if (failureCount >= COPILOT_READINESS_MAX_RETRIES) return false
  return classifyCopilotEntryFailure(error).retryable
}

/** 从当前路由推导项目 scope（`/projects/[id]` 及其子路由）。 */
export function useCopilotEntryProjectId(): number | null {
  const params = useParams<{ id?: string | string[] }>()
  const raw = Array.isArray(params?.id) ? params?.id[0] : params?.id
  if (typeof raw !== 'string') return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * 读取当前 actor + 组织（+ 可选项目）下的就绪快照。
 *
 * 无有效组织时不发请求：宿主无法判定任何前置条件，入口渲染 unavailable 由调用方负责。
 */
export function useCopilotReadiness(
  scopeOverride?: Partial<CopilotReadinessScope>,
): UseQueryResult<CopilotEntryReadinessSnapshot, unknown> {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const routeProjectId = useCopilotEntryProjectId()

  const scope: CopilotReadinessScope = {
    organizationId: scopeOverride?.organizationId ?? organizationId,
    projectId: scopeOverride?.projectId ?? routeProjectId,
  }

  return useQuery({
    queryKey: copilotKeys.readiness(scope),
    queryFn: () => copilotApi.readiness(scope),
    enabled: (scope.organizationId ?? 0) > 0,
    staleTime: COPILOT_READINESS_STALE_TIME_MS,
    // 授权状态属服务端事实：窗口重新聚焦时重新求值，避免用 stale 快照放行提交。
    refetchOnWindowFocus: true,
    retry: shouldRetryCopilotReadiness,
  })
}
