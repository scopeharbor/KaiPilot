import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrDocumentApi } from '@/lib/api/ocr-document'
import type {
  OcrDocumentJobCreateRequest,
  OcrDocumentJobRetryRequest,
  OcrDocumentConfirmationRequest,
} from '@aiproj/types'

/**
 * OCR 文档上传流——TanStack Query hooks（v3-ocr-document-upload-flow §8.2–8.3）。
 */

export const ocrDocumentKeys = {
  all: ['ocr-document'] as const,
  list: (projectId: number) => [...ocrDocumentKeys.all, 'list', projectId] as const,
  detail: (projectId: number, jobId: number) =>
    [...ocrDocumentKeys.all, 'detail', projectId, jobId] as const,
  candidates: (projectId: number, jobId: number) =>
    [...ocrDocumentKeys.all, 'candidates', projectId, jobId] as const,
  extractions: (projectId: number, jobId: number) =>
    [...ocrDocumentKeys.all, 'extractions', projectId, jobId] as const,
}

/** 列出项目的 OCR 作业 */
export function useOcrDocumentJobs(
  projectId: number,
  params?: { page?: number; perPage?: number; status?: string; sort?: string },
) {
  return useQuery({
    queryKey: [...ocrDocumentKeys.list(projectId), params],
    queryFn: () => ocrDocumentApi.list(projectId, params),
    enabled: projectId > 0,
    staleTime: 10_000,
  })
}

/** 获取作业详情（含轮询，queued/processing 时每 5 秒刷新） */
export function useOcrDocumentJobDetail(projectId: number, jobId: number, enabled = true) {
  return useQuery({
    queryKey: ocrDocumentKeys.detail(projectId, jobId),
    queryFn: () => ocrDocumentApi.detail(projectId, jobId),
    enabled: enabled && projectId > 0 && jobId > 0,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      if (status === 'queued' || status === 'normalizing' || status === 'processing') {
        return 5_000
      }
      return false
    },
  })
}

/** 获取作业候选 */
export function useOcrDocumentCandidates(projectId: number, jobId: number, enabled = true) {
  return useQuery({
    queryKey: ocrDocumentKeys.candidates(projectId, jobId),
    queryFn: () => ocrDocumentApi.candidates(projectId, jobId),
    enabled: enabled && projectId > 0 && jobId > 0,
    staleTime: 15_000,
  })
}

/** 获取已接受提取 */
export function useOcrDocumentExtractions(projectId: number, jobId: number, enabled = true) {
  return useQuery({
    queryKey: ocrDocumentKeys.extractions(projectId, jobId),
    queryFn: () => ocrDocumentApi.extractions(projectId, jobId),
    enabled: enabled && projectId > 0 && jobId > 0,
    staleTime: 15_000,
  })
}

/** 创建 OCR 作业 mutation */
export function useOcrDocumentJobCreate(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrDocumentJobCreateRequest & { file?: File }) =>
      ocrDocumentApi.create(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.list(projectId) })
      queryClient.invalidateQueries({ queryKey: ['files'] })
    },
  })
}

/** 重试 OCR 作业 mutation */
export function useOcrDocumentJobRetry(projectId: number, jobId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrDocumentJobRetryRequest) =>
      ocrDocumentApi.retry(projectId, jobId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.detail(projectId, jobId) })
      queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.candidates(projectId, jobId) })
      queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.list(projectId) })
    },
  })
}

/** 确认 OCR 作业 mutation */
export function useOcrDocumentJobConfirm(projectId: number, jobId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: OcrDocumentConfirmationRequest) =>
      ocrDocumentApi.confirm(projectId, jobId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrDocumentKeys.all })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
