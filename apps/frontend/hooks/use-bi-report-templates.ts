/**
 * BI 报表模板库 TanStack Query hooks（v3-bi-report-template-library §6.1）。
 *
 * 分层 query keys，覆盖目录/详情/预览/实例化/副本写操作。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listBiTemplates,
  getBiTemplate,
  previewBiTemplate,
  instantiateBiTemplate,
  saveBiTemplateCopy,
  updateBiTemplateCopy,
  archiveBiTemplateCopy,
  restoreBiTemplateCopy,
} from '@/lib/api/bi-report-templates'
import type { BiInstantiateRequest, BiSaveCopyRequest, BiUpdateCopyRequest } from '@aiproj/types'

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const biTemplateKeys = {
  all: ['bi', 'report-templates'] as const,
  lists: (organizationId: number) => [...biTemplateKeys.all, 'list', organizationId] as const,
  list: (organizationId: number, filters?: Record<string, unknown>) =>
    [...biTemplateKeys.lists(organizationId), filters] as const,
  details: (organizationId: number) => [...biTemplateKeys.all, 'detail', organizationId] as const,
  detail: (organizationId: number, templateId: string) =>
    [...biTemplateKeys.details(organizationId), templateId] as const,
  previews: (organizationId: number) => [...biTemplateKeys.all, 'preview', organizationId] as const,
  preview: (organizationId: number, templateId: string) =>
    [...biTemplateKeys.previews(organizationId), templateId] as const,
}

// ─── 只读 Hooks ─────────────────────────────────────────────────────────────

/** 模板目录列表 */
export function useBiTemplates(
  organizationId: number,
  filters?: { category?: string; page?: number; perPage?: number },
) {
  return useQuery({
    queryKey: biTemplateKeys.list(organizationId, filters),
    queryFn: () => listBiTemplates(organizationId, filters),
    enabled: organizationId > 0,
  })
}

/** 模板详情 */
export function useBiTemplate(organizationId: number, templateId: string) {
  return useQuery({
    queryKey: biTemplateKeys.detail(organizationId, templateId),
    queryFn: () => getBiTemplate(organizationId, templateId),
    enabled: organizationId > 0 && templateId.length > 0,
  })
}

/** 模板预览 */
export function useBiTemplatePreview(organizationId: number, templateId: string) {
  return useQuery({
    queryKey: biTemplateKeys.preview(organizationId, templateId),
    queryFn: () => previewBiTemplate(organizationId, templateId),
    enabled: organizationId > 0 && templateId.length > 0,
  })
}

// ─── 实例化 Mutation ────────────────────────────────────────────────────────

export function useInstantiateBiTemplate(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: string; body: BiInstantiateRequest }) =>
      instantiateBiTemplate(organizationId, templateId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: biTemplateKeys.lists(organizationId) })
    },
  })
}

// ─── 自定义副本 Mutation ───────────────────────────────────────────────────

export function useSaveBiTemplateCopy(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: string; body: BiSaveCopyRequest }) =>
      saveBiTemplateCopy(organizationId, templateId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: biTemplateKeys.lists(organizationId) })
    },
  })
}

export function useUpdateBiTemplateCopy(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ copyId, body }: { copyId: number; body: BiUpdateCopyRequest }) =>
      updateBiTemplateCopy(organizationId, copyId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: biTemplateKeys.lists(organizationId) })
    },
  })
}

export function useArchiveBiTemplateCopy(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (copyId: number) => archiveBiTemplateCopy(organizationId, copyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: biTemplateKeys.lists(organizationId) })
    },
  })
}

export function useRestoreBiTemplateCopy(organizationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (copyId: number) => restoreBiTemplateCopy(organizationId, copyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: biTemplateKeys.lists(organizationId) })
    },
  })
}
