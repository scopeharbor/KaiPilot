import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrReviewApi } from '@/lib/api/ocr-review'
import type { OcrConfirmationPreviewRequest, OcrConfirmationSaveRequest } from '@aiproj/types'

/**
 * OCR 审查确认流——TanStack Query hooks（v3-ocr-review-confirmation-flow §7.2–7.3）。
 */

export const ocrReviewKeys = {
  all: ['ocr-review'] as const,
  review: (projectId: number, jobId: number) =>
    [...ocrReviewKeys.all, 'review', projectId, jobId] as const,
  acceptedExtractions: (projectId: number, jobId: number) =>
    [...ocrReviewKeys.all, 'accepted-extractions', projectId, jobId] as const,
}

/** 获取 OCR 审查详情 */
export function useOcrReviewDetail(projectId: number, jobId: number, enabled = true) {
  return useQuery({
    queryKey: ocrReviewKeys.review(projectId, jobId),
    queryFn: () => ocrReviewApi.review(projectId, jobId),
    enabled: enabled && projectId > 0 && jobId > 0,
    staleTime: 30_000,
  })
}

/** 获取已接受提取列表 */
export function useOcrAcceptedExtractions(
  projectId: number,
  jobId: number,
  params?: { sourceKind?: string; sourceId?: number; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: [...ocrReviewKeys.acceptedExtractions(projectId, jobId), params],
    queryFn: () => ocrReviewApi.acceptedExtractions(projectId, jobId, params),
    enabled: projectId > 0 && jobId > 0,
  })
}

/** 确认预览 mutation */
export function useOcrConfirmationPreview(projectId: number, jobId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrConfirmationPreviewRequest) =>
      ocrReviewApi.confirmationPreview(projectId, jobId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrReviewKeys.review(projectId, jobId) })
    },
  })
}

/** 确认保存 mutation */
export function useOcrConfirmationSave(projectId: number, jobId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrConfirmationSaveRequest) =>
      ocrReviewApi.confirmationSave(projectId, jobId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrReviewKeys.all })
      // Also invalidate file/detail queries
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
