import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrEntityLinkingApi } from '@/lib/api/ocr-entity-linking'
import type {
  CreateOcrEntityLinkRunRequest,
  ConfirmOcrEntityLinkRequest,
  SupersedeOcrEntityLinkRequest,
  ExplainOcrEntityLinkRequest,
  OcrEntityLinkListFilters,
} from '@aiproj/types'

/**
 * OCR 实体链接——TanStack Query hooks（v3-ocr-entity-linking）。
 */

export const ocrEntityLinkingKeys = {
  all: ['ocr-entity-linking'] as const,
  runs: (projectId: number, filters?: OcrEntityLinkListFilters) =>
    [...ocrEntityLinkingKeys.all, 'runs', projectId, filters ?? {}] as const,
  detail: (projectId: number, runId: number) =>
    [...ocrEntityLinkingKeys.all, 'detail', projectId, runId] as const,
  candidates: (projectId: number, runId: number) =>
    [...ocrEntityLinkingKeys.all, 'candidates', projectId, runId] as const,
  candidatePage: (projectId: number, runId: number, page: number) =>
    [...ocrEntityLinkingKeys.all, 'candidates', projectId, runId, page] as const,
}

/** 列出项目的实体链接运行 */
export function useOcrEntityLinkRuns(projectId: number, filters?: OcrEntityLinkListFilters) {
  return useQuery({
    queryKey: ocrEntityLinkingKeys.runs(projectId, filters),
    queryFn: () => ocrEntityLinkingApi.list(projectId, filters),
    enabled: projectId > 0,
    staleTime: 10_000,
  })
}

/** 获取运行详情（含轮询，running 时每 5 秒刷新） */
export function useOcrEntityLinkRun(projectId: number, runId: number, enabled = true) {
  return useQuery({
    queryKey: ocrEntityLinkingKeys.detail(projectId, runId),
    queryFn: () => ocrEntityLinkingApi.detail(projectId, runId),
    enabled: enabled && projectId > 0 && runId > 0,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.run?.status
      if (status === 'running') return 5_000
      return false
    },
  })
}

/** 获取运行候选分页 */
export function useOcrEntityLinkCandidates(projectId: number, runId: number, page = 1) {
  return useQuery({
    queryKey: ocrEntityLinkingKeys.candidatePage(projectId, runId, page),
    queryFn: () => ocrEntityLinkingApi.candidates(projectId, runId, page),
    enabled: projectId > 0 && runId > 0,
    staleTime: 15_000,
  })
}

/** 创建实体链接运行 mutation */
export function useCreateOcrEntityLinkRun(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateOcrEntityLinkRunRequest) =>
      ocrEntityLinkingApi.create(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ocrEntityLinkingKeys.runs(projectId) })
    },
  })
}

/** 预览实体链接 mutation */
export function useOcrEntityLinkPreview(projectId: number) {
  return useMutation({
    mutationFn: ({ runId, candidateId }: { runId: number; candidateId: number }) =>
      ocrEntityLinkingApi.preview(projectId, runId, candidateId),
  })
}

/** 确认实体链接 mutation */
export function useConfirmOcrEntityLink(projectId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ConfirmOcrEntityLinkRequest) =>
      ocrEntityLinkingApi.confirm(projectId, input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.candidates(projectId, variables.runId),
      })
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.detail(projectId, variables.runId),
      })
      queryClient.invalidateQueries({ queryKey: ocrEntityLinkingKeys.runs(projectId) })
    },
  })
}

/** 取代实体链接 mutation */
export function useSupersedeOcrEntityLink(projectId: number, runId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ linkId, input }: { linkId: number; input: SupersedeOcrEntityLinkRequest }) =>
      ocrEntityLinkingApi.supersede(projectId, linkId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.candidates(projectId, runId),
      })
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.detail(projectId, runId),
      })
    },
  })
}

/** 拒绝实体链接 mutation */
export function useRejectOcrEntityLink(projectId: number, runId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ linkId, input }: { linkId: number; input: SupersedeOcrEntityLinkRequest }) =>
      ocrEntityLinkingApi.reject(projectId, linkId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.candidates(projectId, runId),
      })
      queryClient.invalidateQueries({
        queryKey: ocrEntityLinkingKeys.detail(projectId, runId),
      })
    },
  })
}

/** AI 解释实体链接 mutation */
export function useOcrEntityLinkExplanation(projectId: number) {
  return useMutation({
    mutationFn: (input: ExplainOcrEntityLinkRequest) =>
      ocrEntityLinkingApi.explain(projectId, input),
  })
}
