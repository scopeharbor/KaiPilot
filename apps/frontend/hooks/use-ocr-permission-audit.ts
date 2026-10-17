import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  ocrPermissionAuditApi,
  type OcrPermissionStatusQuery,
  type OcrDecisionPreviewRequest,
  type OcrAuditSummaryQueryInput,
} from '@/lib/api/ocr-permission-audit'

/**
 * OCR 权限/审计——TanStack Query hooks（v3-ocr-permission-and-audit §7.2）。
 *
 * 分层 query keys：
 * - ocr-permission-audit/status — 权限状态
 * - ocr-permission-audit/decision-preview — 决策预览（mutation）
 * - ocr-permission-audit/audit-summaries — 审计摘要分页
 *
 * 权限感知：所有 mutation/动作执行一律以服务端 resolver 输出为准，
 * 不做 client-side 权限信任（§5.5）。
 */

export const ocrPermissionAuditKeys = {
  all: ['ocr-permission-audit'] as const,
  status: (projectId: number, query?: OcrPermissionStatusQuery) =>
    [...ocrPermissionAuditKeys.all, 'status', projectId, query ?? null] as const,
  auditSummaries: (projectId: number, query: OcrAuditSummaryQueryInput) =>
    [...ocrPermissionAuditKeys.all, 'audit-summaries', projectId, query] as const,
}

// ── 权限状态 ──

/** 读取项目 OCR 权限状态（低敏：allowed/blocked 动作 + 原因码 + 决策哈希） */
export function useOcrPermissionStatus(projectId: number, query?: OcrPermissionStatusQuery) {
  return useQuery({
    queryKey: ocrPermissionAuditKeys.status(projectId, query),
    queryFn: () => ocrPermissionAuditApi.getStatus(projectId, query),
    enabled: projectId > 0,
    staleTime: 15_000,
  })
}

// ── 决策预览 ──

/**
 * 单动作决策预览（服务端重验证）。
 * 用于在执行敏感动作前确认是否放行；被拒返回低敏原因码。
 */
export function useOcrDecisionPreview(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrDecisionPreviewRequest) =>
      ocrPermissionAuditApi.previewDecision(projectId, input),
    onSuccess: () => {
      // 决策预览可能改变状态（例如 hold/retention 变化）→ 失效状态缓存
      queryClient.invalidateQueries({ queryKey: ocrPermissionAuditKeys.status(projectId) })
    },
  })
}

// ── 审计摘要 ──

/**
 * 只读审计摘要分页查询（有界：perPage 上限 100、时间窗上限 90 天）。
 * 仅供有 audit_read 权限用户；无权限由后端返回 403。
 */
export function useOcrAuditSummaries(projectId: number, query: OcrAuditSummaryQueryInput) {
  return useQuery({
    queryKey: ocrPermissionAuditKeys.auditSummaries(projectId, query),
    queryFn: () => ocrPermissionAuditApi.queryAuditSummaries(projectId, query),
    enabled: projectId > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
