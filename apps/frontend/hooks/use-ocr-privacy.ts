import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrPrivacyApi } from '@/lib/api/ocr-privacy'
import type {
  OcrPrivacyPolicyOverrideRequest,
  OcrPrivacyDecisionInput,
  OcrPrivacyCopyExportPreviewInput,
  OcrPrivacyCopyExportExecuteInput,
} from '@aiproj/types'

/**
 * OCR 隐私策略控制——TanStack Query hooks（v3-ocr-privacy-policy-controls §7.2）
 *
 * 分层 query keys：
 * - ocr-privacy/policy — 隐私策略
 * - ocr-privacy/status — 隐私状态
 * - ocr-privacy/runs — 复制/导出运行记录
 *
 * 权限感知：mutations 不做 client-side 权限判断，由后端 RBAC 判定。
 * 策略更新后自动 invalidate policy 和 status。
 */

export const ocrPrivacyKeys = {
  all: ['ocr-privacy'] as const,
  policy: (projectId: number) => [...ocrPrivacyKeys.all, 'policy', projectId] as const,
  status: (projectId: number) => [...ocrPrivacyKeys.all, 'status', projectId] as const,
  runs: (projectId: number) => [...ocrPrivacyKeys.all, 'runs', projectId] as const,
}

// ── 策略 ──

/** 读取项目 OCR 隐私策略 */
export function useOcrPrivacyPolicy(projectId: number) {
  return useQuery({
    queryKey: ocrPrivacyKeys.policy(projectId),
    queryFn: () => ocrPrivacyApi.readPolicy(projectId),
    enabled: projectId > 0,
    staleTime: 30_000,
  })
}

/** 更新项目 OCR 隐私策略 */
export function useUpdateOcrPrivacyPolicy(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrPrivacyPolicyOverrideRequest) =>
      ocrPrivacyApi.updatePolicy(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrPrivacyKeys.policy(projectId) })
      queryClient.invalidateQueries({ queryKey: ocrPrivacyKeys.status(projectId) })
    },
  })
}

// ── 状态 ──

/** 读取项目 OCR 隐私状态 */
export function useOcrPrivacyStatus(projectId: number) {
  return useQuery({
    queryKey: ocrPrivacyKeys.status(projectId),
    queryFn: () => ocrPrivacyApi.readStatus(projectId),
    enabled: projectId > 0,
    staleTime: 15_000,
  })
}

// ── 决策预览 ──

/** 隐私决策预览 mutation（写请求，不走 query） */
export function useOcrPrivacyDecisionPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrPrivacyDecisionInput) => ocrPrivacyApi.decisionPreview(projectId, input),
  })
}

// ── 导出预览 ──

/** 导出预览 mutation */
export function useOcrPrivacyExportPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrPrivacyCopyExportPreviewInput) =>
      ocrPrivacyApi.exportPreview(projectId, input),
  })
}

// ── 导出执行 ──

/** 导出执行 mutation（执行后 invalidate runs） */
export function useOcrPrivacyExportExecute(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrPrivacyCopyExportExecuteInput) =>
      ocrPrivacyApi.exportExecute(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrPrivacyKeys.runs(projectId) })
    },
  })
}

// ── 运行记录 ──

/** 列出运行记录（含轮询） */
export function useOcrPrivacyRuns(projectId: number) {
  return useQuery({
    queryKey: ocrPrivacyKeys.runs(projectId),
    queryFn: () => ocrPrivacyApi.listRuns(projectId),
    enabled: projectId > 0,
    refetchInterval: 15_000, // 运行状态可能变化
  })
}

/** 运行详情 */
export function useOcrPrivacyRunDetail(projectId: number, runId: number | null) {
  return useQuery({
    queryKey: [...ocrPrivacyKeys.runs(projectId), runId],
    queryFn: () => ocrPrivacyApi.runDetail(projectId, runId!),
    enabled: projectId > 0 && runId !== null,
  })
}
