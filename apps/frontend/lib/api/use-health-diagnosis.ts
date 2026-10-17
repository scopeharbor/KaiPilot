'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getLatestDiagnosis,
  listDiagnoses,
  getDiagnosis,
  createDiagnosis,
  refreshDiagnosis,
  generateAiDraft,
  confirmDiagnosis,
  rejectDiagnosis,
  confirmStaleDiagnosis,
} from './health-diagnosis'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const healthDiagnosisKeys = {
  all: ['health-diagnoses'] as const,
  latest: (projectId: number) => ['health-diagnoses', 'latest', projectId] as const,
  list: (projectId: number, page: number) => ['health-diagnoses', 'list', projectId, page] as const,
  detail: (projectId: number, diagnosisId: number) =>
    ['health-diagnoses', 'detail', projectId, diagnosisId] as const,
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** 获取项目最新健康诊断 */
export function useLatestDiagnosis(projectId: number) {
  return useQuery({
    queryKey: healthDiagnosisKeys.latest(projectId),
    queryFn: () => getLatestDiagnosis(projectId),
    enabled: !!projectId,
  })
}

/** 获取诊断列表 */
export function useDiagnosisList(projectId: number, page = 1) {
  return useQuery({
    queryKey: healthDiagnosisKeys.list(projectId, page),
    queryFn: () => listDiagnoses(projectId, { page }),
    enabled: !!projectId,
  })
}

/** 获取诊断详情 */
export function useDiagnosisDetail(projectId: number, diagnosisId: number) {
  return useQuery({
    queryKey: healthDiagnosisKeys.detail(projectId, diagnosisId),
    queryFn: () => getDiagnosis(projectId, diagnosisId),
    enabled: !!projectId && !!diagnosisId,
  })
}

/** 生成新诊断 */
export function useCreateDiagnosis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enableAiDraft?: boolean) => createDiagnosis(projectId, enableAiDraft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.latest(projectId) })
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.list(projectId, 1) })
    },
  })
}

/** 刷新诊断 */
export function useRefreshDiagnosis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => refreshDiagnosis(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.all })
    },
  })
}

/** 生成 AI 草稿 */
export function useGenerateAiDraft(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (diagnosisId: number) => generateAiDraft(projectId, diagnosisId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.all })
    },
  })
}

/** 确认诊断 */
export function useConfirmDiagnosis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ diagnosisId, notes }: { diagnosisId: number; notes?: string }) =>
      confirmDiagnosis(projectId, diagnosisId, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.all })
    },
  })
}

/** 驳回诊断 */
export function useRejectDiagnosis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ diagnosisId, reason }: { diagnosisId: number; reason: string }) =>
      rejectDiagnosis(projectId, diagnosisId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.all })
    },
  })
}

/** 确认过期诊断继续使用 */
export function useConfirmStaleDiagnosis(projectId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ diagnosisId, reason }: { diagnosisId: number; reason?: string }) =>
      confirmStaleDiagnosis(projectId, diagnosisId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: healthDiagnosisKeys.all })
    },
  })
}
