'use client'

/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板与统计 React Hooks（5.1 P1）。
 *
 * 一次性密钥仅在模板应用（apply）成功态返回，调用方须立即展示并在用户 dismiss 后清空。
 * 统计 hooks 支持 feature-off 状态渲染。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  outgoingWebhookTemplatesApi,
  outgoingWebhookStatsApi,
  outgoingWebhookTemplateKeys,
  outgoingWebhookStatsKeys,
} from '@/lib/api/outgoing-webhook-templates-and-stats'
import { useAuthStore } from '@/stores/auth-store'
import type { ApplyOutgoingWebhookTemplateRequest } from '@aiproj/types'

/** 模板列表 hook */
export function useOutgoingWebhookTemplates() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookTemplateKeys.list(),
    queryFn: () => outgoingWebhookTemplatesApi.list(),
    enabled: isAuthenticated,
  })
}

/** 模板详情 hook */
export function useOutgoingWebhookTemplateDetail(id: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookTemplateKeys.detail(id),
    queryFn: () => outgoingWebhookTemplatesApi.show(id),
    enabled: isAuthenticated && !!id,
  })
}

/** 模板预填 hook */
export function useOutgoingWebhookTemplatePrefill(id: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookTemplateKeys.prefill(id),
    queryFn: () => outgoingWebhookTemplatesApi.prefill(id),
    enabled: isAuthenticated && !!id,
  })
}

/** 模板应用 mutation */
export function useApplyOutgoingWebhookTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ApplyOutgoingWebhookTemplateRequest) =>
      outgoingWebhookTemplatesApi.apply(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outgoingWebhookTemplateKeys.list() })
      qc.invalidateQueries({ queryKey: outgoingWebhookStatsKeys.all })
    },
  })
}

/** 统计 hook */
export function useOutgoingWebhookStats(params?: { startDate?: string; endDate?: string }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return useQuery({
    queryKey: outgoingWebhookStatsKeys.index(params),
    queryFn: () => outgoingWebhookStatsApi.index(params),
    enabled: isAuthenticated,
    // 统计数据每 60 秒刷新一次
    refetchInterval: 60_000,
  })
}
