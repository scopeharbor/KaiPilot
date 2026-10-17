/**
 * OCR 结构化提取——TanStack Query Hooks（v3-ocr-structured-extraction §6.2）。
 *
 * 提供 OCR 结构化提取 profile/run/candidate/snapshot 查询与 mutation hooks。
 * 所有操作需项目成员权限，前端通过 API 错误码处理权限降级。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ocrStructuredExtractionApi } from '@/lib/api/ocr-structured-extraction'
import type {
  CreateOcrExtractionProfileRequest,
  UpdateOcrExtractionProfileRequest,
  CreateOcrExtractionRunRequest,
  ListOcrExtractionRunsFilter,
  OcrStructuredExtractionPreviewRequest,
  OcrStructuredExtractionSaveRequest,
} from '@aiproj/types'

// ─── Query Keys ───────────────────────────────────────────────────────────

export const ocrStructuredExtractionKeys = {
  all: (projectId: number) => ['ocr-structured-extraction', projectId] as const,

  profiles: (projectId: number) =>
    [...ocrStructuredExtractionKeys.all(projectId), 'profiles'] as const,
  profileList: (projectId: number, params?: Record<string, unknown>) =>
    [...ocrStructuredExtractionKeys.profiles(projectId), 'list', params] as const,
  profileDetail: (projectId: number, profileId: number) =>
    [...ocrStructuredExtractionKeys.profiles(projectId), 'detail', profileId] as const,

  runs: (projectId: number) => [...ocrStructuredExtractionKeys.all(projectId), 'runs'] as const,
  runList: (projectId: number, filters?: ListOcrExtractionRunsFilter) =>
    [...ocrStructuredExtractionKeys.runs(projectId), 'list', filters] as const,
  runDetail: (projectId: number, runId: number) =>
    [...ocrStructuredExtractionKeys.runs(projectId), 'detail', runId] as const,
  runCandidates: (projectId: number, runId: number) =>
    [...ocrStructuredExtractionKeys.runs(projectId), 'candidates', runId] as const,

  snapshots: (projectId: number) =>
    [...ocrStructuredExtractionKeys.all(projectId), 'snapshots'] as const,
  snapshotList: (projectId: number, params?: Record<string, unknown>) =>
    [...ocrStructuredExtractionKeys.snapshots(projectId), 'list', params] as const,
  snapshotDetail: (projectId: number, snapshotId: number) =>
    [...ocrStructuredExtractionKeys.snapshots(projectId), 'detail', snapshotId] as const,
}

// ─── Queries ──────────────────────────────────────────────────────────────

/** 获取提取 profile 列表 */
export function useOcrExtractionProfiles(
  projectId: number,
  params?: { scope?: string; status?: string; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.profileList(projectId, params),
    queryFn: () => ocrStructuredExtractionApi.listProfiles(projectId, params),
    enabled: !!projectId,
  })
}

/** 获取单个 profile 详情 */
export function useOcrExtractionProfile(projectId: number, profileId: number | null) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.profileDetail(projectId, profileId!),
    queryFn: () => ocrStructuredExtractionApi.getProfile(projectId, profileId!),
    enabled: !!projectId && profileId != null,
  })
}

/** 获取运行列表 */
export function useOcrExtractionRuns(projectId: number, filters?: ListOcrExtractionRunsFilter) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.runList(projectId, filters),
    queryFn: () => ocrStructuredExtractionApi.listRuns(projectId, filters),
    enabled: !!projectId,
  })
}

/** 获取单个运行详情 */
export function useOcrExtractionRun(projectId: number, runId: number | null) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.runDetail(projectId, runId!),
    queryFn: () => ocrStructuredExtractionApi.getRun(projectId, runId!),
    enabled: !!projectId && runId != null,
  })
}

/** 获取运行候选 */
export function useOcrExtractionCandidates(projectId: number, runId: number | null) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.runCandidates(projectId, runId!),
    queryFn: () => ocrStructuredExtractionApi.getCandidates(projectId, runId!),
    enabled: !!projectId && runId != null,
  })
}

/** 获取快照列表 */
export function useOcrExtractionSnapshots(
  projectId: number,
  params?: { extractionId?: number; profileId?: number; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.snapshotList(projectId, params),
    queryFn: () => ocrStructuredExtractionApi.listSnapshots(projectId, params),
    enabled: !!projectId,
  })
}

/** 获取单个快照详情 */
export function useOcrExtractionSnapshot(projectId: number, snapshotId: number | null) {
  return useQuery({
    queryKey: ocrStructuredExtractionKeys.snapshotDetail(projectId, snapshotId!),
    queryFn: () => ocrStructuredExtractionApi.getSnapshot(projectId, snapshotId!),
    enabled: !!projectId && snapshotId != null,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────

/** 创建 profile */
export function useCreateOcrExtractionProfile(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOcrExtractionProfileRequest) =>
      ocrStructuredExtractionApi.createProfile(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.profiles(projectId) })
    },
  })
}

/** 更新 profile */
export function useUpdateOcrExtractionProfile(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      profileId,
      input,
    }: {
      profileId: number
      input: UpdateOcrExtractionProfileRequest
    }) => ocrStructuredExtractionApi.updateProfile(projectId, profileId, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ocrStructuredExtractionKeys.profileDetail(projectId, variables.profileId),
      })
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.profiles(projectId) })
    },
  })
}

/** 归档 profile */
export function useArchiveOcrExtractionProfile(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (profileId: number) =>
      ocrStructuredExtractionApi.archiveProfile(projectId, profileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.profiles(projectId) })
    },
  })
}

/** 创建运行 */
export function useCreateOcrExtractionRun(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOcrExtractionRunRequest) =>
      ocrStructuredExtractionApi.createRun(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.runs(projectId) })
    },
  })
}

/** 确认预览 */
export function useOcrStructuredExtractionPreview(projectId: number) {
  return useMutation({
    mutationFn: (input: OcrStructuredExtractionPreviewRequest) =>
      ocrStructuredExtractionApi.previewConfirmation(projectId, input),
  })
}

/** 保存确认 */
export function useOcrStructuredExtractionSave(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: OcrStructuredExtractionSaveRequest) =>
      ocrStructuredExtractionApi.saveConfirmation(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.snapshots(projectId) })
      qc.invalidateQueries({ queryKey: ocrStructuredExtractionKeys.runs(projectId) })
    },
  })
}
