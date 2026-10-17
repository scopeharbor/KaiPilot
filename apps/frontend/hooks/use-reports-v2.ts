/**
 * use-reports-v2 —— V2 报表工作台 TanStack Query hooks。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  v2ListTemplates,
  v2Preview,
  v2CreateVersion,
  v2ListVersions,
  v2GetJob,
  v2RetryJob,
  v2CreateExport,
  v2ListExports,
  v2AiReview,
  v2PeriodicPreview,
  v2PeriodicGenerate,
  v2PeriodicJob,
  v2PeriodicRetryJob,
  v2PeriodicReview,
  v2PeriodicCreateExport,
} from '@/lib/api/reports-v2'
import type { V2ReportExportFormat } from '@/lib/api/reports-v2'
import type {
  V2PreviewRequest,
  V2CreateVersionRequest,
  V2ListVersionsFilters,
  V2CreateExportRequest,
  V2AiReviewRequest,
  AiPeriodicPreviewRequest,
  AiPeriodicGenerateRequest,
  AiReviewPeriodicRequest,
} from '@aiproj/types'

/** Query key 工厂 */
export const reportV2Keys = {
  all: ['reports-v2'] as const,
  templates: (projectId: number) => [...reportV2Keys.all, 'templates', projectId] as const,
  preview: (projectId: number, req: V2PreviewRequest) =>
    [...reportV2Keys.all, 'preview', projectId, req] as const,
  versions: (projectId: number, filters?: V2ListVersionsFilters) =>
    [...reportV2Keys.all, 'versions', projectId, filters] as const,
  job: (projectId: number, jobId: number) =>
    [...reportV2Keys.all, 'job', projectId, jobId] as const,
  exports: (projectId: number, versionId: number) =>
    [...reportV2Keys.all, 'exports', projectId, versionId] as const,
}

// ---------------------------------------------------------------------------
// 模板目录
// ---------------------------------------------------------------------------

export function useV2Templates(projectId: number) {
  return useQuery({
    queryKey: reportV2Keys.templates(projectId),
    queryFn: () => v2ListTemplates(projectId),
  })
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function useV2Preview(projectId: number, req: V2PreviewRequest | null) {
  return useQuery({
    queryKey: reportV2Keys.preview(projectId, req ?? ({} as V2PreviewRequest)),
    queryFn: () => v2Preview(projectId, req!),
    enabled: !!req,
  })
}

// ---------------------------------------------------------------------------
// 版本
// ---------------------------------------------------------------------------

export function useV2ListVersions(projectId: number, filters?: V2ListVersionsFilters) {
  return useQuery({
    queryKey: reportV2Keys.versions(projectId, filters),
    queryFn: () => v2ListVersions(projectId, filters),
  })
}

export function useV2CreateVersion(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: V2CreateVersionRequest) => v2CreateVersion(projectId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportV2Keys.versions(projectId) })
    },
  })
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

export function useV2Job(projectId: number, jobId: number | null) {
  return useQuery({
    queryKey: reportV2Keys.job(projectId, jobId ?? 0),
    queryFn: () => v2GetJob(projectId, jobId!),
    enabled: !!jobId,
    refetchInterval: (query) =>
      query.state.data?.data.status === 'queued' || query.state.data?.data.status === 'running'
        ? 2000
        : false,
  })
}

export function useV2RetryJob(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: number) => v2RetryJob(projectId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportV2Keys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export function useV2ListExports(projectId: number, versionId: number | null) {
  return useQuery({
    queryKey: reportV2Keys.exports(projectId, versionId ?? 0),
    queryFn: () => v2ListExports(projectId, versionId!),
    enabled: !!versionId,
  })
}

export function useV2CreateExport(projectId: number, versionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: V2CreateExportRequest) => v2CreateExport(projectId, versionId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportV2Keys.exports(projectId, versionId) })
    },
  })
}

// ---------------------------------------------------------------------------
// AI 审核
// ---------------------------------------------------------------------------

export function useV2AiReview(projectId: number, versionId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: V2AiReviewRequest) => v2AiReview(projectId, versionId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reportV2Keys.versions(projectId) })
    },
  })
}

// ---------------------------------------------------------------------------
// AI 周期报表
// ---------------------------------------------------------------------------

/** Query key 工厂：周期报表 */
export const periodicReportKeys = {
  all: ['periodic-reports'] as const,
  preview: (projectId: number) => [...periodicReportKeys.all, 'preview', projectId] as const,
  jobs: (projectId: number) => [...periodicReportKeys.all, 'jobs', projectId] as const,
  job: (projectId: number, jobId: number) =>
    [...periodicReportKeys.jobs(projectId), jobId] as const,
  versions: (projectId: number) => [...periodicReportKeys.all, 'versions', projectId] as const,
  exports: (projectId: number, versionId: number) =>
    [...periodicReportKeys.all, 'exports', projectId, versionId] as const,
}

export function useV2PeriodicPreview(projectId: number, req: AiPeriodicPreviewRequest | null) {
  return useQuery({
    queryKey: periodicReportKeys.preview(projectId),
    queryFn: () => v2PeriodicPreview(projectId, req!),
    enabled: !!req,
  })
}

export function useV2PeriodicGenerate(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiPeriodicGenerateRequest) => v2PeriodicGenerate(projectId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: periodicReportKeys.versions(projectId) })
    },
  })
}

export function useV2PeriodicJob(projectId: number, jobId: number | null) {
  return useQuery({
    queryKey: periodicReportKeys.job(projectId, jobId ?? 0),
    queryFn: () => v2PeriodicJob(projectId, jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = (query.state.data as { data?: { status?: string } } | undefined)?.data
      if (data?.status === 'queued' || data?.status === 'running') return 2000
      return false
    },
  })
}

export function useV2PeriodicRetryJob(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (jobId: number) => v2PeriodicRetryJob(projectId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: periodicReportKeys.all })
    },
  })
}

export function useV2PeriodicReview(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, body }: { versionId: number; body: AiReviewPeriodicRequest }) =>
      v2PeriodicReview(projectId, versionId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: periodicReportKeys.all })
    },
  })
}

export function useV2PeriodicCreateExport(projectId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      versionId,
      body,
    }: {
      versionId: number
      body: { format: V2ReportExportFormat; draftOverride?: boolean }
    }) => v2PeriodicCreateExport(projectId, versionId, body),
    onSuccess: (_data, { versionId }) => {
      queryClient.invalidateQueries({
        queryKey: periodicReportKeys.exports(projectId, versionId),
      })
    },
  })
}
