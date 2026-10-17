import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrRetentionApi } from '@/lib/api/ocr-retention'
import type {
  OcrRetentionPolicyUpdateRequest,
  OcrCleanupPreviewRequest,
  OcrCleanupExecuteRequest,
  OcrRetentionHoldSetRequest,
  OcrRetentionHoldReleaseRequest,
} from '@aiproj/types'

/**
 * OCR 保留治理——TanStack Query hooks（v3-ocr-result-persistence-and-retention §7.2）。
 *
 * 分层 query keys：
 * - ocr-retention/policy — 保留策略
 * - ocr-retention/status — 保留状态
 * - ocr-retention/accepted-extractions — accepted extraction 保留摘要
 * - ocr-retention/cleanup-preview — 清理预览
 * - ocr-retention/holds — hold 列表
 *
 * 权限感知：mutations 不做 client-side 权限判断，由后端 RBAC 判定。
 */

export const ocrRetentionKeys = {
  all: ['ocr-retention'] as const,
  policy: (projectId: number) => [...ocrRetentionKeys.all, 'policy', projectId] as const,
  status: (projectId: number) => [...ocrRetentionKeys.all, 'status', projectId] as const,
  acceptedExtractions: (projectId: number) =>
    [...ocrRetentionKeys.all, 'accepted-extractions', projectId] as const,
  holds: (projectId: number) => [...ocrRetentionKeys.all, 'holds', projectId] as const,
}

// ── 策略 ──

/** 读取项目 OCR 保留策略 */
export function useOcrRetentionPolicy(projectId: number) {
  return useQuery({
    queryKey: ocrRetentionKeys.policy(projectId),
    queryFn: () => ocrRetentionApi.readPolicy(projectId),
    enabled: projectId > 0,
    staleTime: 30_000,
  })
}

/** 更新项目 OCR 保留策略 */
export function useUpdateOcrRetentionPolicy(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrRetentionPolicyUpdateRequest) =>
      ocrRetentionApi.updatePolicy(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.policy(projectId) })
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.status(projectId) })
    },
  })
}

// ── 状态 ──

/** 读取项目 OCR 保留状态 */
export function useOcrRetentionStatus(projectId: number) {
  return useQuery({
    queryKey: ocrRetentionKeys.status(projectId),
    queryFn: () => ocrRetentionApi.getStatus(projectId),
    enabled: projectId > 0,
    staleTime: 15_000,
  })
}

// ── accepted extraction 保留摘要 ──

/** 读取 accepted extraction 保留摘要 */
export function useOcrAcceptedExtractionRetentionSummaries(projectId: number) {
  return useQuery({
    queryKey: ocrRetentionKeys.acceptedExtractions(projectId),
    queryFn: () => ocrRetentionApi.getAcceptedExtractions(projectId),
    enabled: projectId > 0,
    staleTime: 30_000,
  })
}

// ── cleanup ──

/** 清理预览 */
export function useOcrCleanupPreview(projectId: number) {
  return useMutation({
    mutationFn: (input?: OcrCleanupPreviewRequest) =>
      ocrRetentionApi.previewCleanup(projectId, input),
  })
}

/** 清理执行 */
export function useOcrCleanupExecute(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrCleanupExecuteRequest) =>
      ocrRetentionApi.executeCleanup(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.status(projectId) })
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.acceptedExtractions(projectId) })
    },
  })
}

// ── holds ──

/** 列出项目 hold */
export function useOcrRetentionHolds(projectId: number) {
  return useQuery({
    queryKey: ocrRetentionKeys.holds(projectId),
    queryFn: () => ocrRetentionApi.listHolds(projectId),
    enabled: projectId > 0,
    staleTime: 15_000,
  })
}

/** 设置 hold */
export function useSetOcrRetentionHold(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrRetentionHoldSetRequest) => ocrRetentionApi.setHold(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.holds(projectId) })
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.status(projectId) })
    },
  })
}

/** 释放 hold */
export function useReleaseOcrRetentionHold(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrRetentionHoldReleaseRequest) =>
      ocrRetentionApi.releaseHold(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.holds(projectId) })
      queryClient.invalidateQueries({ queryKey: ocrRetentionKeys.status(projectId) })
    },
  })
}
